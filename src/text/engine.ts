// Text Morph engine: evaluates every glyph (and the text box) at time t.

import type { TextLine, TextState, TextStyle } from '../core/state';
import { clamp, ease, EASES, rng, springStep, type Vec } from '../core/math';
import { resample, signedArea, centroid, bbox, type Poly } from '../shapes/geometry';
import { align, morphPoly } from '../shapes/morph';
import { smoothLoop } from '../shapes/metaball';
import { planTimeline, matchGlyphs, type Seg, type Match } from './plan';
import type { Glyph, LineGeo } from './glyphs';

export interface GlyphXf { x: number; y: number; sx: number; sy: number; rot: number; op: number; contours?: Poly[] }
export interface GlyphDraw { line: number; gi: number; xf: GlyphXf; glyph: Glyph }
export interface BoxFrame { x0: number; y0: number; x1: number; y1: number; r: number; poly?: Poly; scale: number; op: number }
export interface LiquidSrc { shapes: Poly[][]; blend: number; cell: number }
export interface TextFrame { seg: Seg | null; u: number; glyphs: GlyphDraw[]; liquid: Poly[] | null; liquidSrc: LiquidSrc | null; box: BoxFrame | null; blur?: number }

const REST: GlyphXf = { x: 0, y: 0, sx: 1, sy: 1, rot: 0, op: 1 };
const backOut = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

/** Progress of item k of n inside a staggered window. */
function stag(u: number, k: number, n: number, s: number) {
  const st = n > 1 ? (k / (n - 1)) * s : 0;
  return clamp((u - st) / Math.max(1e-6, 1 - s), 0, 1);
}

export class TextEngine {
  lines: TextLine[] = [];
  geos = new Map<string, LineGeo>();
  segs: Seg[] = [];
  private matches = new Map<string, Match>();
  private boxCache: BoxFrame[] = [];
  private sig = '';
  private styleOf = new Map<number, TextStyle>();

  constructor(private get: () => { text: TextState; fps: number }) {}

  get duration() { return this.lines.length ? this.lines[this.lines.length - 1].t1 + 0.3 : 1; }

  sync(lines: TextLine[], geos: Map<string, LineGeo>) {
    const st = this.get().text;
    const sig = JSON.stringify([lines, st, [...geos.keys()].join(), geos.size, this.get().fps]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.lines = [...lines].sort((a, b) => a.t0 - b.t0);
    this.geos = geos;
    this.matches.clear();
    this.boxCache = [];
    this.segs = planTimeline(this.lines, { policy: st.policy, dur: st.dur, minDur: st.minDur, maxDur: st.maxDur, intro: st.intro, outro: st.outro });
    // per transition style (optionally randomised)
    this.styleOf.clear();
    const all: TextStyle[] = ['flow', 'magic', 'liquid', 'wave', 'elastic', 'split', 'scramble', 'typewriter'];
    const r = rng(st.seed);
    this.segs.forEach((s, i) => this.styleOf.set(i, st.randomize ? all[Math.floor(r() * all.length)] : st.style));
  }

  geo(i: number) { return this.geos.get(this.lines[i]?.id); }

  match(a: number, b: number): Match {
    const k = a + '>' + b;
    let m = this.matches.get(k);
    if (!m) {
      const A = this.geo(a), B = this.geo(b);
      m = A && B ? matchGlyphs(A.glyphs, B.glyphs, A.words, B.words, this.get().text.caseSensitive) : { pairs: [], exits: [], enters: [] };
      this.matches.set(k, m);
    }
    return m;
  }

  segAt(t: number): { seg: Seg | null; idx: number; u: number } {
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      if (t >= s.t0 && t < s.t1) return { seg: s, idx: i, u: (t - s.t0) / Math.max(1e-6, s.t1 - s.t0) };
    }
    return { seg: null, idx: -1, u: 0 };
  }

  styleAt(idx: number): TextStyle { return this.styleOf.get(idx) ?? this.get().text.style; }

  /**
   * Export mode for the optical-flow style: lines simply hard-cut at the middle
   * of each transition; After Effects' Timewarp (Pixel Motion) invents the
   * in-between frames, exactly like the Twixtor text-morph technique.
   */
  flowExport = false;

