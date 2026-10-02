// Gooey merge: signed distance fields of several closed polylines combined with
// a smooth minimum, then contoured with marching squares.

import type { Vec } from '../core/math';
import { bbox, signedArea, resample, perimeter as perim, type Poly } from './geometry';

/** Polynomial smooth minimum (k = blend radius in px). */
export function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

interface Field { nx: number; ny: number; x0: number; y0: number; cell: number; v: Float32Array }

/** Signed distance (negative inside) from a point to a shape made of one or more
 *  contours. Inside uses the even-odd rule, so glyph holes stay open. */
function shapeSD(px: number, py: number, cs: { xs: Float64Array; ys: Float64Array }[]) {
  let d = Infinity, inside = false;
  for (const { xs, ys } of cs) {
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
  }
  d = Math.sqrt(d);
  return inside ? -d : d;
}

/**
 * Signed distance of one shape over a grid window, in O(cells):
 * scanline even-odd fill → exact distances in a 1-cell boundary band →
 * nearest-point propagation (8SSEDT style) for the rest of the window.
 */
function shapeWindowSD(cs: { xs: Float64Array; ys: Float64Array }[], ox: number, oy: number, cell: number, w: number, hgt: number): Float32Array {
  const n = w * hgt;
  const inside = new Uint8Array(n);
  // scanline fill at cell centres
  const xsRow: number[] = [];
  for (let j = 0; j < hgt; j++) {
    const py = oy + j * cell;
    xsRow.length = 0;
    for (const { xs, ys } of cs) {
      const m = xs.length;
      for (let a = 0, b = m - 1; a < m; b = a++) {
        const ay = ys[b], by = ys[a];
        if ((ay > py) !== (by > py)) xsRow.push(xs[b] + ((py - ay) / (by - ay)) * (xs[a] - xs[b]));
      }
    }
    xsRow.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xsRow.length; k += 2) {
      const ia = Math.max(0, Math.ceil((xsRow[k] - ox) / cell)), ib = Math.min(w - 1, Math.floor((xsRow[k + 1] - ox) / cell));
      for (let i = ia; i <= ib; i++) inside[j * w + i] = 1;
    }
  }
  // nearest boundary point per cell (NaN = unknown)
  const nxp = new Float64Array(n).fill(NaN), nyp = new Float64Array(n).fill(NaN);
  const dist = new Float32Array(n).fill(1e9);
  const nearest = (px: number, py: number) => {
    let best = Infinity, bx = 0, by = 0;
    for (const { xs, ys } of cs) {
      const m = xs.length;
      for (let a = 0, b = m - 1; a < m; b = a++) {
        const ax = xs[b], ay = ys[b], ex = xs[a] - ax, ey = ys[a] - ay;
        const L = ex * ex + ey * ey;
        const u = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / L)) : 0;
        const qx = ax + ex * u, qy = ay + ey * u;
        const d = (px - qx) * (px - qx) + (py - qy) * (py - qy);
        if (d < best) { best = d; bx = qx; by = qy; }
      }
    }
    return [bx, by, Math.sqrt(best)] as const;
  };
  let any = false;
  for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, c = inside[k];
    const edge = (i > 0 && inside[k - 1] !== c) || (i < w - 1 && inside[k + 1] !== c) || (j > 0 && inside[k - w] !== c) || (j < hgt - 1 && inside[k + w] !== c);
    if (!edge) continue;
    const [bx, by, d] = nearest(ox + i * cell, oy + j * cell);
    nxp[k] = bx; nyp[k] = by; dist[k] = d; any = true;
  }
  if (!any) {
    // shape smaller than a cell (or fully outside): fall back to exact distances on a sparse set
    for (let k = 0; k < n; k++) { const [bx, by, d] = nearest(ox + (k % w) * cell, oy + Math.floor(k / w) * cell); nxp[k] = bx; nyp[k] = by; dist[k] = d; }
  } else {
    const relax = (k: number, q: number, px: number, py: number) => {
      const bx = nxp[q];
      if (bx !== bx) return; // NaN
      const by = nyp[q];
      const d = Math.sqrt((px - bx) * (px - bx) + (py - by) * (py - by));
      if (d < dist[k]) { dist[k] = d; nxp[k] = bx; nyp[k] = by; }
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < hgt; j++) {
        const py = oy + j * cell;
        for (let i = 0; i < w; i++) {
          const k = j * w + i, px = ox + i * cell;
          if (i > 0) relax(k, k - 1, px, py);
          if (j > 0) { relax(k, k - w, px, py); if (i > 0) relax(k, k - w - 1, px, py); if (i < w - 1) relax(k, k - w + 1, px, py); }
        }
        for (let i = w - 1; i >= 0; i--) { const k = j * w + i; if (i < w - 1) relax(k, k + 1, ox + i * cell, py); }
      }
      for (let j = hgt - 1; j >= 0; j--) {
        const py = oy + j * cell;
        for (let i = w - 1; i >= 0; i--) {
          const k = j * w + i, px = ox + i * cell;
          if (i < w - 1) relax(k, k + 1, px, py);
          if (j < hgt - 1) { relax(k, k + w, px, py); if (i < w - 1) relax(k, k + w + 1, px, py); if (i > 0) relax(k, k + w - 1, px, py); }
        }
        for (let i = 0; i < w; i++) { const k = j * w + i; if (i > 0) relax(k, k - 1, ox + i * cell, py); }
      }
    }
  }
  for (let k = 0; k < n; k++) if (inside[k]) dist[k] = -dist[k];
  return dist;
}

