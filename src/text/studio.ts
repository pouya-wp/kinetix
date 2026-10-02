import { store, type TextLine, type TextState, type TextStyle, type BoxStyle, type GapPolicy } from '../core/state';
import { Viewport } from '../core/viewport';
import { clock } from '../core/clock';
import { Transport } from '../core/transport';
import { SceneSection, CompSection, ViewSection, GuideSection } from '../core/common-ui';
import { h, Section, Slider, Toggle, Seg, Btn, ColorField, Swatches, TextInput, Field, clear, toast, icon, refreshAll, pickFile, Chips } from '../ui/kit';
import { uid, type Vec } from '../core/math';
import { TextEngine, worldContours } from './engine';
import { rasterLine, glyphsFromAE, type LineGeo, type AEGlyphGroup } from './glyphs';
import { parseSRT, gapInfo } from './plan';
import { buildTextPayload } from './export';
import { call, inAE } from '../core/ae-bridge';
import type { Poly } from '../shapes/geometry';
import type { Studio } from '../main';

const S = () => store.state;
const T = () => store.state.text;

export const STYLE_INFO: Record<TextStyle, { label: string; desc: string }> = {
  magic: { label: 'Magic Move', desc: 'Shared letters slide into place, the rest pop in & out' },
  liquid: { label: 'Liquid Morph', desc: 'Letters melt into each other like goo' },
  wave: { label: 'Stagger Wave', desc: 'Letters ripple up and down in a wave' },
  elastic: { label: 'Elastic Drop', desc: 'New letters drop in on springs, old ones fall away' },
  split: { label: 'Split & Slide', desc: 'Words part from the centre and slide' },
  scramble: { label: 'Scramble', desc: 'Letters decode through random glyphs' },
  typewriter: { label: 'Typewriter', desc: 'Backspace the old, type the new' },
};
const BOX_INFO: Record<BoxStyle, string> = {
  spring: 'Spring', elastic: 'Elastic', liquid: 'Liquid', squash: 'Squash', corners: 'Corners', pill: 'Pill morph', wipe: 'Wipe', pop: 'Pop',
};

const PRESETS: { id: string; label: string; apply: (t: TextState) => void }[] = [
  { id: 'tiktok', label: 'TikTok captions', apply: (t) => { t.style = 'magic'; t.boxOn = true; t.box.style = 'spring'; t.box.color = '#ffffff'; t.textColor = '#111111'; t.box.radius = 18; t.box.pill = false; t.travel = 'arc'; t.overshoot = 0.35; t.stagger = 0.25; } },
  { id: 'apple', label: 'Liquid glass', apply: (t) => { t.style = 'liquid'; t.boxOn = true; t.box.style = 'liquid'; t.box.color = '#ffffff'; t.box.opacity = 22; t.textColor = '#ffffff'; t.box.pill = true; t.liquidBlend = 40; t.box.stiffness = 160; t.box.damping = 12; } },
  { id: 'minimal', label: 'Minimal', apply: (t) => { t.style = 'wave'; t.boxOn = false; t.textColor = '#ffffff'; t.travel = 'straight'; t.overshoot = 0; t.stagger = 0.4; } },
  { id: 'bold', label: 'Bold pop', apply: (t) => { t.style = 'elastic'; t.boxOn = true; t.box.style = 'pop'; t.box.color = '#d1fe17'; t.textColor = '#111111'; t.box.radius = 14; t.box.pill = false; t.travel = 'spring'; t.overshoot = 0.6; } },
  { id: 'neon', label: 'Neon pill', apply: (t) => { t.style = 'magic'; t.boxOn = true; t.box.style = 'pill'; t.box.color = '#b388ff'; t.textColor = '#ffffff'; t.box.pill = true; t.travel = 'spring'; t.overshoot = 0.45; } },
  { id: 'hacker', label: 'Decode', apply: (t) => { t.style = 'scramble'; t.boxOn = true; t.box.style = 'wipe'; t.box.color = '#0f1113'; t.box.opacity = 85; t.textColor = '#d1fe17'; t.box.radius = 6; t.box.pill = false; } },
];

