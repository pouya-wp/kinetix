export type Vec = [number, number];

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t: number) => t * t * (3 - 2 * t);
export const TAU = Math.PI * 2;
export const DEG = 180 / Math.PI;

export const vadd = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const vsub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const vscale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s];
export const vlen = (a: Vec) => Math.hypot(a[0], a[1]);
export const vdist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const vlerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const vdot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
export const vrot = (a: Vec, ang: number): Vec => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};
export const vnorm = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};

export const uid = (() => {
  let n = 0;
  return (p = 'id') => `${p}_${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
})();

/** CSS-style cubic-bezier easing: x1,y1,x2,y2. Returns y for given x in [0,1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dsx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return sy(t);
      const d = dsx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

export type Ease = [number, number, number, number];
export const EASES: Record<string, Ease> = {
  linear: [0, 0, 1, 1],
  smooth: [0.42, 0, 0.58, 1],
  easeIn: [0.55, 0, 1, 0.45],
  easeOut: [0, 0.55, 0.45, 1],
  snappy: [0.2, 0.8, 0.2, 1],
  expo: [0.87, 0, 0.13, 1],
  anticipate: [0.6, -0.35, 0.4, 1],
  overshoot: [0.3, 0, 0.2, 1.4],
  backInOut: [0.68, -0.55, 0.27, 1.55],
};

const easeCache = new Map<string, (x: number) => number>();
export function ease(e: Ease, t: number) {
  const k = e.join(',');
  let f = easeCache.get(k);
  if (!f) { f = cubicBezier(e[0], e[1], e[2], e[3]); easeCache.set(k, f); }
  return f(t);
}

/** Damped spring step response, starting at 0 and settling at 1. */
export function springStep(t: number, stiffness = 180, damping = 12, mass = 1) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise, periodic over `period` when given. */
export function noise1(x: number, seed = 0, period = 0) {
  const hash = (i: number) => {
    if (period > 0) i = ((i % period) + period) % period;
    let h = (i * 374761393 + seed * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1;
  };
  const i = Math.floor(x), f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return lerp(hash(i), hash(i + 1), u);
}

/** Ramer–Douglas–Peucker on (t, value[]) samples. Returns indices to keep. */
export function simplifyKeys(times: number[], values: number[][], tol: number[]): number[] {
  const n = times.length;
  if (n <= 2) return times.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, worstErr = 1;
    for (let i = a + 1; i < b; i++) {
      const u = (times[i] - times[a]) / (times[b] - times[a]);
      let err = 0;
      for (let d = 0; d < values[i].length; d++) {
        const interp = values[a][d] + (values[b][d] - values[a][d]) * u;
        err = Math.max(err, Math.abs(values[i][d] - interp) / tol[d]);
      }
      if (err > worstErr) { worstErr = err; worst = i; }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

export const fmtTime = (t: number) => t.toFixed(2) + 's';
export const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
