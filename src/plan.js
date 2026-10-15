// Turns the raw JSON plan into rooms, walls and openings the layout and the 3D scene work with.
import { CATALOG, ROOM_TYPES } from './catalog.js';
import {
  EPS,
  boundingBox,
  fmt,
  insetOrthogonal,
  inwardNormal,
  isOrthogonal,
  labelPoint,
  pointInPolygon,
  polygonArea,
  polygonEdges,
  rect,
  removeCollinear,
  round,
  signedArea,
} from './geometry.js';

export const WALL_THICKNESS = { exterior: 0.25, interior: 0.1 };
const DOOR_TOP = 2.1;
const WINDOW_SILL = 0.85;
const WINDOW_TOP = 2.2;
const WINDOW_ZONE_DEPTH = 0.35;
const LINE_TOL = 0.03;
const TOL = 1e-3;

const near = (a, b, tol = TOL) => Math.abs(a - b) < tol;
const at = ([x, y]) => `(${fmt(x)}; ${fmt(y)})`;

export function preparePlan(raw, { height } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['Ожидается JSON-объект с полями rooms, doors, windows'] };
  }
  const H = Math.min(4, Math.max(2.2, Number(height ?? raw.height ?? 2.7) || 2.7));

  const rooms = parseRooms(raw, errors);
  if (!errors.length) checkOverlaps(rooms, errors);
  if (errors.length) return { errors };

  const walls = buildWalls(rooms, errors);
  if (errors.length) return { errors };

  const openings = attachOpenings(raw, walls, errors, H);
  if (errors.length) return { errors };

  adjustWallEnds(walls);
  const byId = new Map(rooms.map((r) => [r.id, r]));
  for (const room of rooms) describeRoom(room, walls, openings, byId);

  const warnings = rooms.filter((r) => !r.doorPoints.length).map((r) => `${r.name}: нет ни одной двери`);
  return {
    name: typeof raw.name === 'string' ? raw.name : 'План',
    height: H,
    rooms,
    walls,
    openings,
    bounds: boundingBox(rooms.flatMap((r) => r.polygon)),
    errors: [],
    warnings,
  };
}

function parseRooms(raw, errors) {
  const list = Array.isArray(raw.rooms) ? raw.rooms : [];
  if (!list.length) errors.push('Нет ни одной комнаты (rooms)');
  const ids = new Set();
  const rooms = [];
  list.forEach((r, idx) => {
    const label = r?.name || r?.id || `#${idx + 1}`;
    if (!r || typeof r.id !== 'string' || !r.id) return errors.push(`Комната ${label}: нужен строковый id`);
    if (ids.has(r.id)) return errors.push(`Комната ${label}: id «${r.id}» повторяется`);
    ids.add(r.id);
    if (!ROOM_TYPES[r.type]) {
      return errors.push(`Комната ${label}: неизвестный тип «${r.type}», есть ${Object.keys(ROOM_TYPES).join(', ')}`);
    }
    const okPoints =
      Array.isArray(r.polygon) &&
      r.polygon.length >= 4 &&
      r.polygon.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
    if (!okPoints) return errors.push(`Комната ${label}: polygon — массив точек [x, y], минимум 4`);
    const polygon = removeCollinear(r.polygon.map(([x, y]) => [round(x), round(y)]));
    if (polygon.length < 4 || !isOrthogonal(polygon)) {
      return errors.push(`Комната ${label}: стены должны идти под прямым углом, по осям x и y`);
    }
    if (polygonArea(polygon) < 1) return errors.push(`Комната ${label}: площадь меньше 1 м²`);
    if (r.items !== undefined && (!Array.isArray(r.items) || r.items.some((k) => !CATALOG[k]))) {
      return errors.push(`Комната ${label}: items — список из ${Object.keys(CATALOG).join(', ')}`);
    }
    rooms.push({
      id: r.id,
      type: r.type,
      name: typeof r.name === 'string' && r.name ? r.name : ROOM_TYPES[r.type].name,
      polygon,
      items: r.items,
    });
  });
  return rooms;
}

