import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { constrainView, searchRooms, zoomAt } from "../src/features/map/interaction.ts";
import type { CampusMap, MapRoom, Point } from "../src/features/map/types.ts";

// Load the real server-only map with React's server condition, without changing
// production import boundaries or serving the source photographs to the client.
const dataUrl = new URL("../src/features/map/data.ts", import.meta.url).href;
const map: CampusMap = JSON.parse(execFileSync(process.execPath, [
  "--conditions=react-server", "--experimental-strip-types", "--input-type=module",
  "--eval", `const { collegeMap } = await import(${JSON.stringify(dataUrl)}); process.stdout.write(JSON.stringify(collegeMap));`,
], { encoding: "utf8" }));

const sample: MapRoom[] = [
  { id: "floor1-room12", floorId: "floor1", name: "Учебный кабинет", number: "101", kind: "room", polygon: [], label: { x: .2, y: .2 }, verified: true },
  { id: "floor2-room18", floorId: "floor2", name: "Лестница справа", kind: "stairs", polygon: [], label: { x: .8, y: .2 }, verified: true, note: "Подъём требует проверки" },
  { id: "floor3-room25", floorId: "floor3", name: "Помещение без номера", kind: "room", polygon: [], label: { x: .5, y: .8 }, verified: false },
];

describe("college map search", () => {
  it("matches supplied room numbers and ignores the number sign and surrounding spaces", () => {
    assert.deepEqual(searchRooms(sample, "  № 101  "), [sample[0]]);
  });
  it("normalizes Russian case and ё, requiring every search token", () => {
    assert.deepEqual(searchRooms(sample, " ПОДЪЕМ   СПРАВА "), [sample[1]]);
    assert.deepEqual(searchRooms(sample, "кабинет справа"), []);
  });
  it("does not turn internal object IDs into invented room numbers", () => {
    assert.deepEqual(searchRooms(sample, "room25"), []);
    assert.deepEqual(searchRooms(sample, "25"), []);
    assert.deepEqual(searchRooms(map.floors.flatMap((floor) => floor.rooms), "101"), []);
  });
  it("treats wildcard-like input literally", () => {
    assert.deepEqual(searchRooms(sample, ".*"), []);
    assert.deepEqual(searchRooms(sample, "%"), []);
  });
});

describe("college map viewport", () => {
  it("bounds long drags and zoom without mutating the prior view", () => {
    const source = { x: -8000, y: 9000, zoom: 40 };
    assert.deepEqual(constrainView(source, 180), { x: 0, y: 180, zoom: 6 });
    assert.deepEqual(source, { x: -8000, y: 9000, zoom: 40 });
    assert.deepEqual(constrainView({ x: 9000, y: -8000, zoom: .01 }, 180), { x: 1000, y: 0, zoom: 1 });
  });
  it("keeps the point beneath the pointer stationary while zooming", () => {
    const original = { x: 500, y: 100, zoom: 2 };
    const anchor = { x: .2, y: .05 };
    const width = 1100;
    const zoomed = zoomAt(original, 1.5, anchor, width, 200);
    for (const axis of ["x", "y"] as const) {
      assert.ok(Math.abs(original[axis] + anchor[axis] * width / original.zoom
        - zoomed[axis] - anchor[axis] * width / zoomed.zoom) < 1e-9);
    }
    const restored = zoomAt(zoomed, 1 / 1.5, anchor, width, 200);
    assert.ok(Math.abs(restored.x - original.x) < 1e-9);
    assert.ok(Math.abs(restored.y - original.y) < 1e-9);
    assert.equal(restored.zoom, original.zoom);
  });
  it("does not drift at the maximum or minimum zoom", () => {
    for (const [zoom, factor] of [[6, 2], [1, .5]]) {
      const view = { x: 500, y: 100, zoom };
      assert.deepEqual(zoomAt(view, factor, { x: .4, y: .1 }, 1100, 200), view);
    }
  });
});