  /** Flow transitions as {t0, t1, tc} windows (cut at tc). */
  flowWindows() {
    const out: { t0: number; t1: number; tc: number }[] = [];
    this.segs.forEach((s, i) => { if (s.kind === 'trans' && this.styleAt(i) === 'flow') out.push({ t0: s.t0, t1: s.t1, tc: (s.t0 + s.t1) / 2 }); });
    return out;
  }

  // ───────── glyph evaluation ─────────
  /** `merge` = run the (expensive) gooey merge for liquid frames. */
  frame(t: number, withBox = true, merge = true): TextFrame {
    const { seg, idx, u } = this.segAt(t);
    const out: TextFrame = { seg, u, glyphs: [], liquid: null, liquidSrc: null, box: null };
    if (seg) {
      const style = this.styleAt(idx);
      switch (seg.kind) {
        case 'hold': this.pushLine(out, seg.line, () => REST); break;
        case 'in': this.inOut(out, seg.line, u, style === 'flow' ? 'magic' : style, true); break;
        case 'out': this.inOut(out, seg.line, u, style === 'flow' ? 'magic' : style, false); break;
        case 'trans':
          if (style === 'flow') {
            if (this.flowExport) this.pushLine(out, u < 0.5 ? seg.from : seg.to, () => REST);
            else this.flowPreview(out, seg.from, seg.to, u);
          } else this.trans(out, seg.from, seg.to, u, style);
          break;
      }
    }
    if (withBox && this.get().text.boxOn) out.box = this.boxAt(t);
    return out;
  }

  private pushLine(out: TextFrame, li: number, xf: (g: Glyph, k: number) => GlyphXf | null) {
    const geo = this.geo(li);
    if (!geo) return;
    geo.glyphs.forEach((g, k) => { const x = xf(g, k); if (x && x.op > 0.001) out.glyphs.push({ line: li, gi: k, xf: x, glyph: g }); });
  }

  /** Enter (in=true) or exit animation for a whole line. */
  private inOut(out: TextFrame, li: number, u: number, style: TextStyle, entering: boolean) {
    const geo = this.geo(li);
    if (!geo) return;
    const n = geo.glyphs.length;
    const st = this.get().text;
    if (style === 'liquid') {
      // each glyph grows out of (or melts into) a small droplet, staggered
      const loops: Poly[] = [];
      geo.glyphs.forEach((g, k) => {
        const p = stag(u, entering ? k : n - 1 - k, n, st.stagger);
        const v = entering ? p : 1 - p;
        if (v <= 0.001) return;
        loops.push(...dropletMorph(g, ease(EASES.snappy, v), k));
      });
      out.liquid = loops;
      geo.glyphs.forEach((g, k) => out.glyphs.push({ line: li, gi: k, xf: { ...REST, op: 0 }, glyph: g }));
      return;
    }
    this.pushLine(out, li, (g, k) => {
      const order = style === 'typewriter' && !entering ? n - 1 - k : k;
      const p = stag(u, order, n, style === 'typewriter' ? 0.9 : st.stagger);
      return this.styledIO(g, entering ? p : 1 - p, style, entering, k, n, geo);
    });
  }

