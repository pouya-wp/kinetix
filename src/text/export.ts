// Builds the After Effects payload for a Text Morph precomp.

import type { Comp, PathData, TextState, TextLine } from '../core/state';
import { simplifyKeys, round, type Vec } from '../core/math';
import { TextEngine, worldContours, type BoxFrame } from './engine';
import type { Glyph } from './glyphs';
import { loopsToSlots, toPath, type PathKeys } from '../shapes/export';
import { hexToRgb } from '../bounce/export';
import { smoothPath, type Poly } from '../shapes/geometry';

export interface Chan { t: number[]; v: (number | number[])[] }
export interface GlyphOut { name: string; paths: PathData[]; anchor: Vec; pos: Chan; scale: Chan; rot: Chan; op: Chan }
export interface LineOut { name: string; in: number; out: number; glyphs: GlyphOut[] }
export interface BakedOut { name: string; in: number; out: number; paths: PathKeys[] }
export interface BoxOut { kind: 'rect' | 'path'; size?: Chan; pos?: Chan; round?: Chan; path?: PathKeys; scale: Chan; op: Chan; in: number; out: number }
export interface TextPayload {
  comp: Comp;
  name: string;
  duration: number;
  textColor: number[];
  boxColor: number[];
  boxOpacity: number;
  padX: number;
  padY: number;
  radius: number;
  lines: LineOut[];
  baked: BakedOut[];
  box: BoxOut | null;
  originals: number[];
  disableOriginals: boolean;
}

const BAKED_STYLES = new Set(['liquid', 'scramble']);

function reduce(times: number[], vals: number[][], tol: number[]): Chan {
  if (!times.length) return { t: [], v: [] };
  const first = JSON.stringify(vals[0]);
  if (vals.every((v) => JSON.stringify(v) === first)) return { t: [times[0]], v: [vals[0].length === 1 ? vals[0][0] : vals[0]] };
  const idx = simplifyKeys(times, vals, tol);
  return { t: idx.map((i) => round(times[i], 5)), v: idx.map((i) => (vals[i].length === 1 ? round(vals[i][0], 3) : vals[i].map((x) => round(x, 3)))) };
}

/** Straight-segment path from a polyline contour (raster fallback glyphs). */
const polyPath = (c: Poly): PathData => ({ v: c.map((p) => [round(p[0], 2), round(p[1], 2)] as Vec), i: c.map(() => [0, 0] as Vec), o: c.map(() => [0, 0] as Vec), closed: true });

function glyphPaths(g: Glyph): PathData[] {
  if (g.paths?.length) return g.paths;
  return g.contours.map((c) => (c.length > 24 ? smoothPath(c, true, 0.6) : polyPath(c)));
}

