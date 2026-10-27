import "server-only";

import type { CampusMap, MapFloor, MapRoom, Point } from "./types";

type Coordinate = readonly [number, number];
type Region = readonly [number, number, number, number];

// Manually traced from the four supplied photographs, with perspective flattened.
// These are approximate plan units, not metres. No source photograph is served.
// IDs identify drawing regions only. Room numbers require an explicit annotation.
function floorGeometry(level: number, width: number, height: number) {
  const floorId = `floor${level}`;
  const point = ([x, y]: Coordinate): Point => ({ x: x / width, y: y / height });
  const polygon = (points: Coordinate[]) => points.map(point);
  const rectangle = ([x, y, right, bottom]: Region) =>
    polygon([[x, y], [right, y], [right, bottom], [x, bottom]]);
  const rooms: MapRoom[] = [];

  const addRoom = (bounds: Region, note?: string, details: Partial<Pick<MapRoom, "name" | "number" | "shortLabel" | "verified">> = {}) => {
    const [x, y, right, bottom] = bounds;
    rooms.push({
      id: `${floorId}-room${String(rooms.length + 1).padStart(2, "0")}`,
      floorId,
      name: "Помещение без номера",
      kind: "room",
      polygon: rectangle(bounds),
      label: point([(x + right) / 2, (y + bottom) / 2]),
      verified: false,
      note: note ?? "Номер и назначение не указаны на исходном плане. Требуется уточнение.",
      ...details,
    });
  };
  const addStairs = (side: "left" | "right", bounds: Region) => {
    const [x, y, right, bottom] = bounds;
    rooms.push({
      id: `${floorId}-stairs-${side}`,
      floorId,
      name: side === "left" ? "Лестница слева на плане" : "Лестница справа на плане",
      kind: "stairs",
      polygon: rectangle(bounds),
      label: point([(x + right) / 2, (y + bottom) / 2]),
      verified: true,
      note: "Выделен различимый лестничный пролёт. Соседние площадки, доступность и связь с другими этажами ещё не подтверждены.",
    });
  };

  return { floorId, point, polygon, rectangle, rooms, addRoom, addStairs };
}

function firstFloor(): MapFloor {
  const map = floorGeometry(1, 1080, 246);
  const upperRooms: Region[] = [
    [0, 0, 183, 64], [183, 0, 237, 64], [237, 0, 268, 64],
    [443, 0, 596, 64], [596, 0, 625, 64], [625, 0, 652, 64],
    [652, 0, 695, 64], [880, 0, 905, 74], [905, 0, 930, 64],
  ];
  const lowerRooms: Region[] = [
    [0, 92, 105, 160], [105, 80, 155, 160], [155, 92, 257, 160],
    [257, 92, 304, 160], [352, 96, 398, 160], [398, 112, 422, 160],
    [422, 96, 447, 160], [447, 80, 535, 160], [555, 80, 657, 160],
    [678, 96, 766, 160], [766, 96, 799, 160], [799, 116, 823, 160],
    [851, 96, 978, 160],
  ];
  upperRooms.forEach((bounds) => map.addRoom(bounds));
  lowerRooms.forEach((bounds) => map.addRoom(bounds));
  map.addRoom([0, 64, 42, 92]);
  map.addRoom([42, 64, 83, 92]);
  map.addRoom([268, 0, 288, 64], "Узкая область рядом с лестницей; назначение и проход требуют уточнения.");
  map.addRoom([823, 96, 851, 116], "Небольшая область с неясными внутренними перегородками.");
  map.rooms.push({
    id: "floor1-room27",
    floorId: map.floorId,
    name: "Помещение без номера",
    kind: "room",
    polygon: map.polygon([[930, 0], [1080, 0], [1080, 160], [978, 160], [978, 64], [930, 64]]),
    label: map.point([1030, 112]),
    verified: false,
    note: "Область в правом торце здания. Назначение, режим доступа и границы прохода требуют уточнения.",
  });
  map.addRoom([814, 0, 845, 64], "Отдельная секция справа от лестничного пролёта. Внутренние перегородки и назначение требуют уточнения.");
  // Only the recognisable flights are identified as stairs. The adjacent broad
  // landings and ambiguous partitioned bays remain neutral, unclassified space.
  map.addStairs("left", [293, 0, 327, 64]);
  map.addStairs("right", [770, 0, 805, 64]);

  return {
    id: map.floorId,
    level: 1,
    name: "1 этаж",
    aspectRatio: 1080 / 246,
    outline: map.polygon([[0, 0], [1080, 0], [1080, 160], [555, 160], [555, 192], [535, 192], [535, 160], [352, 160], [352, 246], [304, 246], [304, 160], [0, 160]]),
    corridors: [
      map.polygon([[83, 64], [288, 64], [288, 70], [930, 70], [930, 64], [978, 64], [978, 96], [851, 96], [851, 80], [352, 80], [352, 96], [304, 96], [304, 92], [155, 92], [155, 80], [83, 80]]),
      map.rectangle([304, 80, 352, 246]),
      map.rectangle([535, 80, 555, 192]),
      map.rectangle([657, 80, 678, 160]),
      map.rectangle([823, 116, 851, 160]),
    ],
    rooms: map.rooms,
    note: "Контуры перенесены приблизительно с фотографии. Видны нижние выступы и лестничные пролёты. Неразмеченные зоны рядом с лестницами, входы для повседневного доступа, мелкие перегородки и номера помещений требуют уточнения.",
  };
}

