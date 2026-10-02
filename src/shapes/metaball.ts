// Gooey merge: signed distance fields of several closed polylines combined with
// a smooth minimum, then contoured with marching squares.

import type { Vec } from '../core/math';
import { bbox, signedArea, type Poly } from './geometry';

/** Polynomial smooth minimum (k = blend radius in px). */
export function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

interface Field { nx: number; ny: number; x0: number; y0: number; cell: number; v: Float32Array }

/** Signed distance (negative inside) from point to polygon. */
function polySD(px: number, py: number, xs: Float64Array, ys: Float64Array) {
  let d = Infinity, inside = false;
  const n = xs.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = xs[j], ay = ys[j], bx = xs[i], by = ys[i];
    const ex = bx - ax, ey = by - ay;
    const wx = px - ax, wy = py - ay;
    const L = ex * ex + ey * ey;
    const u = L > 0 ? Math.max(0, Math.min(1, (wx * ex + wy * ey) / L)) : 0;
    const dx = wx - ex * u, dy = wy - ey * u;
    const dd = dx * dx + dy * dy;
    if (dd < d) d = dd;
    if ((ay > py) !== (by > py) && px < (ex * (py - ay)) / (ey || 1e-12) + ax) inside = !inside;
  }
  d = Math.sqrt(d);
  return inside ? -d : d;
}

export interface MergeOpts { blend: number; cell: number; minArea: number }

export function buildField(polys: Poly[], o: MergeOpts): Field | null {
  const live = polys.filter((p) => p.length > 2);
  if (!live.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const boxes = live.map((p) => bbox(p));
  for (const b of boxes) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  const pad = o.blend * 0.6 + o.cell * 2;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  let cell = Math.max(1, o.cell);
  // cap the grid so huge shapes stay interactive
  while (((x1 - x0) / cell) * ((y1 - y0) / cell) > 260_000) cell *= 1.25;
  const nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1;
  const v = new Float32Array(nx * ny).fill(1e9);
  const arrs = live.map((p) => ({ xs: Float64Array.from(p, (q) => q[0]), ys: Float64Array.from(p, (q) => q[1]) }));
  const reach = o.blend + cell * 2;
  for (let s = 0; s < live.length; s++) {
    const b = boxes[s];
    const { xs, ys } = arrs[s];
    for (let j = 0; j < ny; j++) {
      const py = y0 + j * cell;
      const dyb = py < b.y0 ? b.y0 - py : py > b.y1 ? py - b.y1 : 0;
      for (let i = 0; i < nx; i++) {
        const px = x0 + i * cell;
        const dxb = px < b.x0 ? b.x0 - px : px > b.x1 ? px - b.x1 : 0;
        const k = j * nx + i;
        let d: number;
        const far = Math.hypot(dxb, dyb);
        // far from this shape: the bbox distance is a safe lower bound and blends to nothing
        if (far > reach) d = far;
        else d = polySD(px, py, xs, ys);
        v[k] = v[k] > 1e8 ? d : smin(v[k], d, o.blend);
      }
    }
  }
  return { nx, ny, x0, y0, cell, v };
}

/** Marching squares at iso 0 → closed loops (outer contours CW, holes CCW). */
export function contour(f: Field): Poly[] {
  const { nx, ny, x0, y0, cell, v } = f;
  // edge ids: horizontal edge (i,j)-(i+1,j) = 2*(j*nx+i), vertical (i,j)-(i,j+1) = 2*(j*nx+i)+1
  const pt = new Map<number, Vec>();
  const edgePoint = (id: number): Vec => {
    let p = pt.get(id);
    if (p) return p;
    const base = id >> 1, i = base % nx, j = (base / nx) | 0;
    const a = v[base];
    const b = id & 1 ? v[base + nx] : v[base + 1];
    const u = a === b ? 0.5 : a / (a - b);
    p = id & 1 ? [x0 + i * cell, y0 + (j + u) * cell] : [x0 + (i + u) * cell, y0 + j * cell];
    pt.set(id, p);
    return p;
  };
  const next = new Map<number, number>();
  // cases below are written with the inside on the left; flipping gives CW outer loops
  const link = (a: number, b: number) => next.set(b, a);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const a = v[k], b = v[k + 1], c = v[k + nx + 1], d = v[k + nx];
      const code = (a < 0 ? 1 : 0) | (b < 0 ? 2 : 0) | (c < 0 ? 4 : 0) | (d < 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top = 2 * k, bottom = 2 * (k + nx), left = 2 * k + 1, right = 2 * (k + 1) + 1;
      switch (code) {
        case 1: link(left, top); break;
        case 2: link(top, right); break;
        case 3: link(left, right); break;
        case 4: link(right, bottom); break;
        case 5: {
          const center = (a + b + c + d) / 4;
          if (center < 0) { link(left, bottom); link(right, top); } else { link(left, top); link(right, bottom); }
          break;
        }
        case 6: link(top, bottom); break;
        case 7: link(left, bottom); break;
        case 8: link(bottom, left); break;
        case 9: link(bottom, top); break;
        case 10: {
          const center = (a + b + c + d) / 4;
          if (center < 0) { link(top, left); link(bottom, right); } else { link(top, right); link(bottom, left); }
          break;
        }
        case 11: link(bottom, right); break;
        case 12: link(right, left); break;
        case 13: link(right, top); break;
        case 14: link(top, left); break;
      }
    }
  }
  const loops: Poly[] = [];
  const seen = new Set<number>();
  for (const startId of next.keys()) {
    if (seen.has(startId)) continue;
    const loop: Poly = [];
    let cur: number | undefined = startId;
    let guard = 0;
    while (cur !== undefined && !seen.has(cur) && guard++ < 200000) {
      seen.add(cur);
      loop.push(edgePoint(cur));
      cur = next.get(cur);
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

/** Full merge: polygons → smooth union contours. */
export function mergePolys(polys: Poly[], o: MergeOpts): Poly[] {
  const f = buildField(polys, o);
  if (!f) return [];
  return contour(f).filter((l) => Math.abs(signedArea(l)) >= o.minArea);
}

/** Light Laplacian smoothing of a closed loop. */
export function smoothLoop(loop: Poly, iterations: number, k = 0.5): Poly {
  let p = loop;
  const n = p.length;
  for (let it = 0; it < iterations; it++) {
    const q: Poly = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
      q[i] = [b[0] + ((a[0] + c[0]) / 2 - b[0]) * k, b[1] + ((a[1] + c[1]) / 2 - b[1]) * k];
    }
    p = q;
  }
  return p;
}
