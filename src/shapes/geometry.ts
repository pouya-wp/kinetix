import type { PathData } from '../core/state';
import type { Vec } from '../core/math';

export type Poly = Vec[];
const K = 0.5522847498; // circle kappa

// ───────── primitives (centred on 0,0) ─────────
export function rectPath(w: number, h: number, r = 0): PathData {
  const x = w / 2, y = h / 2;
  r = Math.max(0, Math.min(r, x, y));
  if (r < 0.01) return { v: [[x, -y], [x, y], [-x, y], [-x, -y]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], closed: true };
  const k = r * K;
  // 8 vertices, clockwise from top-right corner start
  const v: Vec[] = [[x - r, -y], [x, -y + r], [x, y - r], [x - r, y], [-x + r, y], [-x, y - r], [-x, -y + r], [-x + r, -y]];
  const i: Vec[] = [[-0, 0], [0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0]];
  const o: Vec[] = [[k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k], [0, 0]];
  i[0] = [-0, 0];
  return { v, i, o, closed: true };
}

export function ellipsePath(w: number, h: number): PathData {
  const a = w / 2, b = h / 2;
  return {
    v: [[0, -b], [a, 0], [0, b], [-a, 0]],
    i: [[-a * K, 0], [0, -b * K], [a * K, 0], [0, b * K]],
    o: [[a * K, 0], [0, b * K], [-a * K, 0], [0, -b * K]],
    closed: true,
  };
}