  private lineCentre(geo: LineGeo): Vec {
    const b = this.lineBounds(geo);
    return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  }
  private lineBounds(geo: LineGeo) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const g of geo.glyphs) { x0 = Math.min(x0, g.cx - g.w / 2); x1 = Math.max(x1, g.cx + g.w / 2); y0 = Math.min(y0, g.cy - g.h / 2); y1 = Math.max(y1, g.cy + g.h / 2); }
    return { x0, y0, x1, y1 };
  }
  private cell(geo: LineGeo) {
    const hs = geo.glyphs.map((g) => g.h).sort((a, b) => a - b);
    const h = hs[Math.floor(hs.length / 2)] || 60;
    return clamp(h / 14, 1.5, 8);
  }

  /**
   * Glyph transform for an entering/exiting glyph. v = visibility progress
   * (0 = gone, 1 = at rest). `entering` picks the direction of travel.
   */
  private styledIO(g: Glyph, v: number, style: TextStyle, entering: boolean, k: number, n: number, geo: LineGeo): GlyphXf {
    const size = Math.max(g.h, 20);
    const xf: GlyphXf = { x: 0, y: 0, sx: 1, sy: 1, rot: 0, op: 1 };
    switch (style) {
      case 'magic':
      case 'liquid': {
        const e = entering ? backOut(v, 2.2) : ease(EASES.easeIn, v);
        const s = Math.max(0, entering ? e : v);
        xf.sx = xf.sy = 0.15 + 0.85 * s;
        xf.op = clamp(v * 2.2, 0, 1);
        xf.y = (1 - v) * size * 0.25 * (entering ? 1 : -1);
        break;
      }
      case 'wave': {
        const e = entering ? backOut(v, 1.6) : ease(EASES.easeIn, v);
        xf.y = (1 - e) * size * 0.9 * (entering ? 1 : -1);
        xf.op = clamp(v * 1.6, 0, 1);
        xf.rot = (1 - v) * (entering ? -12 : 12);
        break;
      }
      case 'elastic': {
        if (entering) {
          const e = springStep(v * 0.9, 220, 9);
          xf.y = (1 - e) * -size * 1.6;
          xf.sy = 1 + (1 - e) * 0.35;
          xf.sx = 1 / xf.sy;
          xf.op = clamp(v * 3, 0, 1);
        } else {
          const w = 1 - v;
          xf.y = w * w * size * 2.2;
          xf.rot = w * (k % 2 ? 40 : -40);
          xf.op = clamp(v * 1.5, 0, 1);
        }
        break;
      }
      case 'split': {
        const c = this.lineCentre(geo);
        const side = g.cx < c[0] ? -1 : 1;
        const e = entering ? ease(EASES.snappy, v) : ease(EASES.easeIn, v);
        xf.x = (1 - e) * side * (size * 3 + Math.abs(g.cx - c[0]) * 0.6);
        xf.op = clamp(v * 1.4, 0, 1);
        xf.sx = 1 + (1 - e) * 0.5;
        break;
      }
      case 'typewriter': {
        xf.op = v > 0.02 ? 1 : 0;
        const pop = v > 0.02 && v < 0.5 ? Math.sin((v / 0.5) * Math.PI) * 0.18 : 0;
        xf.sx = xf.sy = 1 + pop;
        break;
      }
      case 'scramble': {
        xf.op = v > 0.03 ? 1 : 0;
        if (v > 0.03 && v < 0.75) {
          const pool = this.pool();
          const r = rng(Math.floor(v * 14) * 131 + k * 7 + n);
          const alt = pool[Math.floor(r() * pool.length)];
          if (alt) {
            const s = g.h / Math.max(1, alt.h);
            xf.contours = alt.contours.map((ct) => ct.map((p) => [p[0] * s, p[1] * s] as Vec));
          }
        }
        break;
      }
    }
    return xf;
  }

  private poolCache: Glyph[] | null = null;
  private pool() {
    if (!this.poolCache) {
      this.poolCache = [];
      const seen = new Set<string>();
      for (const g of this.geos.values()) for (const gl of g.glyphs) if (!seen.has(gl.ch)) { seen.add(gl.ch); this.poolCache.push(gl); }
    }
    return this.poolCache;
  }

  private travel(u: number) {
    const st = this.get().text;
    if (st.travel === 'spring') {
      const z = 1 - st.overshoot * 0.85;
      const k = 300, d = 2 * Math.sqrt(k) * z;
      const s = springStep(u * 0.75, k, d), s1 = springStep(0.75, k, d);
      return s + (1 - s1) * u;
    }
    return ease(st.overshoot > 0.02 ? [0.3, 0, 0.2, 1 + st.overshoot * 0.6] : EASES.snappy, u);
  }

  private trans(out: TextFrame, a: number, b: number, u: number, style: TextStyle) {
    const A = this.geo(a), B = this.geo(b);
    if (!A || !B) return;
    const m = this.match(a, b);
    const st = this.get().text;
    // exits play in the first 60%, enters in the last 60%, travellers across all of it
    const ue = clamp(u / 0.6, 0, 1), ui = clamp((u - 0.4) / 0.6, 0, 1);
    const tu = this.travel(u);
    const draws: GlyphDraw[] = [];

    m.pairs.forEach(([ia, ib], k) => {
      const ga = A.glyphs[ia], gb = B.glyphs[ib];
      const dx = gb.cx - ga.cx, dy = gb.cy - ga.cy;
      const dist = Math.hypot(dx, dy);
      const xf: GlyphXf = { x: dx * tu, y: dy * tu, sx: 1, sy: 1, rot: 0, op: 1 };
      // letters heading left arc over, letters heading right arc under — they never collide
      if (st.travel === 'arc' && dist > 2) xf.y += -Math.sin(u * Math.PI) * Math.min(ga.h * 1.1, dist * 0.3) * (dx < 0 ? 1 : -1);
      if (style === 'wave') xf.y += -Math.sin(u * Math.PI) * ga.h * 0.35;
      const sc = gb.h / Math.max(1, ga.h);
      xf.sx = xf.sy = 1 + (sc - 1) * tu;
      // draw the source glyph until the end, then the target takes over seamlessly
      if (ga.ch !== gb.ch) {
        // different case (s → S): cross-fade the two outlines along the same path
        draws.push({ line: a, gi: ia, xf: { ...xf, op: 1 - tu }, glyph: ga });
        const back = ga.h / Math.max(1, gb.h);
        draws.push({ line: b, gi: ib, xf: { ...xf, x: xf.x - dx, y: xf.y - dy, sx: xf.sx * back, sy: xf.sy * back, op: tu }, glyph: gb });
      } else draws.push({ line: a, gi: ia, xf, glyph: ga });
    });

    if (style === 'liquid') {
      this.liquidTrans(out, A, B, a, b, m, u, draws);
      return;
    }
    m.exits.forEach((ia, k) => {
      const g = A.glyphs[ia];
      const order = style === 'typewriter' ? m.exits.length - 1 - k : k;
      const p = stag(ue, order, m.exits.length, style === 'typewriter' ? 0.9 : st.stagger);
      const xf = this.styledIO(g, 1 - p, style, false, k, m.exits.length, A);
      if (xf.op > 0.001) draws.push({ line: a, gi: ia, xf, glyph: g });
    });
    m.enters.forEach((ib, k) => {
      const g = B.glyphs[ib];
      const p = stag(ui, k, m.enters.length, style === 'typewriter' ? 0.9 : st.stagger);
      const xf = this.styledIO(g, p, style, true, k, m.enters.length, B);
      if (xf.op > 0.001) draws.push({ line: b, gi: ib, xf, glyph: g });
    });
    out.glyphs = draws;
  }

  /**
   * Preview of the optical-flow morph: the whole line flows into the next one —
   * glyphs pair up by their relative position across the line (like pixel motion
   * would), outlines morph, everything stretches along its motion and softens.
   */
  private flowPreview(out: TextFrame, a: number, b: number, u: number) {
    const A = this.geo(a), B = this.geo(b);
    if (!A || !B) return;
    const e = ease([0.65, 0, 0.35, 1], u);
    const n = Math.max(A.glyphs.length, B.glyphs.length);
    const loops: Poly[] = [];
    let maxH = 0;
    for (let k = 0; k < n; k++) {
      const ga = A.glyphs[Math.min(A.glyphs.length - 1, Math.floor((k * A.glyphs.length) / n))];
      const gb = B.glyphs[Math.min(B.glyphs.length - 1, Math.floor((k * B.glyphs.length) / n))];
      if (!ga || !gb) continue;
      maxH = Math.max(maxH, ga.h, gb.h);
      const mg = morphGlyph(ga, gb, e);
      const dx = gb.cx - ga.cx, dy = gb.cy - ga.cy;
      const str = Math.sin(u * Math.PI) * Math.min(0.6, Math.hypot(dx, dy) / Math.max(1, ga.w * 4));
      loops.push(...stretchContours(mg, Math.atan2(dy, dx), 1 + str));
    }
    out.liquid = loops;
    out.blur = Math.sin(u * Math.PI) * maxH * 0.06;
    out.glyphs = A.glyphs.map((g, k) => ({ line: a, gi: k, xf: { ...REST, op: 0 }, glyph: g }));
  }

  /** Liquid: letters morph outline-to-outline with a light wobble — no merge, clean edges. */
  private liquidTrans(out: TextFrame, A: LineGeo, B: LineGeo, _a: number, _b: number, m: Match, u: number, travellers: GlyphDraw[]) {
    const st = this.get().text;
    const loops: Poly[] = [];
    // travellers: same letter, slight stretch along their motion
    for (const d of travellers) {
      if (d.line !== _a) continue; // case cross-fade copies are handled by the outline morph
      const ib = m.pairs.find((p) => A.glyphs[p[0]] === d.glyph)?.[1];
      const gb = ib != null ? B.glyphs[ib] : null;
      const dx = gb ? gb.cx - d.glyph.cx : 0, dy = gb ? gb.cy - d.glyph.cy : 0;
      const dist = Math.hypot(dx, dy);
      const str = Math.sin(u * Math.PI) * Math.min(0.35, dist / Math.max(1, d.glyph.w * 8)) * (st.liquidBlend / 40);
      const ang = Math.atan2(dy, dx);
      if (gb && gb.ch !== d.glyph.ch) {
        // s → S: morph the outline while travelling
        const mg = morphGlyph(d.glyph, gb, ease(EASES.smooth, u));
        loops.push(...stretchContours(mg, ang, 1 + str));
      } else loops.push(...stretchContours(worldContours(d.glyph, d.xf), ang, 1 + str));
    }
    // changed letters: pair in reading order and morph their outlines
    const ex = m.exits.map((i) => A.glyphs[i]), en = m.enters.map((i) => B.glyphs[i]);
    const n = Math.max(ex.length, en.length);
    for (let k = 0; k < n; k++) {
      const ga = ex.length ? ex[Math.min(ex.length - 1, Math.floor((k * ex.length) / n))] : null;
      const gb = en.length ? en[Math.min(en.length - 1, Math.floor((k * en.length) / n))] : null;
      // extra letters (when counts differ) shrink to / grow from a droplet instead of duplicating
      const dupA = ga && n > ex.length && k > 0 && ex[Math.min(ex.length - 1, Math.floor(((k - 1) * ex.length) / n))] === ga;
      const dupB = gb && n > en.length && k > 0 && en[Math.min(en.length - 1, Math.floor(((k - 1) * en.length) / n))] === gb;
      const p = stag(u, k, n, st.stagger * 0.6);
      const e = ease(EASES.smooth, p);
      if (dupA) { if (gb) loops.push(...dropletMorph(gb, ease(EASES.snappy, p), k)); continue; }
      if (dupB) { if (ga) loops.push(...dropletMorph(ga, 1 - ease(EASES.snappy, p), k)); continue; }
      loops.push(...wobble(morphGlyph(ga, gb, e), Math.sin(e * Math.PI) * (st.liquidBlend / 40), k + u * 3, (ga ?? gb)!.h));
    }
    out.liquid = loops;
    // keep glyph records (hidden) so the box and exporters know what is on screen
    out.glyphs = travellers.map((d) => ({ ...d, xf: { ...d.xf, op: 0 } }));
  }

  // ───────── text box ─────────
  /** Target rect (before padding) of what is visible at t. */
  targetBounds(t: number): { x0: number; y0: number; x1: number; y1: number; vis: number } | null {
    const f = this.frame(t, false, false);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, vis = 0;
    if (f.liquid?.length) {
      const pts = f.liquid.flat();
      if (pts.length) return { ...bbox(pts), vis: 1 };
    }
    for (const d of f.glyphs) {
      const op = d.xf.op;
      if (op < 0.05) continue;
      const g = d.glyph;
      const cx = g.cx + d.xf.x, cy = g.cy + d.xf.y;
      const hw = (g.w / 2) * Math.abs(d.xf.sx), hh = (g.h / 2) * Math.abs(d.xf.sy);
      x0 = Math.min(x0, cx - hw); x1 = Math.max(x1, cx + hw);
      y0 = Math.min(y0, cy - hh); y1 = Math.max(y1, cy + hh);
      vis = Math.max(vis, op);
    }
    // keep the box height stable: use the line's full ascender/descender box
    if (!isFinite(x0)) return null;
    return { x0, y0, x1, y1, vis };
  }

  boxAt(t: number): BoxFrame | null {
    const fps = this.get().fps;
    const f = Math.max(0, Math.round(t * fps));
    const n = Math.ceil(this.duration * fps) + 2;
    if (!this.boxCache.length) this.simBox(n);
    return this.boxCache[Math.min(f, this.boxCache.length - 1)] ?? null;
  }

  /** Sequential spring simulation of the box edges for every frame. */
  private simBox(nFrames: number) {
    const st = this.get().text;
    const bx = st.box;
    const fps = this.get().fps;
    const SUB = 4, dt = 1 / (fps * SUB);
    const k = bx.stiffness, damp = bx.style === 'elastic' ? bx.damping * 0.45 : bx.damping;
    // state: x0,y0,x1,y1 positions + velocities
    let P: number[] | null = null;
    const V = [0, 0, 0, 0];
    const corners: { p: Vec; v: Vec }[] = [];
    const N = 56;
    let soft: { p: Vec[]; v: Vec[] } | null = null;
    let lastCentre: Vec = [0, 0];
    const frames: BoxFrame[] = [];
    // stable line heights so ascenders/descenders don't make the box jump between lines
    for (let f = 0; f < nFrames; f++) {
      const t = Math.max(0, f / fps - bx.lag);
      const tb = this.targetBounds(t);
      let tgt: number[];
      let vis = 0;
      if (tb) {
        tgt = [tb.x0 - bx.padX, tb.y0 - bx.padY, tb.x1 + bx.padX, tb.y1 + bx.padY];
        if (bx.minW > 0 && tgt[2] - tgt[0] < bx.minW) { const c = (tgt[0] + tgt[2]) / 2; tgt[0] = c - bx.minW / 2; tgt[2] = c + bx.minW / 2; }
        lastCentre = [(tgt[0] + tgt[2]) / 2, (tgt[1] + tgt[3]) / 2];
        vis = tb.vis;
      } else tgt = [lastCentre[0], lastCentre[1], lastCentre[0], lastCentre[1]];
      if (!P) {
        // nothing on screen yet: no box; once text appears the box grows from its centre
        if (!tb) { frames.push({ x0: 0, y0: 0, x1: 0, y1: 0, r: 0, scale: 1, op: 0 }); continue; }
        P = [lastCentre[0], lastCentre[1], lastCentre[0], lastCentre[1]];
      }
      for (let s = 0; s < SUB; s++) {
        for (let e = 0; e < 4; e++) {
          // wipe: right edge lags, left edge snaps
          const ke = bx.style === 'wipe' ? (e === 2 ? k * 0.35 : k * 2.5) : k;
          const de = bx.style === 'wipe' ? 2 * Math.sqrt(ke) * 0.95 : damp;
          const a = ke * (tgt[e] - P[e]) - de * V[e];
          V[e] += a * dt;
          P[e] += V[e] * dt;
        }
      }
      let [x0, y0, x1, y1] = P;
      if (x1 < x0) [x0, x1] = [(x0 + x1) / 2, (x0 + x1) / 2];
      if (y1 < y0) [y0, y1] = [(y0 + y1) / 2, (y0 + y1) / 2];
      const w = x1 - x0, h = y1 - y0;
      let r = bx.pill ? h / 2 : Math.min(bx.radius, h / 2, w / 2);
      let scale = 1;
      const vw = (V[2] - V[0]);
      if (bx.style === 'squash') {
        const sq = clamp(Math.abs(vw) / 2500, 0, 0.35) * bx.intensity;
        const cy = (y0 + y1) / 2;
        y0 = cy - (h / 2) * (1 - sq); y1 = cy + (h / 2) * (1 - sq);
      }
      if (bx.style === 'pill') r = Math.min(h / 2, w / 2, r + clamp(Math.abs(vw) / 600, 0, 1) * h);
      if (bx.style === 'pop') {
        const tr = this.segs.find((sg) => sg.kind === 'trans' && f / fps >= sg.t0 && f / fps < sg.t0 + 0.6);
        if (tr) {
          const lt = f / fps - tr.t0;
          scale = 1 + 0.09 * bx.intensity * Math.exp(-lt * 7) * Math.sin(lt * 26);
        }
      }
      const fr: BoxFrame = { x0, y0, x1, y1, r: Math.max(0, r), scale, op: 1 };
      if (bx.style === 'corners') {
        const tc: Vec[] = [[tgt[0], tgt[1]], [tgt[2], tgt[1]], [tgt[2], tgt[3]], [tgt[0], tgt[3]]];
        if (!corners.length) tc.forEach(() => corners.push({ p: [lastCentre[0], lastCentre[1]], v: [0, 0] }));
        for (let s = 0; s < SUB; s++) corners.forEach((c, i) => {
          const kk = k * (0.55 + i * 0.22) , dd = damp * 0.7;
          for (const ax of [0, 1]) { const a = kk * (tc[i][ax] - c.p[ax]) - dd * c.v[ax]; c.v[ax] += a * dt; c.p[ax] += c.v[ax] * dt; }
        });
        fr.poly = roundedQuad(corners.map((c) => c.p), bx.pill ? 999 : bx.radius);
      }
      if (bx.style === 'liquid') {
        const target = resample(roundedQuad([[tgt[0], tgt[1]], [tgt[2], tgt[1]], [tgt[2], tgt[3]], [tgt[0], tgt[3]]], bx.pill ? 999 : bx.radius), N);
        if (!soft) soft = { p: target.map((q) => [lastCentre[0], lastCentre[1]] as Vec), v: target.map(() => [0, 0] as Vec) };
        const al = align(soft.p, target);
        for (let s = 0; s < SUB; s++) {
          for (let i = 0; i < N; i++) {
            const pp = soft.p[i], vv = soft.v[i];
            const l = soft.p[(i - 1 + N) % N], rr = soft.p[(i + 1) % N];
            for (const ax of [0, 1]) {
              const lap = (l[ax] + rr[ax]) / 2 - pp[ax];
              // edge points lag a little behind the corners → smooth jelly bulge, no jaggies
              const a = k * 0.7 * (al[i][ax] - pp[ax]) - damp * 0.9 * vv[ax] + lap * k * 2.5;
              vv[ax] += a * dt;
            }
          }
          for (let i = 0; i < N; i++) { soft.p[i][0] += soft.v[i][0] * dt; soft.p[i][1] += soft.v[i][1] * dt; }
        }
        fr.poly = smoothLoop(soft.p, 3, 0.5);
      }
      fr.op = tb ? 1 : clamp((x1 - x0) / 20, 0, 1);
      void vis;
      frames.push(fr);
    }
    this.boxCache = frames;
  }
}

