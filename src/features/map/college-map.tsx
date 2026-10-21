"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Focus, Layers, MapPin, Minus, Plus, Search, X } from "lucide-react";
import type { CampusMap, MapFloor, MapRoom, Point } from "./types";
import { constrainView, searchRooms, zoomAt, type MapView } from "./interaction";
import styles from "./map.module.css";

function roomLocation(room: MapRoom) {
  return `${room.label.x < .33 ? "Слева" : room.label.x > .67 ? "Справа" : "В центре"} · ${room.label.y < .5 ? "верхняя" : "нижняя"} часть схемы`;
}

function FloorPlan({ floor, selected, onSelect }: { floor: MapFloor; selected?: MapRoom; onSelect: (room: MapRoom) => void }) {
  const height = 1000 / floor.aspectRatio;
  const svg = useRef<SVGSVGElement>(null);
  const [aspect, setAspect] = useState(2.3);
  const [view, setView] = useState<MapView>({ x: 500, y: height / 2, zoom: 1 });
  const pointers = useRef(new Map<number, Point>());
  const moved = useRef(false);
  const pressedRoom = useRef<string | null>(null);
  const travel = useRef(0);
  const animation = useRef(0);
  const baseWidth = Math.max(1100, (height + 60) * aspect);
  const width = baseWidth / view.zoom;
  const points = (polygon: Point[]) => polygon.map((p) => `${p.x * 1000},${p.y * height}`).join(" ");

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height)
        setAspect(entry.contentRect.width / entry.contentRect.height);
    });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(animation.current); };
  }, []);

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      // Ordinary page scrolling remains available; zoom deliberately with Ctrl/⌘.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      cancelAnimationFrame(animation.current);
      const rect = element.getBoundingClientRect();
      setView((v) => zoomAt(v, Math.exp(-event.deltaY * .004), {
        x: (event.clientX - rect.left) / rect.width - .5,
        y: (event.clientY - rect.top - rect.height / 2) / rect.width,
      }, baseWidth, height));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [baseWidth, height]);

  function animate(next: MapView) {
    cancelAnimationFrame(animation.current);
    const target = constrainView(next, height);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setView(target); return; }
    const start = performance.now();
    const from = view;
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / 180);
      const ease = 1 - (1 - progress) ** 3;
      setView({ x: from.x + (target.x - from.x) * ease, y: from.y + (target.y - from.y) * ease, zoom: from.zoom + (target.zoom - from.zoom) * ease });
      if (progress < 1) animation.current = requestAnimationFrame(tick);
    }
    animation.current = requestAnimationFrame(tick);
  }

  function endPointer(event: React.PointerEvent<SVGSVGElement>) {
    if (event.type === "pointerup" && pointers.current.size === 1 && !moved.current && pressedRoom.current) {
      const room = floor.rooms.find((item) => item.id === pressedRoom.current);
      if (room) onSelect(room);
    }
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className={styles.canvasWrap}>
      <div className={styles.canvasHeading}><span>{floor.name}</span><span>Схема по плану · без масштаба в метрах</span></div>
      <svg ref={svg} className={styles.canvas} viewBox={`${view.x - width / 2} ${view.y - width / aspect / 2} ${width} ${width / aspect}`}
        aria-label={`План: ${floor.name}. Стрелки — перемещение, плюс и минус — масштаб, 0 — сброс.`} role="group" tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const step = width * .1;
          const next = { ...view };
          if (event.key === "+" || event.key === "=") next.zoom *= 1.4;
          else if (event.key === "-") next.zoom /= 1.4;
          else if (event.key === "0") { next.x = 500; next.y = height / 2; next.zoom = 1; }
          else if (event.key === "ArrowLeft") next.x -= step;
          else if (event.key === "ArrowRight") next.x += step;
          else if (event.key === "ArrowUp") next.y -= step;
          else if (event.key === "ArrowDown") next.y += step;
          else return;
          event.preventDefault(); animate(next);
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          cancelAnimationFrame(animation.current);
          if (!pointers.current.size) {
            moved.current = false; travel.current = 0;
            pressedRoom.current = (event.target as Element).closest("[data-room-id]")?.getAttribute("data-room-id") ?? null;
          }
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          const before = [...pointers.current.values()];
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const after = [...pointers.current.values()];
          const midpoint = (ps: Point[]) => ({ x: ps.reduce((sum, p) => sum + p.x, 0) / ps.length, y: ps.reduce((sum, p) => sum + p.y, 0) / ps.length });
          const old = midpoint(before), now = midpoint(after);
          const dx = now.x - old.x, dy = now.y - old.y;
          travel.current += Math.hypot(dx, dy);
          if (travel.current > 5 || after.length > 1) moved.current = true;
          const rect = event.currentTarget.getBoundingClientRect();
          setView((current) => {
            let next = { ...current, x: current.x - dx * baseWidth / current.zoom / rect.width, y: current.y - dy * baseWidth / current.zoom / rect.width };
            if (after.length === 2) {
              const distance = (ps: Point[]) => Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
              const oldDistance = distance(before);
              if (oldDistance > 0) next = zoomAt(next, distance(after) / oldDistance, { x: (now.x - rect.left) / rect.width - .5, y: (now.y - rect.top - rect.height / 2) / rect.width }, baseWidth, height);
            }
            return constrainView(next, height);
          });
        }} onPointerUp={endPointer} onPointerCancel={endPointer} onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}>
        <title>{`${floor.name}: помещения и лестницы`}</title>
        <polygon points={points(floor.outline)} className={styles.building} />
        {floor.corridors.map((polygon, i) => <polygon key={i} points={points(polygon)} className={styles.corridor} />)}
        {floor.rooms.map((room) => (
          <g key={room.id} data-room-id={room.id} role="button" tabIndex={0} aria-label={`${room.number ? `Кабинет ${room.number}` : room.name}. ${floor.name}. ${roomLocation(room)}`}
            aria-pressed={selected?.id === room.id} className={`${styles.room} ${room.kind === "stairs" ? styles.stairs : ""} ${selected?.id === room.id ? styles.selected : ""}`}
            onClick={(event) => { if (event.detail === 0) onSelect(room); }}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(room); } }}>
            <title>{room.number ? `Кабинет ${room.number}` : room.name}</title>
            <polygon points={points(room.polygon)} />
            {room.kind === "stairs" ? <path className={styles.stairGlyph} d={`M${room.label.x * 1000 - 9},${room.label.y * height + 9} h6 v-6 h6 v-6 h6 v-6`} /> : null}
            {room.kind === "entrance" ? <text x={room.label.x * 1000} y={room.label.y * height + 4} className={styles.roomLabel}>↥</text> : null}
            {room.number ? <text x={room.label.x * 1000} y={room.label.y * height + 4} className={styles.roomLabel}>{room.number}</text> : null}
            {selected?.id === room.id ? <circle cx={room.label.x * 1000} cy={room.label.y * height} r={3} className={styles.selectionDot} /> : null}
          </g>
        ))}
      </svg>
      <div className={styles.mapControls} aria-label="Управление картой">
        <button type="button" aria-label="Увеличить карту" disabled={view.zoom >= 5.99} onClick={() => animate({ ...view, zoom: view.zoom * 1.5 })}><Plus size={19} /></button>
        <output aria-label="Масштаб">{Math.round(view.zoom * 100)}%</output>
        <button type="button" aria-label="Уменьшить карту" disabled={view.zoom <= 1.01} onClick={() => animate({ ...view, zoom: view.zoom / 1.5 })}><Minus size={19} /></button>
        <button type="button" aria-label="Показать весь этаж" onClick={() => animate({ x: 500, y: height / 2, zoom: 1 })}><Focus size={19} /></button>
      </div>
      {selected ? <button type="button" className={styles.focusRoom} onClick={() => animate({ x: selected.label.x * 1000, y: selected.label.y * height, zoom: 3 })}><MapPin size={15} /> К выбранному месту</button> : null}
    </div>
  );
}