export interface MergeOpts { blend: number; cell: number; minArea: number }

/** Build the blended field. Each shape is a list of contours (outer + holes). */
export function buildField(shapes: Poly[][], o: MergeOpts): Field | null {
  const live = shapes.map((sh) => sh.filter((p) => p.length > 2)).filter((sh) => sh.length);
  if (!live.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const boxes = live.map((sh) => bbox(sh.flat()));
  for (const b of boxes) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  const pad = o.blend * 0.6 + o.cell * 2;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  let cell = Math.max(0.5, o.cell);
  // cap the grid so huge shapes stay interactive
  while (((x1 - x0) / cell) * ((y1 - y0) / cell) > 260_000) cell *= 1.25;
  const nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1;
  const v = new Float32Array(nx * ny).fill(1e9);
  // contours are simplified to the grid resolution: finer detail is invisible in the field
  const arrs = live.map((sh) => sh.map((p) => {
    const per = perim(p);
    const n = Math.max(8, Math.min(p.length, Math.ceil(per / (cell * 1.2))));
    const q = n < p.length ? resample(p, n) : p;
    return { xs: Float64Array.from(q, (z) => z[0]), ys: Float64Array.from(q, (z) => z[1]) };
  }));
  const reach = o.blend + cell * 2;
  for (let s = 0; s < live.length; s++) {
    const b = boxes[s];
    // only cells within reach of this shape can change the iso-surface
    const i0 = Math.max(0, Math.floor((b.x0 - reach - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((b.x1 + reach - x0) / cell));
    const j0 = Math.max(0, Math.floor((b.y0 - reach - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((b.y1 + reach - y0) / cell));
    const sd = shapeWindowSD(arrs[s], x0 + i0 * cell, y0 + j0 * cell, cell, i1 - i0 + 1, j1 - j0 + 1);
    const w = i1 - i0 + 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = sd[(j - j0) * w + (i - i0)];
        const k = j * nx + i;
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
  return mergeShapes(polys.map((p) => [p]), o);
}

/** Merge multi-contour shapes (e.g. glyphs with holes). */
export function mergeShapes(shapes: Poly[][], o: MergeOpts): Poly[] {
  const f = buildField(shapes, o);
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
