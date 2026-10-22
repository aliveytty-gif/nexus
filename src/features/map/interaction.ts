import type { MapRoom } from "./types.ts";

export type MapView = { x: number; y: number; zoom: number };
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// Keep at least part of the building in view, even after a long drag.
export function constrainView(view: MapView, floorHeight: number): MapView {
  return {
    x: clamp(view.x, 0, 1000),
    y: clamp(view.y, 0, floorHeight),
    zoom: clamp(view.zoom, 1, 6),
  };
}

export function zoomAt(view: MapView, factor: number, anchor: { x: number; y: number }, width: number, floorHeight: number): MapView {
  const zoom = clamp(view.zoom * factor, 1, 6);
  const delta = width / view.zoom - width / zoom;
  return constrainView({ x: view.x + anchor.x * delta, y: view.y + anchor.y * delta, zoom }, floorHeight);
}

export function searchRooms(rooms: MapRoom[], query: string): MapRoom[] {
  const tokens = query.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/№/g, " ").trim().split(/\s+/).filter(Boolean);
  return rooms.filter((room) => {
    // Internal IDs are not room numbers and must never become search aliases.
    const text = `${room.name} ${room.number ?? ""} ${room.note ?? ""}`.toLocaleLowerCase("ru").replace(/ё/g, "е");
    return tokens.every((token) => text.includes(token));
  });
}