// ───────── helpers ─────────
export function worldContours(g: Glyph, xf: GlyphXf): Poly[] {
  const r = (xf.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const cx = g.cx + xf.x, cy = g.cy + xf.y;
  return (xf.contours ?? g.contours).map((ct) => ct.map((p) => {
    const x = p[0] * xf.sx, y = p[1] * xf.sy;
    return [cx + x * c - y * s, cy + x * s + y * c] as Vec;
  }));
}

/** Glyph ↔ small round droplet (v = 1 full glyph, 0 = gone). */
function dropletMorph(g: Glyph, v: number, seed: number): Poly[] {
  if (v >= 0.999) return g.contours.map((ct) => ct.map((p) => [p[0] + g.cx, p[1] + g.cy] as Vec));
  const r = Math.max(2, Math.min(g.w, g.h) * 0.22) * Math.min(1, v * 3);
  const N = 48;
  const drop: Poly = Array.from({ length: N }, (_, i) => { const a = (i / N) * Math.PI * 2 - Math.PI / 2; return [g.cx + Math.cos(a) * r, g.cy + Math.sin(a) * r * 1.08] as Vec; });
  const sorted = [...g.contours].sort((p, q) => Math.abs(signedArea(q)) - Math.abs(signedArea(p)));
  const out: Poly[] = [];
  sorted.forEach((ct, i) => {
    const full = resample(ct.map((p) => [p[0] + g.cx, p[1] + g.cy] as Vec), N);
    const src = i === 0 ? drop : full.map(() => centroid(full));
    const e = clamp((v - 0.15) / 0.85, 0, 1);
    out.push(morphPoly(align(full, src), full, ease(EASES.snappy, e), 'center'));
  });
  return wobble(out, Math.sin(v * Math.PI) * 0.8, seed, g.h);
}

/** Light liquid wobble: radial sine ripple around each contour's centre. */
function wobble(loops: Poly[], amt: number, phase: number, h: number): Poly[] {
  if (Math.abs(amt) < 0.01) return loops;
  const A = h * 0.035 * amt;
  return loops.map((l) => {
    const c = centroid(l), n = l.length;
    return l.map((p, i) => {
      const dx = p[0] - c[0], dy = p[1] - c[1], L = Math.hypot(dx, dy) || 1;
      const d = A * Math.sin((i / n) * Math.PI * 2 * 3 + phase * 2.1);
      return [p[0] + (dx / L) * d, p[1] + (dy / L) * d] as Vec;
    });
  });
}

/** Stretch contours along an angle around their joint centre (squash & stretch). */
function stretchContours(loops: Poly[], ang: number, k: number): Poly[] {
  if (Math.abs(k - 1) < 1e-3) return loops;
  const c = centroid(loops[0] ?? []);
  const cs = Math.cos(ang), sn = Math.sin(ang), inv = 1 / Math.sqrt(k);
  return loops.map((l) => l.map((p) => {
    const x = p[0] - c[0], y = p[1] - c[1];
    const a = x * cs + y * sn, b = -x * sn + y * cs;
    const a2 = a * k, b2 = b * inv;
    return [c[0] + a2 * cs - b2 * sn, c[1] + a2 * sn + b2 * cs] as Vec;
  }));
}

/** Morph glyph a → glyph b (either may be null = a dot at the partner's centre). */
function morphGlyph(a: Glyph | null, b: Glyph | null, e: number): Poly[] {
  const N = 64;
  const outerOf = (g: Glyph) => [...g.contours].sort((p, q) => Math.abs(signedArea(q)) - Math.abs(signedArea(p)));
  const abs = (g: Glyph, ct: Poly) => ct.map((p) => [p[0] + g.cx, p[1] + g.cy] as Vec);
  const dot = (c: Vec) => Array.from({ length: N }, () => [c[0], c[1]] as Vec);
  const A = a ? outerOf(a).map((ct) => resample(abs(a, ct), N)) : [];
  const B = b ? outerOf(b).map((ct) => resample(abs(b, ct), N)) : [];
  const ca: Vec = a ? [a.cx, a.cy] : [b!.cx, b!.cy];
  const cb: Vec = b ? [b.cx, b.cy] : ca;
  const k = Math.max(A.length, B.length);
  const out: Poly[] = [];
  for (let i = 0; i < k; i++) {
    const pa = A[i] ?? dot(B[i] ? centroid(B[i]) : ca);
    const pb0 = B[i] ?? dot(A[i] ? centroid(A[i]) : cb);
    const pb = align(pa, pb0);
    out.push(morphPoly(pa, pb, e, 'center'));
  }
  return out;
}

/** Rounded quadrilateral as a dense polyline. */
export function roundedQuad(q: Vec[], radius: number): Poly {
  const out: Poly = [];
  const n = q.length;
  for (let i = 0; i < n; i++) {
    const p = q[i], a = q[(i - 1 + n) % n], b = q[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1, db = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const r = Math.min(radius, da / 2, db / 2);
    const ua: Vec = [(a[0] - p[0]) / da, (a[1] - p[1]) / da], ub: Vec = [(b[0] - p[0]) / db, (b[1] - p[1]) / db];
    const p1: Vec = [p[0] + ua[0] * r, p[1] + ua[1] * r], p2: Vec = [p[0] + ub[0] * r, p[1] + ub[1] * r];
    const steps = 8;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // quadratic bezier with control at the corner
      out.push([(1 - t) * (1 - t) * p1[0] + 2 * (1 - t) * t * p[0] + t * t * p2[0], (1 - t) * (1 - t) * p1[1] + 2 * (1 - t) * t * p[1] + t * t * p2[1]]);
    }
  }
  return out;
}