const DEMO: [number, number, string][] = [
  [0.3, 1.6, 'Hello and welcome back'], [1.8, 3.1, 'Today we build something'], [3.1, 4.4, 'Today we build something amazing'],
  [4.3, 5.6, 'Something truly amazing'], [5.9, 7.1, 'Watch the letters move'], [7.1, 8.4, 'Watch the words morph'],
  [8.7, 9.9, 'Like liquid glass'], [10.1, 11.6, 'Thanks for watching!'],
];

export class TextStudio implements Studio {
  id = 'text';
  el: HTMLElement;
  vp: Viewport;
  engine: TextEngine;
  geos = new Map<string, LineGeo>();
  private right: HTMLElement;
  private linesBox: HTMLElement;
  private transport;
  private active = false;
  private progress: HTMLElement;
  private busy = false;
  private overlayLabel = '';

  constructor() {
    this.engine = new TextEngine(() => ({ text: T(), fps: S().comp.fps }));
    this.vp = new Viewport((ctx, vp) => this.draw(ctx, vp), (ctx) => this.overlay(ctx));
    this.vp.tool = { down: () => clock.pause() };
    this.transport = Transport({ ranges: () => this.ranges(), marks: () => T().lines.map((l) => ({ t: l.t0 })) });
    this.linesBox = h('div', { class: 'lines' });
    this.progress = h('div', { class: 'progress', style: { display: 'none' } }, h('div', { style: { width: '0%' } }));
    this.right = h('div', { class: 'side right' });
    const left = h('div', { class: 'side' },
      SceneSection(),
      this.sourceSection(),
      this.timingSection(),
      CompSection({ duration: true }),
      ViewSection(),
      GuideSection(),
      this.buildSection(),
    );
    const stage = h('div', { class: 'stage' },
      h('div', { class: 'stage-top' }, h('div', { class: 'toolbar' },
        h('button', { class: 'btn btn-sm', title: 'Fit view', onclick: () => this.vp.fit() }, icon('fit')),
        h('button', { class: 'btn btn-sm', title: 'Undo', onclick: () => store.undo() }, icon('undo')),
        h('button', { class: 'btn btn-sm', title: 'Redo', onclick: () => store.redo() }, icon('redo')),
      ), this.vp.zoomEl),
      this.vp.el,
      h('div', { class: 'stage-hint', style: { bottom: '68px' } }, 'Select subtitle text layers in AE and press Analyze · lime ranges = transitions, red = gaps · Space to preview'),
      this.transport.el,
    );
    this.el = h('div', { class: 'view' }, left, stage, this.right);
    this.buildInspector();
    store.subscribe(() => this.onState());
    clock.on(() => { if (this.active) this.vp.request(); });
    this.onState();
  }

  activate() {
    this.active = true;
    this.syncEngine();
    clock.fps = S().comp.fps;
    this.updateDuration();
    this.vp.resize();
  }
  deactivate() { this.active = false; }

  private updateDuration() {
    clock.setDuration(Math.max(1, this.engine.duration));
    this.transport.updateMarks();
    this.transport.update();
  }

  private ensureGeos() {
    for (const l of T().lines) {
      if (!this.geos.has(l.id)) this.geos.set(l.id, rasterLine(l));
    }
  }
  private syncEngine() {
    this.ensureGeos();
    this.engine.sync(T().lines, this.geos);
  }

  private onState() {
    this.syncEngine();
    this.renderLines();
    if (this.active) this.updateDuration();
    refreshAll();
    this.vp.request();
  }

  private ranges() {
    const out: { t0: number; t1: number; kind?: 'gap' | 'trans' }[] = [];
    for (const s of this.engine.segs) if (s.kind !== 'hold') out.push({ t0: s.t0, t1: s.t1 });
    const L = [...T().lines].sort((a, b) => a.t0 - b.t0);
    for (let i = 0; i < L.length - 1; i++) if (L[i + 1].t0 - L[i].t1 > 0.01) out.push({ t0: L[i].t1, t1: L[i + 1].t0, kind: 'gap' });
    return out;
  }