export function CollegeMap({ map }: { map: CampusMap }) {
  const [floorId, setFloorId] = useState(map.floors[0].id);
  const [selected, setSelected] = useState<MapRoom>();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(8);
  const floor = map.floors.find((item) => item.id === floorId) ?? map.floors[0];
  const results = query.trim() ? searchRooms(map.floors.flatMap((item) => item.rooms), query) : [];

  function selectRoom(room: MapRoom) { setFloorId(room.floorId); setSelected(room); }

  return (
    <section className={styles.mapPage}>
      <header className={styles.header}>
        <div><p className="eyebrow">Пространство колледжа</p><h1>Карта колледжа</h1><p>{map.name} · {map.address}</p></div>
        <span className={styles.version}><Layers size={15} /> {map.floors.length} этажа</span>
      </header>
      <div className={styles.searchArea}>
        <label className={styles.searchBox}><Search size={20} aria-hidden="true" /><span className="sr-only">Найти кабинет или помещение</span>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(8); }} placeholder="Кабинет, помещение или лестница" type="search" maxLength={100} autoComplete="off" />
        </label>
        <p className={styles.searchHint}>Номера и назначения кабинетов ещё не нанесены. Можно найти лестницы и выбрать помещения на схеме.</p>
        {query.trim() ? <div className={styles.results}>
          <p role="status">{results.length ? `Найдено мест: ${results.length}` : "Ничего не найдено. Номеров кабинетов пока нет на карте."}</p>
          {results.slice(0, limit).map((room) => <button key={room.id} type="button" onClick={() => { selectRoom(room); setQuery(""); }}>
            <MapPin size={17} /><span><strong>{room.number ? `Кабинет ${room.number}` : room.name}</strong><small>{map.floors.find((item) => item.id === room.floorId)?.name} · {roomLocation(room)}</small></span><ArrowUpRight size={17} />
          </button>)}
          {results.length > limit ? <button type="button" onClick={() => setLimit(limit + 12)}>Показать ещё</button> : null}
        </div> : null}
      </div>
      <div className={styles.floorBar}>
        <div className={styles.floorButtons} aria-label="Выбор этажа">{map.floors.map((item) => <button type="button" key={item.id} aria-pressed={item.id === floorId} onClick={() => { setFloorId(item.id); setSelected(undefined); }}>{item.level}<span> этаж</span></button>)}</div>
        <div className={styles.legend}><span><i />Помещения</span><span><i className={styles.stairSwatch} />Лестницы</span></div>
      </div>
      <FloorPlan key={floor.id} floor={floor} selected={selected} onSelect={selectRoom} />
      <p className={styles.gestureHint}>Перетаскивай карту, увеличивай двумя пальцами или кнопками. На компьютере — Ctrl/⌘ + прокрутка.</p>
      <div className={styles.detailsGrid}>
        <section className={`card ${styles.roomCard}`} aria-live="polite" aria-label="Выбранное место">
          <div className={styles.detailHeading}><MapPin size={21} /><h2>{selected ? (selected.number ? `Кабинет ${selected.number}` : selected.name) : "Выбери место на карте"}</h2>{selected ? <button type="button" aria-label="Снять выделение" onClick={() => setSelected(undefined)}><X size={18} /></button> : null}</div>
          {selected ? <><p>{floor.name} · {roomLocation(selected)}</p><p>{selected.note ?? "Номер, назначение и доступность помещения требуют уточнения."}</p><span className={styles.unverified}>{selected.kind === "room" ? "Номер и доступность не подтверждены" : "Доступность и переходы требуют проверки"}</span></> : <p>Нажми на помещение или лестницу — здесь появится информация о выбранном месте.</p>}
        </section>
        <section className={`card ${styles.routeCard}`}>
          <div className={styles.detailHeading}><ArrowDownToLine size={21} /><h2>Маршруты</h2></div>
          <p>Пока недоступны: нужно подтвердить входы в помещения и переходы между этажами.</p>
          <button className="button button-secondary" type="button" disabled>Построить маршрут</button>
        </section>
      </div>
      <details className={styles.mapNotes}><summary>О точности карты</summary><p>{floor.note}</p><p>Контуры перенесены с фотографий, размеры приблизительные. Назначение помещений, их доступность и связи лестниц ещё не проверены. Карта для повседневной ориентации и не заменяет официальную схему эвакуации.</p></details>
    </section>
  );
}
