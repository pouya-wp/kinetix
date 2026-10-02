// Evaluates the Shape Morph scene at any time: key morphs → transforms →
// behaviors → soft-body jiggle → gooey merge groups.

import type { Behavior, BehaviorType, PathData, ShapeItem, ShapesState, Comp, MergeGroup } from '../core/state';
import { ease, noise1, type Vec } from '../core/math';
import { pathToPoly, transformPoly, centroid, type Poly } from './geometry';
import { align, morphPoly } from './morph';
import { mergePolys, smoothLoop } from './metaball';

export const BEHAVIORS: Record<BehaviorType, { label: string; params: Record<string, [number, number, number, number, string]> }> = {
  // name: [default, min, max, step, label]
  jiggle: { label: 'Liquid jiggle', params: { amount: [1, 0, 3, 0.01, 'Amount'], stiffness: [180, 10, 800, 1, 'Stiffness'], damping: [7, 0.5, 40, 0.1, 'Damping'], inertia: [1, 0, 3, 0.01, 'Inertia'], coupling: [0.6, 0, 1, 0.01, 'Surface tension'] } },
  breathe: { label: 'Breathe', params: { amp: [0.08, 0, 0.6, 0.005, 'Amount'], speed: [0.5, 0.05, 4, 0.01, 'Cycles / s'], phase: [0, 0, 1, 0.01, 'Phase'] } },
  pulse: { label: 'Pulse pop', params: { amp: [0.25, 0, 1, 0.01, 'Amount'], period: [1.2, 0.2, 6, 0.05, 'Every (s)'], stiffness: [260, 20, 800, 1, 'Stiffness'], damping: [9, 1, 40, 0.1, 'Damping'] } },
  noise: { label: 'Noise wobble', params: { amp: [18, 0, 200, 0.5, 'Amount (px)'], freq: [5, 1, 24, 1, 'Lumps'], speed: [0.8, 0, 6, 0.01, 'Speed'], seed: [1, 0, 999, 1, 'Seed'] } },
  wave: { label: 'Edge wave', params: { amp: [10, 0, 120, 0.5, 'Amount (px)'], count: [6, 1, 40, 1, 'Waves'], speed: [0.5, -4, 4, 0.01, 'Speed'] } },
  orbit: { label: 'Orbit', params: { radius: [80, 0, 1000, 1, 'Radius (px)'], speed: [0.25, -3, 3, 0.01, 'Turns / s'], phase: [0, 0, 1, 0.01, 'Phase'] } },
  drift: { label: 'Drift', params: { amp: [120, 0, 1200, 1, 'Distance (px)'], speed: [0.2, 0, 3, 0.01, 'Speed'], seed: [3, 0, 999, 1, 'Seed'] } },
  spin: { label: 'Spin', params: { speed: [45, -720, 720, 1, 'Degrees / s'] } },
};

export function defaultParams(type: BehaviorType) {
  const p: Record<string, number> = {};
  for (const k in BEHAVIORS[type].params) p[k] = BEHAVIORS[type].params[k][0];
  return p;
}

// ───────── caches ─────────
const polyCache = new WeakMap<PathData, { n: number; poly: Poly }>();
function keyPoly(p: PathData, n: number): Poly {
  const c = polyCache.get(p);
  if (c && c.n === n) return c.poly;
  const poly = pathToPoly(p, n);
  polyCache.set(p, { n, poly });
  return poly;
}
const alignCache = new WeakMap<PathData, WeakMap<PathData, { n: number; poly: Poly }>>();
function alignedPoly(a: PathData, b: PathData, n: number): Poly {
  let m = alignCache.get(a);
  if (!m) { m = new WeakMap(); alignCache.set(a, m); }
  const c = m.get(b);
  if (c && c.n === n) return c.poly;
  const poly = align(keyPoly(a, n), keyPoly(b, n));
  m.set(b, { n, poly });
  return poly;
}

export interface KeyState { poly: Poly; x: number; y: number; rot: number; sx: number; sy: number }

/** Local polygon + transform at time t (key interpolation only). */
export function keyState(item: ShapeItem, t: number): KeyState | null {
  const keys = item.keys;
  if (!keys.length) return null;
  const n = item.points;
  if (keys.length === 1 || t <= keys[0].t) {
    const k = keys[0];
    return { poly: keyPoly(k.path, n), x: k.x, y: k.y, rot: k.rot, sx: k.sx, sy: k.sy };
  }
  const last = keys[keys.length - 1];
  if (t >= last.t) {
    // the last key's path must stay aligned with how we arrived at it
    const prev = keys[keys.length - 2];
    return { poly: alignedPoly(prev.path, last.path, n), x: last.x, y: last.y, rot: last.rot, sx: last.sx, sy: last.sy };
  }
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  const u = ease(a.ease, (t - a.t) / Math.max(1e-6, b.t - a.t));
  // chain alignment so every key is aligned with its predecessor
  const pa = i === 0 ? keyPoly(a.path, n) : alignedPoly(keys[i - 1].path, a.path, n);
  const pb = align(pa, keyPoly(b.path, n));
  const L = (p: number, q: number) => p + (q - p) * u;
  return { poly: morphPoly(pa, pb, u, item.morph), x: L(a.x, b.x), y: L(a.y, b.y), rot: L(a.rot, b.rot), sx: L(a.sx, b.sx), sy: L(a.sy, b.sy) };
}