  // ───────── left ─────────
  private sourceSection() {
    return Section('Source', [
      Btn('Analyze selected text layers', () => this.analyze(), { variant: 'soft', block: true, icon: 'import' }),
      h('div', { class: 'row' },
        Btn('Import SRT', () => this.importSRT(), { size: 'sm', icon: 'open' }),
        Btn('Demo subtitles', () => this.loadDemo(), { size: 'sm', icon: 'wand' })),
      this.linesBox,
      this.lineEditor(),
    ], { color: 'var(--lime)' });
  }

  private lineEditor() {
    const L = () => T().lines.find((l) => l.id === T().sel) ?? null;
    const box = h('div', { class: 'stack' });
    const sl = (label: string, k: 't0' | 't1') => Slider({ label, min: 0, max: Math.max(10, this.engine.duration + 2), step: 0.01, get: () => L()?.[k] ?? 0, set: (v, f) => store.set((s) => { const l = s.text.lines.find((x) => x.id === T().sel); if (l) l[k] = v; }, f), begin: () => store.begin() });
    box.append(
      Field('Text', TextInput({ get: () => L()?.text ?? '', set: (v) => { const l = L(); if (!l || l.layer > 0) { toast('Text of AE layers is edited in AE (then Analyze again)', 'info'); return; } this.geos.delete(l.id); store.set((s) => { const x = s.text.lines.find((q) => q.id === l.id); if (x) x.text = v; }); } })),
      h('div', { class: 'row' }, sl('In (s)', 't0'), sl('Out (s)', 't1')),
    );
    return box;
  }

  private renderLines() {
    const L = [...T().lines].sort((a, b) => a.t0 - b.t0);
    const box = this.linesBox;
    box.innerHTML = '';
    if (!L.length) { box.appendChild(h('div', { class: 'empty' }, 'No lines yet — analyze your subtitle layers, import an SRT or load the demo.')); return; }
    L.forEach((l, i) => {
      let chip: HTMLElement | null = null;
      if (i < L.length - 1) {
        const g = gapInfo(l, L[i + 1]);
        chip = h('span', { class: 'g' + (g.kind === 'gap' ? ' gap' : g.kind === 'overlap' ? ' ovl' : ''), title: 'Gap to next line' }, g.kind === 'touch' ? 'cut' : (g.gap > 0 ? '+' : '') + g.gap.toFixed(2) + 's');
      }
      const row = h('div', { class: 'line' + (l.id === T().sel ? ' sel' : '') }, h('span', { class: 'n' }, String(i + 1).padStart(2, '0')), h('span', { class: 't', title: l.text }, l.text.replace(/\s+/g, ' ')), chip ?? h('span'));
      row.addEventListener('click', () => { store.silent((s) => { s.text.sel = l.id; }); clock.pause(); clock.seek(l.t0 + 0.01); });
      box.appendChild(row);
    });
  }

  private timingSection() {
    const t = T;
    const set = (fn: (x: TextState) => void, f = true) => store.set((s) => fn(s.text), f);
    return Section('Timing & gaps', [
      Field('Gap policy', Seg<GapPolicy>([
        { value: 'fill', label: 'Fill gap', title: 'The morph plays inside the gap and lands when the next line starts' },
        { value: 'close', label: 'Close', title: 'Hold each line until the next one starts' },
        { value: 'center', label: 'Center', title: 'Morph centred on each cut' },
        { value: 'keep', label: 'Keep', title: 'Morph out, keep the empty gap, morph in' },
      ], () => t().policy, (v) => set((x) => { x.policy = v; }))),
      Slider({ label: 'Transition (s)', min: 0.05, max: 2, step: 0.01, get: () => t().dur, set: (v, f) => set((x) => { x.dur = v; }, f), begin: () => store.begin() }),
      h('div', { class: 'row' },
        Slider({ label: 'Min (s)', min: 0.02, max: 1, step: 0.01, get: () => t().minDur, set: (v, f) => set((x) => { x.minDur = v; }, f), begin: () => store.begin() }),
        Slider({ label: 'Max (s)', min: 0.1, max: 3, step: 0.01, get: () => t().maxDur, set: (v, f) => set((x) => { x.maxDur = v; }, f), begin: () => store.begin() })),
      Toggle('Animate first line in', () => t().intro, (v) => set((x) => { x.intro = v; })),
      Toggle('Animate last line out', () => t().outro, (v) => set((x) => { x.outro = v; })),
      Btn('Close all gaps in source timing', () => this.closeGaps(), { size: 'sm' }),
    ], { color: 'var(--info)' });
  }

