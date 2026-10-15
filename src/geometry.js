// Plane geometry for orthogonal floor plans.
// Plan coordinates are meters: x grows to the right, y grows down the sheet.

export const EPS = 1e-6;

export const round = (v, digits = 3) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

export const fmt = (v, digits = 2) => String(round(v, digits)).replace('.', ',');

export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export const polygonArea = (poly) => Math.abs(signedArea(poly));

// Ray casting. Points exactly on the boundary are ambiguous, so callers test shrunken shapes.
export function pointInPolygon([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Drops repeated points and points that lie on a straight run.
export function removeCollinear(poly) {
  const pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return Math.abs(p[0] - q[0]) > EPS || Math.abs(p[1] - q[1]) > EPS;
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) < EPS) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

export function isOrthogonal(poly) {
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const horizontal = Math.abs(a[1] - b[1]) < EPS;
    const vertical = Math.abs(a[0] - b[0]) < EPS;
    return horizontal !== vertical;
  });
}

// Edge i goes from poly[i] to poly[i + 1]. `c` is the fixed coordinate, [lo, hi] the span along the edge.
export function polygonEdges(poly) {
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const orient = Math.abs(a[1] - b[1]) < 1e-9 ? 'h' : 'v';
    const along = orient === 'h' ? [a[0], b[0]] : [a[1], b[1]];
    return {
      a,
      b,
      orient,
      c: orient === 'h' ? a[1] : a[0],
      lo: Math.min(...along),
      hi: Math.max(...along),
    };
  });
}

// Unit normal pointing into the polygon; orientation is the sign of signedArea.
export function inwardNormal(a, b, orientation) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / len;
  const dy = (b[1] - a[1]) / len;
  return [-dy * orientation, dx * orientation].map((v) => (Math.abs(v) < EPS ? 0 : v));
}

// Moves every edge of an orthogonal polygon inwards by its own distance.
export function insetOrthogonal(poly, insets) {
  const orientation = Math.sign(signedArea(poly));
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const [nx, ny] = inwardNormal(a, b, orientation);
    return Math.abs(a[1] - b[1]) < EPS
      ? { orient: 'h', v: a[1] + ny * insets[i] }
      : { orient: 'v', v: a[0] + nx * insets[i] };
  });
  return poly.map((_, i) => {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    return prev.orient === 'v' ? [prev.v, cur.v] : [cur.v, prev.v];
  });
}

export const rect = (x0, y0, x1, y1) => ({
  x0: Math.min(x0, x1),
  y0: Math.min(y0, y1),
  x1: Math.max(x0, x1),
  y1: Math.max(y0, y1),
});

// Touching rectangles do not overlap.
export const rectsOverlap = (a, b, eps = 1e-3) =>
  a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;

export const rectCenter = (r) => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];

export const expandRect = (r, m) => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m });

export const pointInRect = ([x, y], r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;

export function rectGap(a, b) {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  return Math.hypot(dx, dy);
}

export function pointRectDistance([x, y], r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dy = Math.max(r.y0 - y, 0, y - r.y1);
  return Math.hypot(dx, dy);
}

export function pointSegmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToBoundary(p, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, pointSegmentDistance(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

// For an orthogonal polygon and an axis-aligned rect: corners inside and no polygon vertex inside
// means the rect is fully inside.
export function rectInPolygon(r, poly, eps = 1e-4) {
  const s = { x0: r.x0 + eps, y0: r.y0 + eps, x1: r.x1 - eps, y1: r.y1 - eps };
  if (s.x0 >= s.x1 || s.y0 >= s.y1) return false;
  const corners = [
    [s.x0, s.y0],
    [s.x1, s.y0],
    [s.x1, s.y1],
    [s.x0, s.y1],
  ];
  if (!corners.every((p) => pointInPolygon(p, poly))) return false;
  return !poly.some((p) => pointInRect(p, s));
}

export function boundingBox(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// The inside point farthest from the walls: a good spot for a room label in L-shaped rooms too.
export function labelPoint(poly) {
  const bb = boundingBox(poly);
  const N = 24;
  let best = null;
  let bestD = -1;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const p = [bb.x0 + ((bb.x1 - bb.x0) * i) / N, bb.y0 + ((bb.y1 - bb.y0) * j) / N];
      if (!pointInPolygon(p, poly)) continue;
      const d = distanceToBoundary(p, poly);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best ?? rectCenter(bb);
}