/** Damped impulse response: 0 → peak 1 → wobbling back to 0. */
function impulse(t: number, k: number, d: number) {
  const w0 = Math.sqrt(k), z = Math.min(0.95, d / (2 * w0)), wd = w0 * Math.sqrt(1 - z * z);
  const tp = Math.atan(wd / (z * w0)) / wd;
  const peak = Math.exp(-z * w0 * tp) * Math.sin(wd * tp);
  return (Math.exp(-z * w0 * t) * Math.sin(wd * t)) / (peak || 1);
}

function loopNoise(x: number, seed: number, period: number, loopLen: number) {
  if (!loopLen) return noise1(x, seed, period);
  const w = (x % loopLen + loopLen) % loopLen / loopLen;
  return noise1(x, seed, period) * (1 - w) + noise1(x - loopLen, seed, period) * w;
}

/** Apply non-physical behaviors in world space. */
function applyBehaviors(poly: Poly, bs: Behavior[], t: number, loopDur: number): Poly {
  let out = poly;
  const q = (f: number) => (loopDur > 0 ? Math.max(1, Math.round(f * loopDur)) / loopDur : f);
  for (const b of bs) {
    if (!b.on || b.type === 'jiggle') continue;
    const p = b.p;
    const c = centroid(out);
    switch (b.type) {
      case 'breathe': {
        const s = 1 + p.amp * Math.sin((t * q(p.speed) + p.phase) * Math.PI * 2);
        out = out.map((v) => [c[0] + (v[0] - c[0]) * s, c[1] + (v[1] - c[1]) * s] as Vec);
        break;
      }
      case 'pulse': {
        const per = loopDur > 0 ? loopDur / Math.max(1, Math.round(loopDur / p.period)) : p.period;
        const local = ((t % per) + per) % per;
        const s = 1 + p.amp * impulse(local, p.stiffness, p.damping);
        out = out.map((v) => [c[0] + (v[0] - c[0]) * s, c[1] + (v[1] - c[1]) * s] as Vec);
        break;
      }
      case 'noise': {
        const n = out.length;
        const fr = Math.round(p.freq);
        out = out.map((v, i) => {
          const dx = v[0] - c[0], dy = v[1] - c[1], L = Math.hypot(dx, dy) || 1;
          const x = (i / n) * fr;
          const d = p.amp * loopNoise(x + t * p.speed, p.seed, fr, loopDur ? loopDur * p.speed : 0);
          return [v[0] + (dx / L) * d, v[1] + (dy / L) * d] as Vec;
        });
        break;
      }
      case 'wave': {
        const n = out.length;
        out = out.map((v, i) => {
          const dx = v[0] - c[0], dy = v[1] - c[1], L = Math.hypot(dx, dy) || 1;
          const d = p.amp * Math.sin(((i / n) * Math.round(p.count) - t * q(p.speed)) * Math.PI * 2);
          return [v[0] + (dx / L) * d, v[1] + (dy / L) * d] as Vec;
        });
        break;
      }
      case 'orbit': {
        const a = (t * q(p.speed) + p.phase) * Math.PI * 2;
        const ox = Math.cos(a) * p.radius - Math.cos(p.phase * Math.PI * 2) * p.radius;
        const oy = Math.sin(a) * p.radius - Math.sin(p.phase * Math.PI * 2) * p.radius;
        out = out.map((v) => [v[0] + ox, v[1] + oy] as Vec);
        break;
      }
      case 'drift': {
        const L = loopDur ? loopDur * p.speed : 0;
        const ox = p.amp * loopNoise(t * p.speed, p.seed, 0, L), oy = p.amp * loopNoise(t * p.speed, p.seed + 17, 0, L);
        out = out.map((v) => [v[0] + ox, v[1] + oy] as Vec);
        break;
      }
      case 'spin': {
        const sp = loopDur > 0 ? (Math.round((p.speed * loopDur) / 360) * 360) / loopDur || p.speed : p.speed;
        const a = (sp * t * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
        out = out.map((v) => { const dx = v[0] - c[0], dy = v[1] - c[1]; return [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs] as Vec; });
        break;
      }
    }
  }
  return out;
}

export class ShapeEngine {
  private jiggle = new Map<string, { offsets: Float32Array[]; vel: Float32Array; prev: Poly[] }>();
  private sig = '';
  constructor(private getState: () => { shapes: ShapesState; comp: Comp }) {}

  /** Call whenever the scene changes; drops simulation caches if needed. */
  sync() {
    const s = this.getState();
    const sig = JSON.stringify(s.shapes.items) + s.comp.fps + s.comp.duration + s.shapes.loop;
    if (sig !== this.sig) { this.sig = sig; this.jiggle.clear(); }
  }

  get loopDur() { const s = this.getState(); return s.shapes.loop ? s.comp.duration : 0; }

  /** World polygon before soft-body. */
  base(item: ShapeItem, t: number): Poly | null {
    const ks = keyState(item, t);
    if (!ks) return null;
    const w = transformPoly(ks.poly, ks.x, ks.y, ks.rot, ks.sx, ks.sy);
    return applyBehaviors(w, item.behaviors, t, this.loopDur);
  }

  item(item: ShapeItem, t: number): Poly | null {
    const b = this.base(item, t);
    if (!b) return null;
    const j = item.behaviors.find((x) => x.type === 'jiggle' && x.on);
    if (!j) return b;
    const fps = this.getState().comp.fps;
    const f = t * fps;
    const f0 = Math.max(0, Math.floor(f)), u = f - f0;
    const o0 = this.offsetsAt(item, j, f0), o1 = this.offsetsAt(item, j, f0 + 1);
    const amt = j.p.amount;
    return b.map((v, i) => [v[0] + (o0[i * 2] + (o1[i * 2] - o0[i * 2]) * u) * amt, v[1] + (o0[i * 2 + 1] + (o1[i * 2 + 1] - o0[i * 2 + 1]) * u) * amt] as Vec);
  }

  /** Soft body: per-vertex springs driven by the base shape's acceleration. */
  private offsetsAt(item: ShapeItem, j: Behavior, frame: number): Float32Array {
    const fps = this.getState().comp.fps;
    const n = item.points;
    let c = this.jiggle.get(item.id);
    if (!c) { c = { offsets: [new Float32Array(n * 2)], vel: new Float32Array(n * 2), prev: [] }; this.jiggle.set(item.id, c); }
    const SUB = 4;
    const dt = 1 / (fps * SUB);
    const { stiffness: k, damping: d, inertia, coupling } = j.p;
    while (c.offsets.length <= frame) {
      const f = c.offsets.length; // computing offsets for frame f from f-1
      const O = Float32Array.from(c.offsets[f - 1]);
      const V = c.vel;
      for (let s = 1; s <= SUB; s++) {
        const t = (f - 1 + s / SUB) / fps;
        const pm = this.base(item, t - dt), p0 = this.base(item, t), pp = this.base(item, t + dt);
        if (!pm || !p0 || !pp) break;
        for (let i = 0; i < n; i++) {
          const ax = (pp[i][0] - 2 * p0[i][0] + pm[i][0]) / (dt * dt);
          const ay = (pp[i][1] - 2 * p0[i][1] + pm[i][1]) / (dt * dt);
          const il = ((i - 1 + n) % n) * 2, ir = ((i + 1) % n) * 2, ix = i * 2;
          const lx = (O[il] + O[ir]) / 2 - O[ix], ly = (O[il + 1] + O[ir + 1]) / 2 - O[ix + 1];
          const fx = -k * O[ix] - d * V[ix] - inertia * Math.max(-1e5, Math.min(1e5, ax)) + coupling * k * lx * 2;
          const fy = -k * O[ix + 1] - d * V[ix + 1] - inertia * Math.max(-1e5, Math.min(1e5, ay)) + coupling * k * ly * 2;
          V[ix] += fx * dt; V[ix + 1] += fy * dt;
        }
        for (let i = 0; i < n * 2; i++) O[i] += V[i] * dt;
      }
      c.offsets.push(O);
    }
    return c.offsets[frame];
  }

  /** Whole scene: individual polys + merged group contours. */
  scene(t: number): { items: Map<string, Poly>; groups: Map<string, Poly[]> } {
    const s = this.getState().shapes;
    const items = new Map<string, Poly>();
    for (const it of s.items) {
      if (!it.visible) continue;
      const p = this.item(it, t);
      if (p) items.set(it.id, p);
    }
    const groups = new Map<string, Poly[]>();
    for (const g of s.groups) groups.set(g.id, this.merge(g, s.items.filter((i) => i.group === g.id && items.has(i.id)).map((i) => items.get(i.id)!)));
    return { items, groups };
  }

  merge(g: MergeGroup, polys: Poly[]): Poly[] {
    if (!polys.length) return [];
    const loops = mergePolys(polys, { blend: g.blend, cell: g.res, minArea: g.minArea });
    return g.smooth > 0 ? loops.map((l) => smoothLoop(l, Math.round(g.smooth))) : loops;
  }
}