export function buildTextPayload(engine: TextEngine, st: TextState, comp: Comp, lines: TextLine[]): TextPayload {
  const fps = comp.fps;
  const dur = engine.duration;
  const nF = Math.ceil(dur * fps);
  const L = engine.lines;

  // per (line, glyph) channels sampled every frame
  type Rec = { t: number[]; pos: number[][]; scale: number[][]; rot: number[][]; op: number[][] };
  const recs = new Map<string, Rec>();
  const lifespan = new Map<number, [number, number]>();
  const bakedFrames = new Map<number, { t: number[]; loops: Poly[][] }>();
  const touch = (li: number, t: number) => {
    const s = lifespan.get(li);
    if (!s) lifespan.set(li, [t, t]); else { s[0] = Math.min(s[0], t); s[1] = Math.max(s[1], t); }
  };

  for (let f = 0; f <= nF; f++) {
    const t = f / fps;
    const fr = engine.frame(t, false);
    const segIdx = fr.seg ? engine.segs.indexOf(fr.seg) : -1;
    const baked = segIdx >= 0 && fr.seg!.kind !== 'hold' && BAKED_STYLES.has(engine.styleAt(segIdx));
    if (baked) {
      let b = bakedFrames.get(segIdx);
      if (!b) { b = { t: [], loops: [] }; bakedFrames.set(segIdx, b); }
      b.t.push(t);
      b.loops.push(fr.liquid ?? fr.glyphs.filter((d) => d.xf.op > 0.01).flatMap((d) => worldContours(d.glyph, { ...d.xf, op: 1 })));
    }
    const seen = new Set<string>();
    for (const d of fr.glyphs) {
      const key = d.line + ':' + d.gi;
      seen.add(key);
      touch(d.line, t);
      let r = recs.get(key);
      if (!r) { r = { t: [], pos: [], scale: [], rot: [], op: [] }; recs.set(key, r); }
      r.t.push(t);
      r.pos.push([d.glyph.cx + d.xf.x, d.glyph.cy + d.xf.y]);
      r.scale.push([d.xf.sx * 100, d.xf.sy * 100]);
      r.rot.push([d.xf.rot]);
      r.op.push([baked ? 0 : Math.round(d.xf.op * 1000) / 10]);
    }
    // glyphs of live lines that are not drawn this frame are hidden
    for (const [li, span] of lifespan) {
      if (t > span[1] + 1 / fps) continue;
      const geo = engine.geo(li);
      geo?.glyphs.forEach((g, gi) => {
        const key = li + ':' + gi;
        if (seen.has(key)) return;
        const r = recs.get(key);
        if (!r) return;
        r.t.push(t); r.pos.push(r.pos[r.pos.length - 1]); r.scale.push(r.scale[r.scale.length - 1]); r.rot.push(r.rot[r.rot.length - 1]); r.op.push([0]);
      });
    }
  }

  const linesOut: LineOut[] = [];
  L.forEach((line, li) => {
    const geo = engine.geo(li);
    const span = lifespan.get(li);
    if (!geo || !span) return;
    const glyphs: GlyphOut[] = [];
    geo.glyphs.forEach((g, gi) => {
      const r = recs.get(li + ':' + gi);
      if (!r) return;
      // glyphs that are hidden before they first appear get an explicit 0 → visible key
      const firstVisible = r.op.findIndex((o) => o[0] > 0);
      if (firstVisible > 0) { r.t.splice(0, firstVisible - 1); r.pos.splice(0, firstVisible - 1); r.scale.splice(0, firstVisible - 1); r.rot.splice(0, firstVisible - 1); r.op.splice(0, firstVisible - 1); }
      glyphs.push({
        name: g.ch,
        paths: glyphPaths(g),
        anchor: [0, 0],
        pos: reduce(r.t, r.pos, [0.25, 0.25]),
        scale: reduce(r.t, r.scale, [0.3, 0.3]),
        rot: reduce(r.t, r.rot, [0.2]),
        op: reduce(r.t, r.op, [0.5]),
      });
    });
    const label = line.text.replace(/\s+/g, ' ').slice(0, 28);
    linesOut.push({ name: `Line ${String(li + 1).padStart(2, '0')} · ${label}`, in: span[0], out: span[1] + 1 / fps, glyphs });
  });

  const baked: BakedOut[] = [];
  for (const [segIdx, b] of bakedFrames) {
    const sg = engine.segs[segIdx];
    const label = sg.kind === 'trans' ? `${sg.from + 1}→${sg.to + 1}` : sg.kind === 'in' ? `in ${sg.line + 1}` : sg.kind === 'out' ? `out ${sg.line + 1}` : '';
    baked.push({ name: `${engine.styleAt(segIdx) === 'liquid' ? 'Liquid' : 'Scramble'} ${label}`, in: b.t[0], out: b.t[b.t.length - 1] + 1 / fps, paths: loopsToSlots(b.loops, b.t, 64) });
  }

  // text box
  let box: BoxOut | null = null;
  if (st.boxOn) {
    const t: number[] = [], size: number[][] = [], pos: number[][] = [], rnd: number[] = [], sc: number[][] = [], op: number[][] = [];
    const polys: Poly[][] = [];
    const isPath = st.box.style === 'liquid' || st.box.style === 'corners';
    let first = -1, last = -1;
    for (let f = 0; f <= nF; f++) {
      const b: BoxFrame | null = engine.boxAt(f / fps);
      if (!b) continue;
      if (b.op > 0 && first < 0) first = f;
      if (b.op > 0) last = f;
      t.push(f / fps);
      size.push([round(b.x1 - b.x0, 2), round(b.y1 - b.y0, 2)]);
      pos.push([round((b.x0 + b.x1) / 2, 2), round((b.y0 + b.y1) / 2, 2)]);
      rnd.push(round(b.r, 2));
      sc.push([b.scale * 100, b.scale * 100]);
      op.push([b.op * 100]);
      if (isPath) polys.push([b.poly ?? []]);
    }
    if (first >= 0) {
      const keepT = t.map((x, i) => [x, i] as const).filter(([, i]) => i >= first && i <= last + 1);
      const sel = <T,>(arr: T[]) => keepT.map(([, i]) => arr[i]);
      const tt = keepT.map(([x]) => x);
      if (isPath) {
        const loops = sel(polys).map((p) => (p[0]?.length ? [p[0]] : []));
        const pk = loopsToSlots(loops, tt, 56)[0];
        box = { kind: 'path', path: pk, scale: reduce(tt, sel(sc), [0.2, 0.2]), op: reduce(tt, sel(op), [0.5]), in: tt[0], out: tt[tt.length - 1] };
      } else {
        const red = (vals: number[][], tol: number[]) => reduce(tt, vals, tol);
        const sz = red(sel(size), [0.3, 0.3]), ps = red(sel(pos), [0.3, 0.3]), rr = red(sel(rnd).map((x) => [x]), [0.3]);
        box = {
          kind: 'rect', size: sz, pos: ps, round: rr,
          scale: red(sel(sc), [0.2, 0.2]), op: red(sel(op), [0.5]), in: tt[0], out: tt[tt.length - 1],
        };
      }
    }
  }

  return {
    comp: { ...comp, duration: Math.max(comp.duration, dur) },
    name: 'Kinetix TextMorph',
    duration: dur,
    textColor: hexToRgb(st.textColor),
    boxColor: hexToRgb(st.box.color),
    boxOpacity: st.box.opacity,
    padX: st.box.padX,
    padY: st.box.padY,
    radius: st.box.radius,
    lines: linesOut,
    baked,
    box,
    originals: lines.map((l) => l.layer).filter((x) => x > 0),
    disableOriginals: st.disableOriginals,
  };
}

export { toPath };
