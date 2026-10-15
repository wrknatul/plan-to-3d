// Furniture placement by rules and the passage check. Pure functions, no Three.js.
//
// For every item the solver enumerates positions along the walls (5 cm step) or on a grid
// (free-standing items), drops the ones that break a hard rule and ranks the rest by soft
// preferences. Items go in the room type's order; when one does not fit, the search steps
// back and tries the next-best spots of the items placed before it.
import { CATALOG, ROOM_TYPES } from './catalog.js';
import {
  distanceToBoundary,
  expandRect,
  fmt,
  pointInPolygon,
  pointInRect,
  pointRectDistance,
  pointSegmentDistance,
  rect,
  rectCenter,
  rectGap,
  rectInPolygon,
  rectsOverlap,
} from './geometry.js';

const STEP = 0.05; // candidate step along a wall
const GRID = 0.1; // candidate grid for free-standing items
const CELL = 0.025; // passage grid
const KEEP = 5; // alternative spots kept per item for backtracking
const BUDGET = 60; // ranking calls per room

// Hard rules, in the order they are checked.
export const RULES = [
  { id: 'outside', title: 'Предмет целиком в комнате, с учётом толщины стен' },
  { id: 'body', title: 'Предметы не пересекаются' },
  { id: 'door', title: 'Зона открывания двери свободна' },
  { id: 'window', title: 'Окна не закрыты мебелью выше подоконника, изголовье не под окном' },
  { id: 'passage', title: 'Нельзя встать в зону подхода к другой мебели' },
  { id: 'access', title: 'Перед предметом есть место, где встанет человек' },
  { id: 'facing', title: 'Телевизор стоит напротив дивана' },
];

