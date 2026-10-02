import { h, Section, Slider, Seg, Btn, Field, Select, Toggle, toast, refreshAll, clear, TextInput, onRefresh } from '../ui/kit';
import { Page, Tiles, Group } from '../core/page';
import { call } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { EASE_LIBRARY, easeById } from '../animate/eases';
import { MOTIONS, MOTION_GROUPS, LOOPS, DIRV, buildType, previewAmount, type Unit, type Order, type Dir, type PhaseOpts } from './motions';
import type { Studio } from '../main';

const LS = 'kinetix.type';
type Phase = 'in' | 'out' | 'loop';

export class TypeStudio implements Studio {
  id = 'type';
  el: HTMLElement;
  private c = {
    phase: 'in' as Phase,
    inId: 'fade-dir' as string | null, outId: null as string | null, loopId: null as string | null,
    inDir: 'up' as Dir, outDir: 'up' as Dir,
    inUnit: 'char' as Unit, outUnit: 'char' as Unit, loopUnit: 'char' as Unit,
    inOrder: 'start' as Order, outOrder: 'start' as Order,
    inEase: 'expoOut', outEase: 'expoIn',
    inDur: 0.6, outDur: 0.45, stagger: 0.035, autoFit: false, strength: 1, seed: 7, speed: 100,
    sample: 'Kinetix Type',
  };
  private grid: HTMLElement;
  private preview: HTMLCanvasElement;
  private raf = 0;
  private active = false;

