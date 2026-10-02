import type { Comp, ShapeItem, ShapesState, PathData } from '../core/state';
import type { Ease, Vec } from '../core/math';
import { ShapeEngine, keyState } from './engine';
import { resample, smoothPath, centroid, signedArea, type Poly } from './geometry';
import { align } from './morph';
import { hexToRgb } from '../bounce/export';

export interface PathKeys { t: number[]; v: PathData[] }
export interface ShapeLayerExport {
  name: string;
  color: number[];
  stroke: number[] | null;
  strokeW: number;
  opacity: number;
  kind: 'sparse' | 'baked';
  paths: PathKeys[];
  /** sparse only: layer transform keys + per-segment eases */
  xf?: { t: number[]; pos: Vec[]; rot: number[]; scale: Vec[]; ease: (Ease | null)[] };
}
export interface ShapesPayload { comp: Comp; layers: ShapeLayerExport[]; mode: 'auto' | 'baked' }

const isLinear = (e: Ease) => Math.abs(e[0] - e[1]) < 0.01 && Math.abs(e[2] - e[3]) < 0.01;
const isSimple = (e: Ease) => isLinear(e) || (Math.abs(e[1]) < 0.01 && Math.abs(e[3] - 1) < 0.01);

/** Downsample an aligned polyline keeping vertex correspondence (every k-th point). */
function decimate(poly: Poly, max: number): Poly {
  if (poly.length <= max) return poly;
  const k = Math.ceil(poly.length / max);
  return poly.filter((_, i) => i % k === 0);
}

const toPath = (poly: Poly): PathData => {
  const p = smoothPath(poly, true);
  const r = (v: Vec): Vec => [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100];
  return { v: p.v.map(r), i: p.i.map(r), o: p.o.map(r), closed: true };
};

function canBeSparse(it: ShapeItem) {
  return !it.group && !it.behaviors.some((b) => b.on) && it.keys.length > 1 && it.keys.every((k) => isSimple(k.ease));
}

function sparseLayer(it: ShapeItem): ShapeLayerExport {
  const maxPts = 48;
  const t: number[] = [], paths: PathData[] = [];
  const xf = { t, pos: [] as Vec[], rot: [] as number[], scale: [] as Vec[], ease: [] as (Ease | null)[] };
  let prev: Poly | null = null;
  for (const k of it.keys) {
    const ks = keyState(it, k.t)!;
    let poly = ks.poly;
    if (prev) poly = align(prev, poly);
    prev = poly;
    t.push(k.t);
    paths.push(toPath(decimate(poly, maxPts)));
    xf.pos.push([k.x, k.y]);
    xf.rot.push(k.rot);
    xf.scale.push([k.sx * 100, k.sy * 100]);
    xf.ease.push(isLinear(k.ease) ? null : k.ease);
  }
  return { name: it.name, color: hexToRgb(it.color), stroke: it.strokeW > 0 ? hexToRgb(it.stroke) : null, strokeW: it.strokeW, opacity: it.opacity, kind: 'sparse', paths: [{ t, v: paths }], xf };
}

export function buildShapesPayload(state: { shapes: ShapesState; comp: Comp }, mode: 'auto' | 'baked', onlyIds?: string[]): ShapesPayload {
  const { shapes, comp } = state;
  const engine = new ShapeEngine(() => state);
  engine.sync();
  const fps = comp.fps;
  const frames = Math.max(1, Math.round(comp.duration * fps));
  const pick = (it: ShapeItem) => it.visible && (!onlyIds || onlyIds.includes(it.id) || (it.group && onlyIds.includes(it.group)));
  const layers: ShapeLayerExport[] = [];

  const loose = shapes.items.filter((i) => pick(i) && !i.group);
  const bakedItems: ShapeItem[] = [];
  for (const it of loose) {
    if (mode === 'auto' && canBeSparse(it)) layers.push(sparseLayer(it));
    else bakedItems.push(it);
  }
  // baked loose shapes
  for (const it of bakedItems) {
    const t: number[] = [], v: PathData[] = [];
    let prev: Poly | null = null;
    for (let f = 0; f <= frames; f++) {
      const p = engine.item(it, f / fps);
      if (!p) continue;
      let poly = decimate(p, 64);
      if (prev && prev.length === poly.length) poly = align(prev, poly);
      prev = poly;
      t.push(f / fps);
      v.push(toPath(poly));
    }
    layers.push({ name: it.name, color: hexToRgb(it.color), stroke: it.strokeW > 0 ? hexToRgb(it.stroke) : null, strokeW: it.strokeW, opacity: it.opacity, kind: 'baked', paths: [{ t, v }] });
  }

  // merge groups: contours change count over time → fixed slots matched by proximity
  for (const g of shapes.groups) {
    const members = shapes.items.filter((i) => i.group === g.id && pick(i));
    if (!members.length) continue;
    const N = 72;
    const perFrame: Poly[][] = [];
    for (let f = 0; f <= frames; f++) {
      const polys = members.map((m) => engine.item(m, f / fps)).filter(Boolean) as Poly[];
      perFrame.push(engine.merge(g, polys).map((l) => resample(l, N)));
    }
    const slots: (Poly | null)[][] = [];
    const lastSeen: (Poly | null)[] = [];
    perFrame.forEach((loops, f) => {
      const used = new Set<number>();
      const assign: (Poly | null)[] = new Array(slots.length).fill(null);
      // greedy match by centroid distance (holes and outers matched separately by sign)
      const order = loops.map((l, i) => ({ l, i, c: centroid(l), s: Math.sign(signedArea(l)) }));
      for (let si = 0; si < slots.length; si++) {
        const ref = lastSeen[si];
        if (!ref) continue;
        const rc = centroid(ref), rs = Math.sign(signedArea(ref));
        let best = -1, bd = Infinity;
        for (const o of order) {
          if (used.has(o.i) || o.s !== rs) continue;
          const d = Math.hypot(o.c[0] - rc[0], o.c[1] - rc[1]);
          if (d < bd) { bd = d; best = o.i; }
        }
        if (best >= 0) { used.add(best); assign[si] = align(ref, loops[best]); }
      }
      for (const o of order) {
        if (used.has(o.i)) continue;
        slots.push(new Array(f).fill(null));
        lastSeen.push(null);
        assign.push(o.l);
      }
      assign.forEach((p, si) => { slots[si][f] = p; if (p) lastSeen[si] = p; });
    });
    // fill gaps with collapsed points so the slot fades in/out from a dot
    const paths: PathKeys[] = slots.map((seq) => {
      const firstIdx = seq.findIndex(Boolean);
      const t: number[] = [], v: PathData[] = [];
      let last: Poly | null = seq[firstIdx] ?? null;
      seq.forEach((p, f) => {
        if (p) last = p;
        const src = p ?? last!;
        const poly = p ?? collapse(src);
        t.push(f / fps);
        v.push(toPath(poly));
      });
      return { t, v };
    });
    layers.push({ name: g.name, color: hexToRgb(g.color), stroke: null, strokeW: 0, opacity: 100, kind: 'baked', paths });
  }
  return { comp, layers, mode };
}

function collapse(poly: Poly): Poly {
  const c = centroid(poly);
  return poly.map(() => [c[0], c[1]] as Vec);
}