// Sample points of each room must not fall inside another room.
function checkOverlaps(rooms, errors) {
  for (let a = 0; a < rooms.length; a++) {
    const A = rooms[a];
    const bb = boundingBox(A.polygon);
    const samples = [];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const p = [bb.x0 + ((bb.x1 - bb.x0) * (i + 0.5)) / 8, bb.y0 + ((bb.y1 - bb.y0) * (j + 0.5)) / 8];
        if (pointInPolygon(p, A.polygon)) samples.push(p);
      }
    }
    for (let b = a + 1; b < rooms.length; b++) {
      if (samples.some((p) => pointInPolygon(p, rooms[b].polygon))) {
        errors.push(`Комнаты «${A.name}» и «${rooms[b].name}» перекрываются`);
      }
    }
  }
}

// Every room edge lies on a horizontal or vertical line. Pieces of a line covered by two rooms are
// interior walls, pieces covered by one room are exterior walls.
export function buildWalls(rooms, errors = []) {
  const lines = new Map();
  for (const room of rooms) {
    for (const e of polygonEdges(room.polygon)) {
      const key = `${e.orient}:${e.c.toFixed(3)}`;
      if (!lines.has(key)) lines.set(key, { orient: e.orient, c: e.c, spans: [] });
      lines.get(key).spans.push({ room: room.id, lo: e.lo, hi: e.hi });
    }
  }
  const walls = [];
  for (const line of lines.values()) {
    const cuts = [...new Set(line.spans.flatMap((s) => [s.lo, s.hi]).map((v) => round(v)))].sort((a, b) => a - b);
    let current = null;
    for (let k = 0; k + 1 < cuts.length; k++) {
      const lo = cuts[k];
      const hi = cuts[k + 1];
      const ids = line.spans.filter((s) => s.lo <= lo + TOL && s.hi >= hi - TOL).map((s) => s.room).sort();
      if (!ids.length) {
        current = null;
        continue;
      }
      if (ids.length > 2) {
        errors.push(`Комнаты ${ids.join(', ')} делят один отрезок стены — проверьте контуры`);
        return walls;
      }
      const kind = ids.length === 2 ? 'interior' : 'exterior';
      const sig = ids.join('|');
      if (current && current.sig === sig && near(current.to, lo)) {
        current.to = hi;
        continue;
      }
      current = {
        id: `w${walls.length + 1}`,
        orient: line.orient,
        c: line.c,
        from: lo,
        to: hi,
        kind,
        rooms: ids,
        sig,
        thickness: WALL_THICKNESS[kind],
        openings: [],
      };
      walls.push(current);
    }
  }
  return walls;
}

function attachOpenings(raw, walls, errors, H) {
  const list = [];
  const add = (o, kind, idx) => {
    const title = kind === 'door' ? 'Дверь' : 'Окно';
    const valid = o && Array.isArray(o.at) && o.at.length === 2 && o.at.every(Number.isFinite) && o.width > 0;
    if (!valid) return errors.push(`${title} #${idx + 1}: нужны поля at: [x, y] и width`);
    const [x, y] = o.at;
    let wall = null;
    let bestD = Infinity;
    for (const w of walls) {
      const along = w.orient === 'h' ? x : y;
      const d = Math.abs((w.orient === 'h' ? y : x) - w.c);
      if (d <= LINE_TOL && along >= w.from - EPS && along <= w.to + EPS && d < bestD) {
        wall = w;
        bestD = d;
      }
    }
    if (!wall) return errors.push(`${title} ${at(o.at)} не лежит ни на одной стене`);
    const center = wall.orient === 'h' ? x : y;
    const lo = center - o.width / 2;
    const hi = center + o.width / 2;
    if (lo < wall.from - TOL || hi > wall.to + TOL) {
      return errors.push(`${title} ${at(o.at)} шириной ${fmt(o.width)} м не помещается в стену ${fmt(wall.to - wall.from)} м`);
    }
    if (kind === 'window' && wall.kind !== 'exterior') return errors.push(`Окно ${at(o.at)} стоит на внутренней стене`);
    if (wall.openings.some((p) => lo < p.hi - TOL && p.lo < hi - TOL)) {
      return errors.push(`${title} ${at(o.at)} пересекается с соседним проёмом`);
    }
    const sill = kind === 'door' ? 0 : Math.max(0, Number(o.sill ?? WINDOW_SILL) || 0);
    const top = kind === 'door' ? DOOR_TOP : Number(o.top ?? WINDOW_TOP) || WINDOW_TOP;
    const opening = {
      id: `${kind}${list.length + 1}`,
      kind,
      wallId: wall.id,
      orient: wall.orient,
      c: wall.c,
      center,
      width: o.width,
      lo,
      hi,
      sill,
      top: Math.min(top, H - 0.1),
      rooms: wall.rooms,
    };
    wall.openings.push(opening);
    list.push(opening);
  };
  (Array.isArray(raw.doors) ? raw.doors : []).forEach((o, i) => add(o, 'door', i));
  (Array.isArray(raw.windows) ? raw.windows : []).forEach((o, i) => add(o, 'window', i));
  for (const w of walls) w.openings.sort((a, b) => a.lo - b.lo);
  return list;
}