function inside(point: Point, polygon: Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

describe("photograph-derived map data", () => {
  it("keeps all four floors uniquely identified and geometry within normalized coordinates", () => {
    assert.deepEqual(map.floors.map((floor) => floor.level), [1, 2, 3, 4]);
    const ids = new Set<string>();
    for (const floor of map.floors) {
      assert.ok(!ids.has(floor.id)); ids.add(floor.id);
      assert.ok(Number.isFinite(floor.aspectRatio) && floor.aspectRatio > 0);
      assert.ok(floor.rooms.length > 0);
      for (const polygon of [floor.outline, ...floor.corridors, ...floor.rooms.map((room) => room.polygon)]) {
        assert.ok(polygon.length >= 3);
        for (const point of polygon) {
          assert.ok(Number.isFinite(point.x) && point.x >= 0 && point.x <= 1);
          assert.ok(Number.isFinite(point.y) && point.y >= 0 && point.y <= 1);
        }
      }
      for (const room of floor.rooms) {
        assert.ok(!ids.has(room.id)); ids.add(room.id);
        assert.equal(room.floorId, floor.id);
        assert.ok(inside(room.label, room.polygon), `${room.id}: selection label must be inside its shape`);
      }
    }
  });
  it("does not claim numbers on unannotated floors or traversable routes", () => {
    assert.equal(map.routingStatus, "unverified");
    assert.deepEqual(map.nodes, []);
    assert.deepEqual(map.edges, []);
    assert.deepEqual(map.transitions, []);
    for (const room of map.floors.filter((floor) => floor.level !== 4).flatMap((floor) => floor.rooms)) {
      assert.equal(room.number, undefined);
      if (room.kind === "room") assert.equal(room.verified, false);
    }
  });
  it("locates every supplied fourth-floor number in its annotated region, including 420 before 419", () => {
    const floor = map.floors.find((item) => item.level === 4)!;
    const expected: [string, number, number][] = [
      ["401", 50, 30], ["403", 170, 30], ["405", 225, 30],
      ["407", 420, 30], ["409", 475, 30], ["411", 530, 30],
      ["413", 635, 30], ["415", 905, 30], ["417", 1035, 30],
      ["402", 40, 125], ["404", 120, 125], ["406", 200, 125],
      ["408", 325, 125], ["410", 425, 125], ["412", 650, 125],
      ["414", 735, 125], ["416", 850, 125], ["418", 940, 125],
      ["420", 990, 125], ["419", 1050, 125],
    ];
    assert.deepEqual(floor.rooms.filter((room) => room.number).map((room) => Number(room.number)).sort((a, b) => a - b),
      Array.from({ length: 20 }, (_, index) => 401 + index));
    for (const [number, x, y] of expected) {
      const matches = searchRooms(map.floors.flatMap((item) => item.rooms), `№ ${number}`);
      assert.equal(matches.length, 1, number);
      assert.equal(matches[0].floorId, floor.id);
      assert.ok(matches[0].verified);
      assert.ok(inside({ x: x / 1098, y: y / 162 }, matches[0].polygon), number);
    }
    // These adjacent narrow sections have no supplied number.
    for (const [x, y] of [[350, 30], [960, 30], [475, 125], [600, 125], [795, 125]]) {
      const room = floor.rooms.find((item) => inside({ x: x / 1098, y: y / 162 }, item.polygon));
      assert.ok(room && !room.number && !room.verified);
    }
    assert.ok(inside({ x: 145 / 1098, y: 30 / 162 }, floor.rooms.find((room) => room.number === "403")!.polygon));
  });
  it("places the supplied service rooms and toilets without inventing numbers", () => {
    const rooms = map.floors.find((floor) => floor.level === 4)!.rooms;
    for (const [query, x] of [["служебное слева", 120], ["женский туалет", 255], ["служебное справа", 820], ["мужской туалет", 850]] as const) {
      const matches = searchRooms(rooms, query);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].number, undefined);
      assert.ok(matches[0].verified);
      assert.ok(inside({ x: x / 1098, y: 30 / 162 }, matches[0].polygon));
    }
  });
});