  private closeGaps() {
    store.set((s) => {
      const L = [...s.text.lines].sort((a, b) => a.t0 - b.t0);
      for (let i = 0; i < L.length - 1; i++) { const m = (L[i].t1 + L[i + 1].t0) / 2; L[i].t1 = m; L[i + 1].t0 = m; }
    });
    toast('Lines now meet exactly at each cut');
  }

  private buildSection() {
    return Section('Build', [
      Toggle('Disable original text layers', () => T().disableOriginals, (v) => store.set((s) => { s.text.disableOriginals = v; })),
      Btn('Build Text Morph precomp', () => this.build(), { variant: 'primary', size: 'lg', block: true, icon: 'send' }),
      this.progress,
      h('div', { class: 'hint' }, 'Creates one precomp with a layer per line, a separate Text Box layer and a Controls null (colours, padding, roundness). Apply any effect to the text or the box.'),
    ], { color: 'var(--lime)' });
  }

  // ───────── right ─────────
  private buildInspector() {
    clear(this.right);
    const t = T;
    const set = (fn: (x: TextState) => void, f = true) => store.set((s) => fn(s.text), f);
    const styles = Object.keys(STYLE_INFO) as TextStyle[];
    const cards = h('div', { class: 'cards', style: { gridTemplateColumns: '1fr 1fr' } }, ...styles.map((sid) => {
      const c = h('div', { class: 'card', style: { padding: '11px' } }, h('div', { class: 'card-title', style: { fontSize: '12px' } }, STYLE_INFO[sid].label), h('div', { class: 'card-sub', style: { fontSize: '11px' } }, STYLE_INFO[sid].desc));
      c.addEventListener('click', () => set((x) => { x.style = sid; x.randomize = false; }));
      return c;
    }));
    const markCards = () => [...cards.children].forEach((c, i) => c.classList.toggle('on', !t().randomize && t().style === styles[i]));
    store.subscribe(markCards);
    queueMicrotask(markCards);

    this.right.append(
      Section('Presets', [Chips(PRESETS.map((p) => ({ value: p.id, label: p.label })), () => '', (v) => { store.set((s) => PRESETS.find((p) => p.id === v)!.apply(s.text)); toast('Preset applied'); })], { color: 'var(--violet)' }),
      Section('Morph style', [
        cards,
        Toggle('Random style per transition', () => t().randomize, (v) => set((x) => { x.randomize = v; })),
        Slider({ label: 'Random seed', min: 1, max: 999, get: () => t().seed, set: (v, f) => set((x) => { x.seed = v; }, f), begin: () => store.begin() }),
        Slider({ label: 'Stagger', min: 0, max: 0.9, step: 0.01, get: () => t().stagger, set: (v, f) => set((x) => { x.stagger = v; }, f), begin: () => store.begin() }),
        Field('Letter travel', Seg([{ value: 'arc', label: 'Arc' }, { value: 'straight', label: 'Straight' }, { value: 'spring', label: 'Spring' }], () => t().travel, (v) => set((x) => { x.travel = v; }))),
        Slider({ label: 'Overshoot', min: 0, max: 1, step: 0.01, get: () => t().overshoot, set: (v, f) => set((x) => { x.overshoot = v; }, f), begin: () => store.begin() }),
        Slider({ label: 'Liquid wobble & stretch', min: 0, max: 120, get: () => t().liquidBlend, set: (v, f) => set((x) => { x.liquidBlend = v; }, f), begin: () => store.begin() }),
        Toggle('Case-sensitive letter matching', () => t().caseSensitive, (v) => set((x) => { x.caseSensitive = v; })),
        Field('Text colour', ColorField(() => t().textColor, (v, f) => set((x) => { x.textColor = v; }, f), () => store.begin())),
        Swatches((c) => set((x) => { x.textColor = c; })),
      ], { color: 'var(--lime)' }),
      Section('Text box', [
        Toggle('Background box', () => t().boxOn, (v) => set((x) => { x.boxOn = v; })),
        Chips((Object.keys(BOX_INFO) as BoxStyle[]).map((b) => ({ value: b, label: BOX_INFO[b] })), () => t().box.style, (v) => set((x) => { x.box.style = v; x.boxOn = true; })),
        h('div', { class: 'row' },
          Slider({ label: 'Pad X', min: 0, max: 200, get: () => t().box.padX, set: (v, f) => set((x) => { x.box.padX = v; }, f), begin: () => store.begin() }),
          Slider({ label: 'Pad Y', min: 0, max: 200, get: () => t().box.padY, set: (v, f) => set((x) => { x.box.padY = v; }, f), begin: () => store.begin() })),
        Slider({ label: 'Corner radius', min: 0, max: 200, get: () => t().box.radius, set: (v, f) => set((x) => { x.box.radius = v; }, f), begin: () => store.begin() }),
        Toggle('Pill shape', () => t().box.pill, (v) => set((x) => { x.box.pill = v; })),
        Slider({ label: 'Min width', min: 0, max: 2000, get: () => t().box.minW, set: (v, f) => set((x) => { x.box.minW = v; }, f), begin: () => store.begin() }),
        h('div', { class: 'row' },
          Field('Colour', ColorField(() => t().box.color, (v, f) => set((x) => { x.box.color = v; }, f), () => store.begin())),
          Slider({ label: 'Opacity', min: 0, max: 100, get: () => t().box.opacity, set: (v, f) => set((x) => { x.box.opacity = v; }, f), begin: () => store.begin() })),
        Slider({ label: 'Stiffness', min: 20, max: 900, get: () => t().box.stiffness, set: (v, f) => set((x) => { x.box.stiffness = v; }, f), begin: () => store.begin() }),
        Slider({ label: 'Damping', min: 1, max: 60, step: 0.5, get: () => t().box.damping, set: (v, f) => set((x) => { x.box.damping = v; }, f), begin: () => store.begin() }),
        Slider({ label: 'Intensity', min: 0, max: 3, step: 0.01, get: () => t().box.intensity, set: (v, f) => set((x) => { x.box.intensity = v; }, f), begin: () => store.begin() }),
        Slider({ label: 'Follow lag (s)', min: 0, max: 0.4, step: 0.005, get: () => t().box.lag, set: (v, f) => set((x) => { x.box.lag = v; }, f), begin: () => store.begin() }),
      ], { color: 'var(--info)' }),
    );
  }