function secondFloor(): MapFloor {
  const map = floorGeometry(2, 1180, 172);
  const upperRooms: Region[] = [
    [0, 0, 113, 70], [113, 0, 173, 70], [173, 0, 262, 70],
    [360, 0, 415, 70], [415, 0, 497, 70], [497, 0, 526, 70],
    [526, 0, 628, 70], [628, 0, 714, 70], [714, 0, 747, 70],
    [928, 0, 959, 70], [959, 0, 1019, 70], [1019, 0, 1046, 70],
    [1046, 0, 1078, 70], [1078, 0, 1112, 70], [1112, 0, 1140, 70],
    [1140, 0, 1180, 70],
  ];
  const lowerRooms: Region[] = [
    [0, 104, 175, 172], [175, 104, 262, 172], [262, 104, 341, 172],
    [341, 104, 418, 172], [418, 104, 500, 172], [500, 104, 529, 172],
    [628, 104, 689, 172], [689, 104, 719, 172], [719, 104, 746, 172],
    [746, 104, 843, 172], [843, 104, 872, 172], [872, 104, 902, 172],
    [902, 104, 929, 172], [929, 116, 963, 172], [963, 116, 991, 172],
    [991, 116, 1053, 172], [1053, 116, 1116, 172], [1116, 116, 1180, 172],
  ];
  upperRooms.forEach((bounds) => map.addRoom(bounds));
  lowerRooms.forEach((bounds) => map.addRoom(bounds));
  map.addRoom([876, 0, 905, 64], "Отдельная секция рядом с правым лестничным пролётом. Назначение и мелкие перегородки требуют уточнения.");
  map.addStairs("left", [300, 0, 343, 70]);
  map.addStairs("right", [815, 0, 868, 70]);

  return {
    id: map.floorId,
    level: 2,
    name: "2 этаж",
    aspectRatio: 1180 / 172,
    outline: map.rectangle([0, 0, 1180, 172]),
    corridors: [map.rectangle([0, 70, 1180, 104]), map.rectangle([529, 104, 628, 172]), map.rectangle([929, 104, 1180, 116])],
    rooms: map.rooms,
    note: "Контуры приблизительно перенесены с фотографии. Неразмеченные зоны около лестничных пролётов, мелкие перегородки в правом крыле и доступ через дверные проёмы требуют уточнения. Номера и назначения помещений на фото отсутствуют.",
  };
}

function thirdFloor(): MapFloor {
  const map = floorGeometry(3, 1100, 174);
  const upperRooms: Region[] = [
    [0, 0, 87, 70], [87, 0, 117, 70], [226, 0, 290, 70],
    [290, 0, 380, 70], [380, 0, 470, 70], [470, 0, 553, 70],
    [553, 0, 648, 70], [648, 0, 674, 70], [841, 0, 933, 70],
    [933, 0, 967, 70], [967, 0, 1100, 70],
  ];
  const lowerRooms: Region[] = [
    [32, 102, 62, 174], [62, 102, 155, 174], [155, 102, 187, 174],
    [187, 102, 290, 174], [290, 102, 388, 174], [388, 102, 413, 174],
    [530, 102, 560, 174], [560, 102, 648, 174], [648, 102, 746, 174],
    [746, 102, 838, 174], [838, 102, 935, 174], [935, 102, 974, 174],
    [974, 102, 1100, 174],
  ];
  upperRooms.forEach((bounds) => map.addRoom(bounds));
  lowerRooms.forEach((bounds) => map.addRoom(bounds));
  map.addRoom([773, 0, 808, 42], "Небольшая отделённая секция около правого лестничного пролёта. Назначение и граница прохода требуют уточнения.");
  map.addStairs("left", [153, 0, 207, 70]);
  map.addStairs("right", [718, 0, 772, 70]);

  return {
    id: map.floorId,
    level: 3,
    name: "3 этаж",
    aspectRatio: 1100 / 174,
    outline: map.polygon([[0, 0], [1100, 0], [1100, 174], [32, 174], [32, 102], [0, 102]]),
    corridors: [map.rectangle([0, 70, 1100, 102]), map.rectangle([413, 102, 530, 174])],
    rooms: map.rooms,
    note: "Контуры приблизительно перенесены с фотографии с учётом наклона. Сохранён уступ слева. Неразмеченные зоны рядом с лестницами, границы небольших помещений и доступность проёмов требуют уточнения; номеров на фото нет.",
  };
}

