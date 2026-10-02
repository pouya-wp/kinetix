import type { Vec } from '../core/math';
import { centroid, type Poly } from './geometry';

/**
 * Rotate the vertex order of `b` so it lines up with `a` (both CW, same count),
 * minimising the summed squared distance after removing the centroid offset.
 * This is what keeps morphs from twisting through themselves.
 */
export function align(a: Poly, b: Poly): Poly {
  const n = a.length;
  if (n !== b.length || n === 0) return b;
  const ca = centroid(a), cb = centroid(b);
  const ax = a.map((p) => p[0] - ca[0]), ay = a.map((p) => p[1] - ca[1]);
  const bx = b.map((p) => p[0] - cb[0]), by = b.map((p) => p[1] - cb[1]);
  let best = 0, bestErr = Infinity;
  // coarse search, then refine around the best
  const coarse = Math.max(1, Math.floor(n / 48));
  const test = (off: number) => {
    let e = 0;
    for (let i = 0; i < n; i += coarse === 1 ? 1 : 2) {
      const j = (i + off) % n;
      const dx = ax[i] - bx[j], dy = ay[i] - by[j];
      e += dx * dx + dy * dy;
      if (e >= bestErr) return e;
    }
    return e;
  };
  for (let off = 0; off < n; off += coarse) {
    const e = test(off);
    if (e < bestErr) { bestErr = e; best = off; }
  }
  for (let off = best - coarse; off <= best + coarse; off++) {
    const o = ((off % n) + n) % n;
    let e = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + o) % n;
      const dx = ax[i] - bx[j], dy = ay[i] - by[j];
      e += dx * dx + dy * dy;
    }
    if (e < bestErr || o === best) { if (e <= bestErr) { bestErr = e; best = o; } }
  }
  const out: Poly = new Array(n);
  for (let i = 0; i < n; i++) out[i] = b[(i + best) % n];
  return out;
}

export type MorphMode = 'linear' | 'center' | 'twist';

/** Interpolate two aligned polylines. */
export function morphPoly(a: Poly, b: Poly, t: number, mode: MorphMode = 'linear'): Poly {
  const n = a.length;
  if (mode === 'linear') {
    const out: Poly = new Array(n);
    for (let i = 0; i < n; i++) out[i] = [a[i][0] + (b[i][0] - a[i][0]) * t, a[i][1] + (b[i][1] - a[i][1]) * t];
    return out;
  }
  // polar interpolation around moving centroid keeps volume rounder mid-morph
  const ca = centroid(a), cb = centroid(b);
  const c: Vec = [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t];
  const twist = mode === 'twist' ? Math.sin(t * Math.PI) * 0.6 : 0;
  const out: Poly = new Array(n);
  for (let i = 0; i < n; i++) {
    const ax = a[i][0] - ca[0], ay = a[i][1] - ca[1];
    const bx = b[i][0] - cb[0], by = b[i][1] - cb[1];
    const ra = Math.hypot(ax, ay), rb = Math.hypot(bx, by);
    const aa = Math.atan2(ay, ax);
    let ab = Math.atan2(by, bx);
    while (ab - aa > Math.PI) ab -= Math.PI * 2;
    while (ab - aa < -Math.PI) ab += Math.PI * 2;
    const r = ra + (rb - ra) * t;
    const ang = aa + (ab - aa) * t + twist;
    out[i] = [c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r];
  }
  return out;
}