  // ───────── sources ─────────
  private async analyze() {
    if (!inAE) {
      toast('Preview mode: loading demo subtitles instead of AE layers', 'info');
      this.loadDemo();
      return;
    }
    try {
      toast('Reading text layers and outlining glyphs…', 'info', 2000);
      const r = await call<{ lines: TextLine[]; glyphs: Record<string, AEGlyphGroup[]>; comp: { w: number; h: number; fps: number; duration: number; name: string }; warnings: string[] }>('textAnalyze');
      if (!r.lines.length) { toast('Select one or more text layers in the timeline first', 'info'); return; }
      this.geos.clear();
      const lines = r.lines.map((l) => ({ ...l, id: uid('ln') }));
      lines.forEach((l, i) => {
        const g = r.glyphs[String(r.lines[i].layer)];
        if (g?.length) this.geos.set(l.id, glyphsFromAE(l, g));
      });
      store.set((s) => {
        s.text.lines = lines;
        s.text.sel = null;
        Object.assign(s.comp, { w: r.comp.w, h: r.comp.h, fps: r.comp.fps, duration: r.comp.duration, name: r.comp.name });
      });
      r.warnings?.forEach((w) => toast(w, 'info', 6000));
      toast(`Analyzed ${lines.length} lines · ${[...this.geos.values()].reduce((n, g) => n + g.glyphs.length, 0)} glyphs`);
      this.vp.fit();
      clock.seek(lines[0]?.t0 ?? 0);
    } catch (e: any) { toast(e.message, 'err', 7000); }
  }