export const REASON_TEXT = {
  outside: 'не помещается в комнату',
  body: 'упирается в другую мебель',
  door: 'перекрывает дверь',
  window: 'закрывает окно',
  passage: 'перекрывает подход к другой мебели',
  access: 'нет места для подхода',
  facing: 'напротив дивана места нет',
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function layoutPlan(plan, { seed = 1, jitter = 0, minPassage = 0.7 } = {}) {
  const started = performance.now();
  const ctx = { rng: mulberry32(seed), jitter, minPassage };
  const rooms = plan.rooms.map((room) => layoutRoom(room, ctx));
  const tally = {};
  const totals = { total: 0, placed: 0, missing: 0, skipped: 0, tried: 0, accessIssues: 0 };
  for (const r of rooms) {
    for (const res of r.results) {
      totals.total++;
      totals.tried += res.tried;
      for (const [k, v] of Object.entries(res.tally)) tally[k] = (tally[k] ?? 0) + v;
      if (res.ok) totals.placed++;
      else if (res.optional) totals.skipped++;
      else totals.missing++;
    }
    totals.accessIssues += r.access.issues.length;
  }
  return { rooms, tally, ...totals, ms: performance.now() - started };
}

function layoutRoom(room, ctx) {
  const keys = room.items ?? ROOM_TYPES[room.type].items;
  const budget = { calls: 0 };
  const best = solve(room, keys, 0, [], ctx, budget);
  const placed = [];
  const results = best.steps.map((step) => {
    if (!step.item) return step.result;
    const notes = explain(step.item, CATALOG[step.item.key], room, placed);
    placed.push(step.item);
    return { ...step.result, ok: true, item: step.item, score: step.score, notes };
  });
  const access = checkAccess(room, placed, ctx.minPassage);
  for (const res of results) if (res.ok) res.reachable = access.reachable.get(res.item.id) ?? false;
  return { room, results, placed, access, searched: budget.calls };
}

// Depth-first over the items: the best spot first, then the next-best ones while some
// required item is still missing and the budget lasts.
function solve(room, keys, idx, steps, ctx, budget) {
  if (idx === keys.length) return summarize(steps);
  const placed = steps.filter((s) => s.item).map((s) => s.item);
  budget.calls++;
  const ranked = rankCandidates(keys[idx], room, placed, ctx, { index: idx });
  const { options, ...result } = ranked;
  if (!options.length) {
    const top = Object.entries(result.tally).sort((a, b) => b[1] - a[1])[0];
    const failed = { ...result, ok: false, reason: top ? REASON_TEXT[top[0]] : 'нет стены нужной длины' };
    return solve(room, keys, idx + 1, [...steps, { result: failed }], ctx, budget);
  }
  let best = null;
  for (const opt of options) {
    const out = solve(room, keys, idx + 1, [...steps, { result, item: opt.item, score: opt.score }], ctx, budget);
    if (!best || better(out, best)) best = out;
    if (best.missing === 0 || budget.calls >= BUDGET) break;
  }
  return best;
}

function summarize(steps) {
  let missing = 0;
  let skipped = 0;
  let score = 0;
  for (const s of steps) {
    if (s.item) score += s.score;
    else if (s.result.optional) skipped++;
    else missing++;
  }
  return { steps, missing, skipped, score };
}

const better = (a, b) =>
  a.missing !== b.missing ? a.missing < b.missing : a.skipped !== b.skipped ? a.skipped < b.skipped : a.score > b.score;

function rankCandidates(key, room, placed, ctx, { index = 0, lookahead = true, keep = KEEP } = {}) {
  const spec = CATALOG[key];
  const tally = {};
  let tried = 0;
  const valid = [];
  for (const cand of candidates(spec, room)) {
    tried++;
    const fail = violation(cand, spec, room, placed, ctx);
    if (fail) {
      tally[fail] = (tally[fail] ?? 0) + 1;
      continue;
    }
    let score = scoreOf(cand, spec, room, placed);
    if (lookahead && spec.partner) {
      // A sofa is only good if the TV still fits opposite it.
      const probe = makeItem(key, spec, cand, room, index);
      const partner = rankCandidates(spec.partner, room, [...placed, probe], { ...ctx, jitter: 0 }, { lookahead: false, keep: 1 });
      score += partner.options.length ? 0.5 * partner.options[0].score : -4;
    }
    if (ctx.jitter) score += ctx.rng() * ctx.jitter;
    valid.push({ cand, score });
  }
  valid.sort((a, b) => b.score - a.score);
  // Keep spots that really differ, not the same one shifted by 5 cm.
  const options = [];
  for (const v of valid) {
    if (options.length >= keep) break;
    const [x, y] = rectCenter(v.cand.body);
    const twin = options.some((o) => {
      const [ox, oy] = rectCenter(o.cand.body);
      return Math.hypot(x - ox, y - oy) < 0.4 && o.cand.n[0] === v.cand.n[0] && o.cand.n[1] === v.cand.n[1];
    });
    if (!twin) options.push({ ...v, item: makeItem(key, spec, v.cand, room, index) });
  }
  return { key, name: spec.name, optional: !!spec.optional, tried, tally, options };
}

function makeItem(key, spec, cand, room, index) {
  return {
    id: `${room.id}/${index}`,
    key,
    name: spec.name,
    room: room.id,
    body: cand.body,
    zone: cand.zone,
    n: cand.n,
    w: cand.w,
    d: cand.d,
    h: spec.h,
    free: !!spec.free,
    edge: cand.edge ?? null,
    s: cand.s ?? null,
    sinkAt: key === 'counter' ? sinkPoint(cand) : null,
  };
}

function* candidates(spec, room) {
  if (spec.free) {
    const box = room.innerBox;
    const orientations = [
      [spec.w, spec.d, [0, 1]],
      [spec.d, spec.w, [1, 0]],
    ];
    for (const [bw, bh, n] of orientations) {
      for (let cx = box.x0 + bw / 2; cx <= box.x1 - bw / 2 + 1e-9; cx += GRID) {
        for (let cy = box.y0 + bh / 2; cy <= box.y1 - bh / 2 + 1e-9; cy += GRID) {
          const body = rect(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2);
          yield { body, zone: expandRect(body, spec.clearAll ?? 0), n, w: spec.w, d: spec.d };
        }
      }
    }
    return;
  }
  for (const w of spec.widths ?? [spec.w]) {
    for (const edge of room.edges) {
      const lo = edge.lo + w / 2;
      const hi = edge.hi - w / 2;
      if (hi < lo - 1e-9) continue;
      const positions = [];
      for (let k = 0; lo + k * STEP <= hi + 1e-9; k++) positions.push(lo + k * STEP);
      if (hi - positions[positions.length - 1] > 1e-6) positions.push(hi);
      for (const s of positions) yield wallCandidate(edge, s, w, spec);
    }
  }
}

function wallCandidate(edge, s, w, spec) {
  const [nx, ny] = edge.n;
  const d = spec.d;
  const clear = spec.clearFront ?? 0;
  let body;
  let zone = null;
  if (edge.orient === 'h') {
    const front = edge.c + ny * d;
    body = rect(s - w / 2, edge.c, s + w / 2, front);
    if (clear) zone = rect(s - w / 2, front, s + w / 2, front + ny * clear);
  } else {
    const front = edge.c + nx * d;
    body = rect(edge.c, s - w / 2, front, s + w / 2);
    if (clear) zone = rect(front, s - w / 2, front + nx * clear, s + w / 2);
  }
  return { edge, s, w, d, body, zone, n: edge.n };
}

// Returns the first broken hard rule, or null.
function violation(c, spec, room, placed, ctx) {
  if (!rectInPolygon(c.body, room.inner)) return 'outside';
  for (const p of placed) if (rectsOverlap(c.body, p.body)) return 'body';
  for (const z of room.doorZones) if (rectsOverlap(c.body, z.rect)) return 'door';
  for (const z of room.windowZones) {
    if ((spec.avoidWindow || spec.h > z.sill + 1e-9) && rectsOverlap(c.body, z.rect)) return 'window';
  }
  for (const p of placed) if (p.zone && rectsOverlap(c.body, p.zone)) return 'passage';
  if (c.zone) {
    if (!rectInPolygon(c.zone, room.inner)) return 'access';
    for (const p of placed) if (rectsOverlap(c.zone, p.body)) return 'access';
  }
  if (!spec.free && !standingSpot(c, room, placed, ctx.minPassage / 2)) return 'access';
  if (spec.faces) {
    const other = placed.find((p) => p.key === spec.faces);
    if (other && !relation(c, other).facing) return 'facing';
  }
  return null;
}

// Somewhere along the front of the item a person of the passage width can stand.
function standingSpot(c, room, placed, r) {
  const [nx, ny] = c.n;
  const b = c.body;
  const gap = r + 0.02;
  const spots = [];
  if (nx === 0) {
    const y = (ny > 0 ? b.y1 : b.y0) + ny * gap;
    for (let x = b.x0; x <= b.x1 + 1e-9; x += STEP) spots.push([x, y]);
  } else {
    const x = (nx > 0 ? b.x1 : b.x0) + nx * gap;
    for (let y = b.y0; y <= b.y1 + 1e-9; y += STEP) spots.push([x, y]);
  }
  return spots.some(
    (p) =>
      pointInPolygon(p, room.inner) &&
      distanceToBoundary(p, room.inner) >= r &&
      placed.every((o) => pointRectDistance(p, o.body) >= r),
  );
}

function scoreOf(c, spec, room, placed) {
  const pref = spec.prefer ?? {};
  const center = rectCenter(c.body);
  let score = 0;
  if (spec.widths) score += c.w * 1.5;
  if (pref.corner && c.edge && inCorner(c, room)) score += 1;
  if (pref.center && c.edge) {
    const half = (c.edge.hi - c.edge.lo) / 2;
    score += 1 - Math.abs(c.s - (c.edge.lo + c.edge.hi) / 2) / half;
  }
  if (pref.farFromDoor) score += Math.min(nearest(center, room.doorPoints.map((d) => d.at)), 5) * 0.4;
  if (spec.avoidDoorWall && c.edge?.hasDoor) score -= 1.5;
  if (pref.window) score += underWindow(c) ? 2 : 1 / (1 + nearest(center, room.windowPoints));
  if (pref.nextTo) {
    const other = placed.find((p) => p.key === pref.nextTo);
    if (other && rectGap(c.body, other.body) < 0.02) score += 2.5;
  }
  if (spec.faces) {
    const other = placed.find((p) => p.key === spec.faces);
    if (other) {
      const rel = relation(c, other);
      score += 4 - rel.lateral * 1.2 - Math.abs(rel.distance - 3) * 0.4;
    }
  }
  if (spec.free) score -= Math.hypot(center[0] - room.label[0], center[1] - room.label[1]) * 0.3;
  return score;
}

function explain(item, spec, room, placed) {
  const notes = [];
  const center = rectCenter(item.body);
  if (item.free) notes.push(`стоит свободно, вокруг ${fmt(spec.clearAll)} м под стулья и проход`);
  if (item.edge && inCorner(item, room)) notes.push('в углу');
  if (item.edge && underWindow(item)) notes.push(item.key === 'counter' ? 'мойка под окном' : 'под окном');
  if (spec.widths) {
    const max = Math.max(...spec.widths);
    notes.push(item.w < max ? `длина ${fmt(item.w)} м — длиннее не встаёт` : `длина ${fmt(item.w)} м`);
  }
  if (spec.prefer?.nextTo) {
    const other = placed.find((p) => p.key === spec.prefer.nextTo);
    if (other && rectGap(item.body, other.body) < 0.02) notes.push(`вплотную к: ${other.name.toLowerCase()}`);
  }
  if (spec.faces) {
    const other = placed.find((p) => p.key === spec.faces);
    if (other) {
      const rel = relation(item, other);
      notes.push(`напротив: ${other.name.toLowerCase()}, ${fmt(rel.distance, 1)} м`);
    }
  }
  if (spec.partner) notes.push('место выбрано с учётом, куда встанет телевизор');
  if (spec.prefer?.farFromDoor && room.doorPoints.length) {
    notes.push(`${fmt(nearest(center, room.doorPoints.map((d) => d.at)), 1)} м до двери`);
  }
  if (spec.avoidDoorWall && item.edge && !item.edge.hasDoor) notes.push('не на стене с дверью');
  if (spec.avoidWindow) notes.push('изголовье не под окном');
  return notes;
}

function nearest(p, points) {
  let d = 10;
  for (const q of points) d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return d;
}

function inCorner(c, room) {
  const b = c.body;
  const m = 0.02;
  const pts =
    c.edge.orient === 'h'
      ? [
          [b.x0 - m, (b.y0 + b.y1) / 2],
          [b.x1 + m, (b.y0 + b.y1) / 2],
        ]
      : [
          [(b.x0 + b.x1) / 2, b.y0 - m],
          [(b.x0 + b.x1) / 2, b.y1 + m],
        ];
  return pts.some((p) => !pointInPolygon(p, room.inner));
}

function windowUnder(c) {
  if (!c.edge) return null;
  const lo = c.s - c.w / 2;
  const hi = c.s + c.w / 2;
  return (
    c.edge.openings.find((o) => o.kind === 'window' && Math.min(hi, o.hi) - Math.max(lo, o.lo) >= Math.min(0.3, o.hi - o.lo)) ??
    null
  );
}

const underWindow = (c) => windowUnder(c) !== null;

// Plan point of the sink: under the window when the counter runs under one.
function sinkPoint(c) {
  const win = windowUnder(c);
  if (!win || !c.edge) return null;
  const along = Math.min(Math.max(win.center, c.s - c.w / 2 + 0.35), c.s + c.w / 2 - 0.35);
  const [cx, cy] = rectCenter(c.body);
  return c.edge.orient === 'h' ? [along, cy] : [cx, along];
}

function relation(c, other) {
  const facing = c.n[0] * other.n[0] + c.n[1] * other.n[1] < -0.9;
  const [cx, cy] = rectCenter(c.body);
  const [ox, oy] = rectCenter(other.body);
  const alongX = c.n[0] === 0;
  const lateral = alongX ? Math.abs(cx - ox) : Math.abs(cy - oy);
  const distance = (alongX ? Math.abs(cy - oy) : Math.abs(cx - ox)) - (c.d + other.d) / 2;
  return { facing, lateral, distance };
}

// Breadth-first search over a 2.5 cm grid. A cell is walkable when a person of width
// minPassage fits there: its distance to walls and furniture is at least half of that.
export function checkAccess(room, placed, minPassage) {
  const r = Math.max(0.05, minPassage / 2 - CELL / 2);
  const box = room.innerBox;
  const cols = Math.max(1, Math.round((box.x1 - box.x0) / CELL));
  const rows = Math.max(1, Math.round((box.y1 - box.y0) / CELL));
  const cw = (box.x1 - box.x0) / cols;
  const ch = (box.y1 - box.y0) / rows;
  const state = new Uint8Array(cols * rows); // 0 blocked, 1 too narrow, 2 walkable, 3 reached from a door
  const edges = room.inner.map((a, i) => [a, room.inner[(i + 1) % room.inner.length]]);
  const centerOf = (i, j) => [box.x0 + (i + 0.5) * cw, box.y0 + (j + 0.5) * ch];

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = centerOf(i, j);
      if (!pointInPolygon(p, room.inner) || placed.some((it) => pointInRect(p, it.body))) continue;
      let d = Infinity;
      for (const [a, b] of edges) d = Math.min(d, pointSegmentDistance(p, a, b));
      for (const it of placed) d = Math.min(d, pointRectDistance(p, it.body));
      state[j * cols + i] = d >= r ? 2 : 1;
    }
  }

  const queue = [];
  const doors = room.doorPoints.map((door) => {
    const p = [door.at[0] + door.n[0] * (r + 0.05), door.at[1] + door.n[1] * (r + 0.05)];
    const start = nearestCell(p, 0.15);
    if (start >= 0 && state[start] === 2) {
      state[start] = 3;
      queue.push(start);
    }
    return { label: door.label, ok: start >= 0 };
  });
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    const i = k % cols;
    const j = (k - i) / cols;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      if (state[nk] === 2) {
        state[nk] = 3;
        queue.push(nk);
      }
    }
  }

  const reachable = new Map();
  const issues = [];
  for (const it of placed) {
    const ok = itemReachable(it);
    reachable.set(it.id, ok);
    if (!ok) issues.push(`${it.name}: не подойти, проход уже ${fmt(minPassage)} м`);
  }
  for (const d of doors) if (!d.ok) issues.push(`${d.label}: у двери проход уже ${fmt(minPassage)} м`);
  if (!room.doorPoints.length) issues.push('В комнате нет двери');
  return { reachable, doors, issues, radius: r, grid: { x0: box.x0, y0: box.y0, cols, rows, cw, ch, state } };

  function nearestCell(p, maxDist) {
    let best = -1;
    let bestD = maxDist;
    const i0 = Math.floor((p[0] - box.x0) / cw);
    const j0 = Math.floor((p[1] - box.y0) / ch);
    const span = Math.ceil(maxDist / CELL);
    for (let j = j0 - span; j <= j0 + span; j++) {
      for (let i = i0 - span; i <= i0 + span; i++) {
        if (i < 0 || j < 0 || i >= cols || j >= rows || state[j * cols + i] < 2) continue;
        const c = centerOf(i, j);
        const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
        if (d <= bestD) {
          bestD = d;
          best = j * cols + i;
        }
      }
    }
    return best;
  }

  // Someone can stand right in front of the item (or next to a free-standing one).
  function itemReachable(it) {
    const reach = r + 0.15;
    let area;
    if (it.free) area = expandRect(it.body, reach);
    else {
      const [nx, ny] = it.n;
      const b = it.body;
      if (nx === 0) {
        const front = ny > 0 ? b.y1 : b.y0;
        area = rect(b.x0, front, b.x1, front + ny * reach);
      } else {
        const front = nx > 0 ? b.x1 : b.x0;
        area = rect(front, b.y0, front + nx * reach, b.y1);
      }
    }
    const i0 = Math.max(0, Math.floor((area.x0 - box.x0) / cw));
    const i1 = Math.min(cols - 1, Math.floor((area.x1 - box.x0) / cw));
    const j0 = Math.max(0, Math.floor((area.y0 - box.y0) / ch));
    const j1 = Math.min(rows - 1, Math.floor((area.y1 - box.y0) / ch));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (state[j * cols + i] === 3 && pointInRect(centerOf(i, j), area)) return true;
      }
    }
    return false;
  }
}