export function polygonPath(r: number, sides: number, round = 0): PathData {
  const v: Vec[] = [];
  for (let s = 0; s < sides; s++) {
    const a = -Math.PI / 2 + (s / sides) * Math.PI * 2;
    v.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return roundCorners(v, round);
}

export function starPath(r1: number, r2: number, points: number, round = 0): PathData {
  const v: Vec[] = [];
  for (let s = 0; s < points * 2; s++) {
    const a = -Math.PI / 2 + (s / (points * 2)) * Math.PI * 2;
    const r = s % 2 ? r2 : r1;
    v.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return roundCorners(v, round);
}

export function heartPath(size: number): PathData {
  const k = size / 100;
  const P = (x: number, y: number): Vec => [x * k, y * k];
  return {
    v: [P(0, -20), P(48, -12), P(0, 50), P(-48, -12)],
    i: [P(-10, -30), P(0, -38), P(24, -22), P(0, 26)],
    o: [P(10, -30), P(0, 26), P(-24, -22), P(0, -38)],
    closed: true,
  };
}

export function blobPath(r: number, lobes = 5, seed = 1, amt = 0.22): PathData {
  const n = lobes * 2;
  const pts: Vec[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const rr = r * (1 - amt + rnd() * amt * 2);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return smoothPath(pts, true);
}

/** Polygon with rounded corners as bezier path (round in 0..1). */
export function roundCorners(pts: Vec[], round: number): PathData {
  const n = pts.length;
  if (round <= 0.001) return { v: pts.map((p) => [...p] as Vec), i: pts.map(() => [0, 0] as Vec), o: pts.map(() => [0, 0] as Vec), closed: true };
  const v: Vec[] = [], ii: Vec[] = [], oo: Vec[] = [];
  for (let k = 0; k < n; k++) {
    const p = pts[k], a = pts[(k - 1 + n) % n], b = pts[(k + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(da, db) * 0.5 * round;
    const ua: Vec = [(a[0] - p[0]) / da, (a[1] - p[1]) / da], ub: Vec = [(b[0] - p[0]) / db, (b[1] - p[1]) / db];
    const p1: Vec = [p[0] + ua[0] * r, p[1] + ua[1] * r], p2: Vec = [p[0] + ub[0] * r, p[1] + ub[1] * r];
    const h = r * K;
    v.push(p1); ii.push([0, 0]); oo.push([-ua[0] * h, -ua[1] * h]);
    v.push(p2); ii.push([-ub[0] * h, -ub[1] * h]); oo.push([0, 0]);
  }
  return { v, i: ii, o: oo, closed: true };
}

/** Catmull-Rom style smooth bezier through points. */
export function smoothPath(pts: Vec[], closed = true, tension = 1): PathData {
  const n = pts.length;
  const v: Vec[] = [], ii: Vec[] = [], oo: Vec[] = [];
  for (let k = 0; k < n; k++) {
    const p = pts[k];
    const a = pts[closed ? (k - 1 + n) % n : Math.max(0, k - 1)];
    const b = pts[closed ? (k + 1) % n : Math.min(n - 1, k + 1)];
    const tx = ((b[0] - a[0]) / 6) * tension, ty = ((b[1] - a[1]) / 6) * tension;
    v.push([p[0], p[1]]);
    ii.push([-tx, -ty]);
    oo.push([tx, ty]);
  }
  if (!closed && n) { ii[0] = [0, 0]; oo[n - 1] = [0, 0]; }
  return { v, i: ii, o: oo, closed };
}

// ───────── flatten / resample ─────────
function bez(p0: Vec, c1: Vec, c2: Vec, p1: Vec, t: number): Vec {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
  ];
}

export function flatten(p: PathData, perSeg = 16): Poly {
  const out: Poly = [];
  const n = p.v.length;
  if (!n) return out;
  const segs = p.closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const a = p.v[k], b = p.v[(k + 1) % n];
    const c1: Vec = [a[0] + p.o[k][0], a[1] + p.o[k][1]];
    const c2: Vec = [b[0] + p.i[(k + 1) % n][0], b[1] + p.i[(k + 1) % n][1]];
    const straight = !p.o[k][0] && !p.o[k][1] && !p.i[(k + 1) % n][0] && !p.i[(k + 1) % n][1];
    const steps = straight ? 1 : perSeg;
    for (let s = 0; s < steps; s++) out.push(straight ? [a[0], a[1]] : bez(a, c1, c2, b, s / steps));
  }
  if (!p.closed) out.push([...p.v[n - 1]] as Vec);
  return out;
}

export function perimeter(poly: Poly, closed = true) {
  let L = 0;
  const n = poly.length;
  for (let k = 0; k < (closed ? n : n - 1); k++) {
    const a = poly[k], b = poly[(k + 1) % n];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

/** Resample a polyline to n points evenly spaced by arc length. */
export function resample(poly: Poly, n: number, closed = true): Poly {
  const m = poly.length;
  if (m === 0) return Array.from({ length: n }, () => [0, 0] as Vec);
  const segs = closed ? m : m - 1;
  const cum = new Float64Array(segs + 1);
  for (let k = 0; k < segs; k++) {
    const a = poly[k], b = poly[(k + 1) % m];
    cum[k + 1] = cum[k] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const L = cum[segs];
  if (m === 1 || L < 1e-9) return Array.from({ length: n }, () => [poly[0][0], poly[0][1]] as Vec);
  const out: Poly = [];
  const step = L / (closed ? n : Math.max(1, n - 1));
  let k = 0;
  for (let j = 0; j < n; j++) {
    const d = Math.min(L, j * step);
    while (k < segs - 1 && cum[k + 1] < d) k++;
    const a = poly[k], b = poly[(k + 1) % m];
    const len = cum[k + 1] - cum[k];
    const u = len > 0 ? (d - cum[k]) / len : 0;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

export function signedArea(poly: Poly) {
  let a = 0;
  for (let k = 0, n = poly.length; k < n; k++) {
    const p = poly[k], q = poly[(k + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function centroid(poly: Poly): Vec {
  let cx = 0, cy = 0, a = 0;
  for (let k = 0, n = poly.length; k < n; k++) {
    const p = poly[k], q = poly[(k + 1) % n];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (const p of poly) { sx += p[0]; sy += p[1]; }
    return [sx / (poly.length || 1), sy / (poly.length || 1)];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function bbox(poly: Poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Clockwise (in screen space, y down) orientation for consistent morphing. */
export function orientCW(poly: Poly): Poly {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

export function pointInPoly(p: Vec, poly: Poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function transformPoly(poly: Poly, x: number, y: number, rotDeg: number, sx: number, sy: number): Poly {
  const r = (rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return poly.map((p) => {
    const px = p[0] * sx, py = p[1] * sy;
    return [x + px * c - py * s, y + px * s + py * c] as Vec;
  });
}

/** Ramer–Douglas–Peucker for polylines. */
export function rdp(pts: Poly, eps: number): Poly {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = eps;
    const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Polyline → compact smooth bezier path (for AE export). */
export function polyToPath(poly: Poly, maxPts = 64, closed = true): PathData {
  const pts = poly.length > maxPts ? resample(poly, maxPts, closed) : poly;
  return smoothPath(pts, closed);
}

export function pathToPoly(p: PathData, n: number): Poly {
  return orientCW(resample(flatten(p, 24), n, p.closed));
}

export function pathBounds(p: PathData) { return bbox(flatten(p, 8)); }

export function translatePath(p: PathData, dx: number, dy: number): PathData {
  return { ...p, v: p.v.map((q) => [q[0] + dx, q[1] + dy] as Vec), i: p.i.map((q) => [...q] as Vec), o: p.o.map((q) => [...q] as Vec) };
}

/** Re-centre a path on its bbox centre. Returns the path and the centre removed. */
export function centrePath(p: PathData): { path: PathData; cx: number; cy: number } {
  const b = pathBounds(p);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return { path: translatePath(p, -cx, -cy), cx, cy };
}