  private async importSRT() {
    const f = await pickFile('.srt,text/plain');
    if (!f) return;
    const items = parseSRT(await f.text());
    if (!items.length) { toast('No subtitles found in that file', 'err'); return; }
    if (inAE) {
      try {
        await call('textFromSRT', { items, size: 72, y: S().comp.h * 0.78 });
        toast(`Created ${items.length} text layers — analyzing…`);
        await this.analyze();
        return;
      } catch (e: any) { toast(e.message, 'err', 6000); return; }
    }
    this.setLines(items.map((it) => this.mkLine(it.text, it.t0, it.t1)));
    toast(`Imported ${items.length} subtitles`);
  }

  private mkLine(text: string, t0: number, t1: number): TextLine {
    const c = S().comp;
    return { id: uid('ln'), layer: 0, name: text.slice(0, 20), text, t0, t1, font: 'Inter', size: Math.round(c.h * 0.075), color: '#ffffff', x: c.w / 2, y: c.h * 0.6, justify: 'center' };
  }

  private setLines(lines: TextLine[]) {
    this.geos.clear();
    store.set((s) => { s.text.lines = lines; s.text.sel = null; s.comp.duration = Math.max(s.comp.duration, (lines[lines.length - 1]?.t1 ?? 0) + 0.5); });
    clock.seek(0);
  }

  private async loadDemo() {
    try { await document.fonts.ready; } catch { /* */ }
    this.setLines(DEMO.map(([a, b, t]) => this.mkLine(t, a, b)));
    clock.seek(0);
    clock.play();
  }

  private async build() {
    if (this.busy) return;
    if (!T().lines.length) { toast('Analyze or import some lines first', 'info'); return; }
    this.busy = true;
    const bar = this.progress.firstElementChild as HTMLElement;
    this.progress.style.display = '';
    const step = (p: number) => { bar.style.width = Math.round(p * 100) + '%'; };
    try {
      step(0.05);
      await new Promise((r) => setTimeout(r, 30));
      this.syncEngine();
      const payload = buildTextPayload(this.engine, T(), S().comp, [...T().lines].sort((a, b) => a.t0 - b.t0));
      step(0.2);
      const head = { ...payload, lines: [], baked: [], box: null };
      const { compId } = await call<{ compId: number }>('textBegin', head);
      const total = payload.lines.length + payload.baked.length + 2;
      let done = 0;
      for (const ln of payload.lines) { await call('textLine', compId, ln); step(0.2 + (0.8 * ++done) / total); }
      for (const b of payload.baked) { await call('textBaked', compId, b); step(0.2 + (0.8 * ++done) / total); }
      if (payload.box) await call('textBox', compId, payload.box, head);
      step(0.2 + (0.8 * ++done) / total);
      await call('textFinish', compId, head);
      step(1);
      const keys = payload.lines.reduce((n, l) => n + l.glyphs.reduce((m, g) => m + g.pos.t.length + g.op.t.length + g.scale.t.length + g.rot.t.length, 0), 0);
      toast(inAE ? `Text Morph built · ${payload.lines.length} lines · ${keys} keys` : `Preview mode: payload with ${payload.lines.length} lines, ${payload.baked.length} baked layers, ${keys} keys`);
    } catch (e: any) {
      toast(e.message, 'err', 8000);
    } finally {
      this.busy = false;
      setTimeout(() => { this.progress.style.display = 'none'; step(0); }, 1200);
    }
  }

