export type Point = { x: number; y: number };

export type MapRoom = {
  id: string;
  floorId: string;
  name: string;
  number?: string;
  kind: "room" | "stairs" | "entrance";
  polygon: Point[];
  label: Point;
  // Identifies the object, not the accuracy of a measured building survey.
  verified: boolean;
  note?: string;
};

export type MapFloor = {
  id: string;
  level: number;
  name: string;
  aspectRatio: number;
  outline: Point[];
  corridors: Point[][];
  rooms: MapRoom[];
  note: string;
};

export type RouteNode = {
  id: string;
  floorId: string;
  position: Point;
  roomId?: string;
};

export type RouteEdge = {
  id: string;
  from: string;
  to: string;
  distance: number;
  verified: boolean;
};

export type FloorTransition = {
  id: string;
  name: string;
  kind: "stairs";
  fromNodeId: string;
  toNodeId: string;
  verified: boolean;
};

export type CampusMap = {
  id: string;
  name: string;
  address: string;
  floors: MapFloor[];
  nodes: RouteNode[];
  edges: RouteEdge[];
  transitions: FloorTransition[];
  routingStatus: "unverified" | "verified";
};