function fourthFloor(): MapFloor {
  const map = floorGeometry(4, 1098, 162);
  // Supplied numbered annotation, 27.10.2026. Only 403 spans the two formerly
  // traced regions; adjacent unlabelled sections are not assigned a room number.
  const numberedRooms: [string, Region][] = [
    ["401", [0, 0, 107, 64]], ["403", [133, 0, 210, 64]],
    ["405", [210, 0, 239, 64]], ["407", [383, 0, 461, 64]],
    ["409", [461, 0, 486, 64]], ["411", [486, 0, 583, 64]],
    ["413", [583, 0, 692, 64]], ["415", [867, 0, 947, 64]],
    ["417", [976, 0, 1098, 64]],
    ["402", [0, 96, 78, 162]], ["404", [78, 96, 161, 162]],
    ["406", [161, 96, 238, 162]], ["408", [258, 96, 386, 162]],
    ["410", [386, 96, 461, 162]], ["412", [612, 96, 691, 162]],
    ["414", [691, 96, 780, 162]], ["416", [807, 96, 902, 162]],
    ["418", [902, 96, 976, 162]], ["420", [976, 96, 1010, 162]],
    ["419", [1010, 96, 1098, 162]],
  ];
  numberedRooms.forEach(([number, bounds]) => map.addRoom(
    bounds,
    "Номер указан на разметке пользователя. Вход и доступность аудитории требуют проверки.",
    { name: `Аудитория ${number}`, number, verified: true },
  ));
  const unlabelledRooms: Region[] = [
    [335, 0, 383, 64], [947, 0, 976, 64], [238, 96, 258, 162],
    [461, 96, 487, 162], [584, 96, 612, 162], [780, 96, 807, 162],
  ];
  unlabelledRooms.forEach((bounds) => map.addRoom(bounds));
  const namedRooms: [string, string, Region][] = [
    ["Служебное помещение слева", "С", [107, 0, 133, 64]],
    ["Женский туалет", "Ж", [239, 0, 274, 64]],
    ["Служебное помещение справа", "С", [808, 0, 837, 64]],
    ["Мужской туалет", "М", [837, 0, 867, 64]],
  ];
  namedRooms.forEach(([name, shortLabel, bounds]) => map.addRoom(
    bounds,
    "Назначение указано на разметке пользователя. Доступность помещения требует проверки.",
    { name, shortLabel, verified: true },
  ));
  map.addStairs("left", [274, 0, 316, 64]);
  map.addStairs("right", [758, 0, 805, 64]);

  return {
    id: map.floorId,
    level: 4,
    name: "4 этаж",
    aspectRatio: 1098 / 162,
    outline: map.rectangle([0, 0, 1098, 162]),
    corridors: [map.rectangle([0, 64, 1098, 96]), map.rectangle([487, 96, 584, 162])],
    rooms: map.rooms,
    note: "Номера аудиторий и четыре назначения уточнены по разметке пользователя. Контуры приблизительные; неподписанные зоны, входы, небольшие перегородки и связи с другими этажами требуют проверки.",
  };
}

export const collegeMap: CampusMap = {
  id: "it-moscow-million-shchikova-20",
  name: "Колледж ИТ.Москва",
  address: "Москва, ул. Академика Миллионщикова, 20",
  floors: [firstFloor(), secondFloor(), thirdFloor(), fourthFloor()],
  // Similar stair locations do not prove a traversable connection. Add edges only
  // after room entrances, corridor connectivity and floor transitions are checked.
  nodes: [],
  edges: [],
  transitions: [],
  routingStatus: "unverified",
};