// Wall boxes are drawn on the center line. At an L-corner the horizontal wall grows to cover the
// corner square and the vertical one stops at its face, so there are no gaps and no doubled faces.
function adjustWallEnds(walls) {
  for (const w of walls) {
    w.renderFrom = w.from;
    w.renderTo = w.to;
    for (const end of ['from', 'to']) {
      const p = w[end];
      const collinear = walls.some(
        (o) => o !== w && o.orient === w.orient && near(o.c, w.c) && (near(o.from, p) || near(o.to, p)),
      );
      if (collinear) continue;
      const perps = walls.filter(
        (o) => o.orient !== w.orient && near(o.c, p) && o.from <= w.c + TOL && o.to >= w.c - TOL,
      );
      if (!perps.length) continue;
      const before = perps.some((o) => o.from < w.c - TOL);
      const after = perps.some((o) => o.to > w.c + TOL);
      if (before && after) continue; // T-junction: the end already sits inside the crossing wall
      const half = Math.max(...perps.map((o) => o.thickness)) / 2;
      const delta = w.orient === 'h' ? half : -(half - 0.002);
      if (end === 'from') w.renderFrom -= delta;
      else w.renderTo += delta;
    }
  }
}

function describeRoom(room, walls, openings, byId) {
  const poly = room.polygon;
  const orientation = Math.sign(signedArea(poly));
  const src = polygonEdges(poly);
  const insets = src.map((e) => {
    const ts = walls
      .filter((w) => w.orient === e.orient && near(w.c, e.c) && w.from < e.hi - TOL && w.to > e.lo + TOL)
      .map((w) => w.thickness);
    return Math.max(WALL_THICKNESS.interior, ...ts) / 2;
  });
  room.inner = insetOrthogonal(poly, insets);
  room.innerBox = boundingBox(room.inner);
  room.area = polygonArea(room.inner);
  room.label = labelPoint(room.inner);
  room.doorZones = [];
  room.windowZones = [];
  room.doorPoints = [];
  room.windowPoints = [];
  room.edges = polygonEdges(room.inner).map((e, i) => {
    const s = src[i];
    const n = inwardNormal(room.inner[i], room.inner[(i + 1) % room.inner.length], orientation);
    const ops = openings.filter(
      (o) =>
        o.rooms.includes(room.id) &&
        o.orient === s.orient &&
        near(o.c, s.c) &&
        o.center > s.lo - TOL &&
        o.center < s.hi + TOL,
    );
    const edge = { ...e, index: i, n, openings: ops, hasDoor: ops.some((o) => o.kind === 'door') };
    for (const o of ops) {
      const depth = o.kind === 'door' ? o.width : WINDOW_ZONE_DEPTH;
      const zone =
        e.orient === 'h' ? rect(o.lo, e.c, o.hi, e.c + n[1] * depth) : rect(e.c, o.lo, e.c + n[0] * depth, o.hi);
      const point = e.orient === 'h' ? [o.center, e.c] : [e.c, o.center];
      if (o.kind === 'door') {
        const other = o.rooms.find((id) => id !== room.id);
        room.doorZones.push({ rect: zone, opening: o });
        room.doorPoints.push({
          at: point,
          n,
          width: o.width,
          label: other ? `Дверь ↔ ${byId.get(other).name}` : 'Входная дверь',
        });
      } else {
        room.windowZones.push({ rect: zone, sill: o.sill, opening: o });
        room.windowPoints.push(point);
      }
    }
    return edge;
  });
}