  constructor() {
    try { Object.assign(this.c, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { /* */ }
    const c = this.c;
    const save = () => { try { localStorage.setItem(LS, JSON.stringify(c)); } catch { /* */ } };
    const set = <K extends keyof typeof c>(k: K) => (v: any) => { (c as any)[k] = v; save(); };
    this.grid = h('div', { class: 'stack', style: { gap: '18px' } });
    this.preview = h('canvas', { style: { width: '100%', height: '150px', display: 'block', borderRadius: '14px', background: 'var(--bg-deep)' } });

    const pad = () => {
      const dirs: [Dir, string][] = [['up', '↑'], ['left', '←'], ['front', '●'], ['right', '→'], ['down', '↓'], ['back', '◌']];
      const box = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' } });
      const order = [null, 'up', null, 'left', 'front', 'right', null, 'down', 'back'] as (Dir | null)[];
      for (const d of order) {
        if (!d) { box.appendChild(h('div')); continue; }
        const b = h('button', { class: 'btn btn-sm', title: d }, dirs.find((x) => x[0] === d)![1]);
        b.addEventListener('click', () => { if (c.phase === 'out') c.outDir = d; else c.inDir = d; save(); refreshAll(); });
        box.appendChild(b);
        onRefresh(b, () => b.classList.toggle('on', (c.phase === 'out' ? c.outDir : c.inDir) === d));
      }
      return box;
    };
    const unitSeg = () => Seg<Unit>([{ value: 'char', label: 'Letters' }, { value: 'word', label: 'Words' }, { value: 'line', label: 'Lines' }],
      () => (c.phase === 'in' ? c.inUnit : c.phase === 'out' ? c.outUnit : c.loopUnit), (v) => { if (c.phase === 'in') c.inUnit = v; else if (c.phase === 'out') c.outUnit = v; else c.loopUnit = v; save(); refreshAll(); });
    const orderSeg = () => Select<Order>([{ value: 'start', label: 'From start' }, { value: 'end', label: 'From end' }, { value: 'center', label: 'From center' }, { value: 'edges', label: 'From edges' }, { value: 'random', label: 'Random' }],
      () => (c.phase === 'out' ? c.outOrder : c.inOrder), (v) => { if (c.phase === 'out') c.outOrder = v; else c.inOrder = v; save(); });
    const easeOpts = EASE_LIBRARY.map((e) => ({ value: e.id, label: `${e.group} · ${e.label}` }));

    const main = [
      h('div', { class: 'panel-card' },
        Seg<Phase>([{ value: 'in', label: 'Animate IN' }, { value: 'out', label: 'Animate OUT' }, { value: 'loop', label: 'Loop / Emphasis' }], () => c.phase, (v) => { c.phase = v; save(); this.renderGrid(); refreshAll(); }),
        h('div', { class: 'kv' },
          h('span', null, 'In'), h('b'), h('span', null, 'Out'), h('b'), h('span', null, 'Loop'), h('b')),
        h('div', { class: 'row' },
          Btn('Apply to selected text layers', () => this.apply(), { variant: 'primary', icon: 'send' }),
          Btn('Remove', () => this.clear(), { variant: 'danger' })),
        h('div', { class: 'hint' }, 'Live AE Text Animators: the text stays editable (change words or fonts any time). Timing sliders stay on the layer.')),
      this.grid,
    ];
    const side = [
      Section('Preview', [this.preview, Field('Sample text', TextInput({ get: () => c.sample, set: (v) => { c.sample = v || 'Kinetix Type'; save(); } }))], { color: 'var(--lime)' }),
      Section('Direction & units', [pad(), unitSeg(), Field('Order', orderSeg())], { color: 'var(--info)' }),
    ];
    const right = [
      Section('Timing', [
        Slider({ label: 'In duration (s)', min: 0.05, max: 3, step: 0.01, get: () => c.inDur, set: set('inDur') }),
        Slider({ label: 'Out duration (s)', min: 0.05, max: 3, step: 0.01, get: () => c.outDur, set: set('outDur') }),
        Slider({ label: 'Stagger (s)', min: 0, max: 0.4, step: 0.005, get: () => c.stagger, set: set('stagger') }),
        Toggle('Auto-fit stagger (1.2 s total)', () => c.autoFit, set('autoFit')),
        Slider({ label: 'Strength', min: 0.1, max: 3, step: 0.05, get: () => c.strength, set: set('strength') }),
        Slider({ label: 'Loop speed %', min: 5, max: 400, get: () => c.speed, set: set('speed') }),
        Slider({ label: 'Random seed', min: 1, max: 999, get: () => c.seed, set: set('seed') }),
      ], { color: 'var(--lime)' }),
      Section('Easing', [
        Field('In ease', Select(easeOpts, () => c.inEase, set('inEase'))),
        Field('Out ease', Select(easeOpts, () => c.outEase, set('outEase'))),
        h('div', { class: 'hint' }, 'Picking a motion sets its signature ease (e.g. Drop → Bounce); change it here afterwards.'),
      ], { color: 'var(--violet)' }),
    ];
    this.el = Page({ title: 'Type Animator', sub: 'Letter, word and line animations on live text — direction pad, order, spring physics and loops.', side, main, right }).el;
    this.renderGrid();
    // keep the In/Out/Loop summary up to date
    const kv = this.el.querySelector('.kv')!;
    setInterval(() => {
      const b = kv.querySelectorAll('b');
      b[0].textContent = MOTIONS.find((x) => x.id === c.inId)?.label ?? 'None';
      b[1].textContent = MOTIONS.find((x) => x.id === c.outId)?.label ?? 'None';
      b[2].textContent = LOOPS.find((x) => x.id === c.loopId)?.label ?? 'None';
    }, 250);
    registerCommands([
      ...MOTIONS.map((x) => ({ id: 'type.in.' + x.id, label: 'Type In: ' + x.label, group: 'Type', run: () => { c.inId = x.id; this.apply(); } })),
      ...MOTIONS.map((x) => ({ id: 'type.out.' + x.id, label: 'Type Out: ' + x.label, group: 'Type', run: () => { c.outId = x.id; this.apply(); } })),
      ...LOOPS.map((x) => ({ id: 'type.loop.' + x.id, label: 'Type Loop: ' + x.label, group: 'Type', run: () => { c.loopId = x.id; this.apply(); } })),
    ]);
  }

  activate() { this.active = true; const tick = (t: number) => { if (!this.active) return; this.draw(t / 1000); this.raf = requestAnimationFrame(tick); }; this.raf = requestAnimationFrame(tick); }
  deactivate() { this.active = false; cancelAnimationFrame(this.raf); }

  private renderGrid() {
    clear(this.grid);
    const c = this.c;
    const save = () => { try { localStorage.setItem(LS, JSON.stringify(c)); } catch { /* */ } };
    if (c.phase === 'loop') {
      const t = Tiles([{ id: '__none', label: 'None' }, ...LOOPS.map((x) => ({ id: x.id, label: x.label }))], {
        onPick: (x) => { c.loopId = x.id === '__none' ? null : x.id; save(); t.refresh(); }, isOn: (x) => (c.loopId ?? '__none') === x.id, min: 130,
      });
      this.grid.appendChild(Group('Loops & emphasis', [t.el]));
      return;
    }
    for (const g of MOTION_GROUPS) {
      const items = MOTIONS.filter((x) => x.group === g).map((x) => ({ id: x.id, label: x.label, sub: x.dir ? 'uses direction' : x.threeD ? '3D per character' : '' }));
      const t = Tiles(g === MOTION_GROUPS[0] ? [{ id: '__none', label: 'None', sub: '' }, ...items] : items, {
        onPick: (x) => {
          const id = x.id === '__none' ? null : x.id;
          const mo = MOTIONS.find((q) => q.id === id);
          if (c.phase === 'in') { c.inId = id; if (mo?.ease) c.inEase = mo.ease; } else { c.outId = id; }
          save(); this.renderGrid(); refreshAll();
        },
        isOn: (x) => ((c.phase === 'in' ? c.inId : c.outId) ?? '__none') === x.id,
        min: 128,
      });
      this.grid.appendChild(Group(g, [t.el]));
    }
  }

  private phase(which: 'in' | 'out'): PhaseOpts | null {
    const c = this.c;
    const id = which === 'in' ? c.inId : c.outId;
    const motion = MOTIONS.find((x) => x.id === id);
    if (!motion) return null;
    return { motion, dir: which === 'in' ? c.inDir : c.outDir, strength: c.strength, unit: which === 'in' ? c.inUnit : c.outUnit, order: which === 'in' ? c.inOrder : c.outOrder, ease: easeById(which === 'in' ? c.inEase : c.outEase) };
  }

  private async apply() {
    const c = this.c;
    const loopM = LOOPS.find((x) => x.id === c.loopId);
    const recipe = buildType(this.phase('in'), this.phase('out'), loopM ? { motion: loopM, unit: c.loopUnit, strength: c.strength } : null,
      { inDur: c.inDur, outDur: c.outDur, stagger: c.stagger, autoFit: c.autoFit, seed: c.seed, speed: c.speed });
    if (!recipe.animators.length) { toast('Pick an In, Out or Loop animation first', 'info'); return; }
    try { const r = await call<{ layers: number }>('typeApply', recipe); toast(`Type animation → ${r.layers} text layer(s)`); }
    catch (e: any) { toast(e.message, 'err', 6000); }
  }
  private async clear() {
    try { const r = await call<{ layers: number }>('typeClear'); toast(`Removed from ${r.layers} layer(s)`); } catch (e: any) { toast(e.message, 'err'); }
  }

  // ───────── preview ─────────
  private draw(time: number) {
    const cv = this.preview, r = cv.getBoundingClientRect();
    if (r.width < 2) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height;
    g.clearRect(0, 0, W, H);
    const c = this.c;
    const text = c.sample;
    const size = Math.min(44, (W * 1.5) / Math.max(6, text.length));
    g.font = `800 ${size}px "Space Grotesk", Inter, sans-serif`;
    g.textBaseline = 'middle';
    const inP = this.phase('in'), outP = this.phase('out'), loopM = LOOPS.find((x) => x.id === c.loopId);
    const life = 3.2, cycle = life + 0.6;
    const t = time % cycle;
    if (t > life) return;
    // units
    const chars = Array.from(text);
    const total = g.measureText(text).width;
    let x = (W - total) / 2;
    const glyphs = chars.map((ch) => { const w = g.measureText(ch).width; const o = { ch, x, w }; x += w; return o; });
    const wordIdx: number[] = [], lineIdx: number[] = [];
    let wi = -1, prevSpace = true, ci = 0;
    const charIdx: number[] = [];
    glyphs.forEach((gl) => { const sp = /\s/.test(gl.ch); if (!sp && prevSpace) wi++; prevSpace = sp; wordIdx.push(Math.max(0, wi)); lineIdx.push(0); charIdx.push(sp ? -1 : ci++); });
    const counts = { char: ci, word: wi + 1, line: 1 };
    const idxOf = (u: Unit, k: number) => (u === 'char' ? charIdx[k] : u === 'word' ? wordIdx[k] : lineIdx[k]);
    glyphs.forEach((gl, k) => {
      if (/\s/.test(gl.ch)) return;
      let ox = 0, oy = 0, sc = 1, rot = 0, op = 1, blur = 0;
      const applyP = (pr: PhaseOpts, out: boolean) => {
        const n = counts[pr.unit], i = idxOf(pr.unit, k);
        const a = previewAmount(pr, out, i, n, t, 0, life, out ? c.outDur : c.inDur, c.stagger, c.seed) / 100;
        const P = pr.motion.props(DIRV[pr.dir], pr.strength);
        if (P.pos) { ox += P.pos[0] * a * 0.5; oy += P.pos[1] * a * 0.5; }
        if (P.scale) sc *= 1 + ((P.scale[1] / 100) - 1) * a;
        if (P.rot) rot += P.rot * a;
        if (P.rotX || P.rotY) sc *= Math.max(0.02, Math.cos(((P.rotX || P.rotY || 0) * a * Math.PI) / 180));
        if (P.opacity !== undefined) op *= 1 - a * (1 - P.opacity / 100);
        if (P.blur) blur += P.blur * a * 0.3;
      };
      if (inP) applyP(inP, false);
      if (outP) applyP(outP, true);
      if (loopM) {
        const n = counts[c.loopUnit], i = idxOf(c.loopUnit, k), S = c.speed / 100;
        // eslint-disable-next-line no-new-func
        const amt = (new Function('i', 'n', 'time', 'S', 'seedRandom', 'random', `return ${loopM.amount};`))(i, n, t, S, () => 0, (a: number, b: number) => a + Math.random() * (b - a)) / 100;
        const P = loopM.props;
        if (P.pos) { ox += P.pos[0] * amt * 0.5; oy += P.pos[1] * amt * 0.5; }
        if (P.scale) sc *= 1 + ((P.scale[0] / 100) - 1) * amt;
        if (P.rot) rot += P.rot * amt;
      }
      g.save();
      g.globalAlpha = Math.max(0, Math.min(1, op));
      if (blur > 0.3) g.filter = `blur(${blur.toFixed(1)}px)`;
      g.translate(gl.x + gl.w / 2 + ox, H / 2 + oy);
      g.rotate((rot * Math.PI) / 180);
      g.scale(sc, sc);
      g.fillStyle = '#f7f7f8';
      g.fillText(gl.ch, -gl.w / 2, 0);
      g.restore();
    });
  }
}