  // ───────── drawing ─────────
  private draw(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!T().lines.length) return;
    const fr = this.engine.frame(clock.t);
    const st = T();
    if (fr.box && fr.box.op > 0.01) {
      const b = fr.box;
      ctx.save();
      ctx.globalAlpha = (st.box.opacity / 100) * b.op;
      ctx.fillStyle = st.box.color;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      ctx.translate(cx, cy);
      ctx.scale(b.scale, b.scale);
      ctx.translate(-cx, -cy);
      ctx.beginPath();
      if (b.poly?.length) { ctx.moveTo(b.poly[0][0], b.poly[0][1]); for (const p of b.poly) ctx.lineTo(p[0], p[1]); ctx.closePath(); }
      else ctx.roundRect(b.x0, b.y0, Math.max(0, b.x1 - b.x0), Math.max(0, b.y1 - b.y0), Math.min(b.r, (b.y1 - b.y0) / 2, (b.x1 - b.x0) / 2));
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = st.textColor;
    const path = (loops: Poly[]) => { for (const l of loops) { if (l.length < 3) continue; ctx.moveTo(l[0][0], l[0][1]); for (let i = 1; i < l.length; i++) ctx.lineTo(l[i][0], l[i][1]); ctx.closePath(); } };
    if (fr.liquid) {
      ctx.beginPath(); path(fr.liquid); ctx.fill('nonzero');
    }
    for (const d of fr.glyphs) {
      if (d.xf.op < 0.01) continue;
      ctx.globalAlpha = d.xf.op;
      ctx.beginPath();
      path(worldContours(d.glyph, d.xf));
      ctx.fill('evenodd');
    }
    ctx.globalAlpha = 1;
    // selected line marker
    const sel = st.lines.find((l) => l.id === st.sel);
    if (sel) {
      const g = this.geos.get(sel.id);
      if (g?.glyphs.length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of g.glyphs) { x0 = Math.min(x0, q.cx - q.w / 2); x1 = Math.max(x1, q.cx + q.w / 2); y0 = Math.min(y0, q.cy - q.h / 2); y1 = Math.max(y1, q.cy + q.h / 2); }
        ctx.strokeStyle = 'rgba(209,254,23,.5)';
        ctx.setLineDash([vp.px(4), vp.px(4)]);
        ctx.lineWidth = vp.px(1);
        ctx.strokeRect(x0 - vp.px(6), y0 - vp.px(6), x1 - x0 + vp.px(12), y1 - y0 + vp.px(12));
        ctx.setLineDash([]);
      }
    }
    const s = fr.seg;
    const idx = s ? this.engine.segs.indexOf(s) : -1;
    this.overlayLabel = !s ? '' : s.kind === 'hold' ? `Line ${s.line + 1}` : s.kind === 'trans' ? `Line ${s.from + 1} → ${s.to + 1} · ${STYLE_INFO[this.engine.styleAt(idx)].label}` : `${s.kind === 'in' ? 'In' : 'Out'} · line ${s.line + 1} · ${STYLE_INFO[this.engine.styleAt(idx)].label}`;
  }

  private overlay(ctx: CanvasRenderingContext2D) {
    if (!this.overlayLabel) return;
    ctx.font = '600 12px Inter, sans-serif';
    const w = ctx.measureText(this.overlayLabel).width + 20;
    const x = this.vp.w - w - 14, y = this.vp.h - 108;
    ctx.fillStyle = 'rgba(19,21,23,.85)';
    ctx.beginPath(); ctx.roundRect(x, y, w, 26, 13); ctx.fill();
    ctx.fillStyle = '#d1fe17';
    ctx.fillText(this.overlayLabel, x + 10, y + 17);
  }
}

export type { Vec };
