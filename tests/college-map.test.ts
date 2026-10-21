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
  it("does not claim unconfirmed room numbers or traversable routes", () => {
    assert.equal(map.routingStatus, "unverified");
    assert.deepEqual(map.nodes, []);
    assert.deepEqual(map.edges, []);
    assert.deepEqual(map.transitions, []);
    for (const room of map.floors.flatMap((floor) => floor.rooms)) {
      assert.equal(room.number, undefined);
      if (room.kind === "room") assert.equal(room.verified, false);
    }
  });
});
