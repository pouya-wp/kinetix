import { h, Slider, Seg, Btn, Field, Select, Toggle, toast, refreshAll, clear, TextInput, onRefresh, Chips } from '../ui/kit';
import { Tiles, Group } from '../core/page';
import { Flow, Step, More, Picks } from '../ui/flow';
import { call } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { EASE_LIBRARY, easeById } from '../animate/eases';
import { MOTIONS, MOTION_GROUPS, LOOPS, DIRV, buildType, previewAmount, type Unit, type Order, type Dir, type PhaseOpts } from './motions';
import type { Studio } from '../main';

const LS = 'kinetix.type';
const LOOKS_LOOP = (id: string | null) => LOOPS.find((x) => x.id === id);
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
    look: 'fade-up', exit: 'none' as 'none' | 'same' | 'fade',
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

    const LOOKS: { id: string; label: string; in: string; unit: Unit; order: Order; dir: Dir; stagger: number }[] = [
      { id: 'typewriter', label: 'Typewriter', in: 'typewriter', unit: 'char', order: 'start', dir: 'up', stagger: 0.05 },
      { id: 'fade-up', label: 'Soft rise', in: 'fade-dir', unit: 'char', order: 'start', dir: 'up', stagger: 0.03 },
      { id: 'pop', label: 'Pop letters', in: 'pop', unit: 'char', order: 'start', dir: 'up', stagger: 0.035 },
      { id: 'bounce', label: 'Bounce in', in: 'bounce-in', unit: 'char', order: 'start', dir: 'up', stagger: 0.04 },
      { id: 'blur-words', label: 'Blur words', in: 'blur', unit: 'word', order: 'start', dir: 'up', stagger: 0.12 },
      { id: 'slide-words', label: 'Slide words', in: 'fade-dir', unit: 'word', order: 'start', dir: 'left', stagger: 0.1 },
      { id: 'spring', label: 'Spring center', in: 'spring-scale', unit: 'char', order: 'center', dir: 'up', stagger: 0.03 },
      { id: 'flip', label: '3D flip', in: 'flip-x', unit: 'char', order: 'start', dir: 'up', stagger: 0.04 },
      { id: 'scramble', label: 'Scramble', in: 'scramble', unit: 'char', order: 'random', dir: 'up', stagger: 0.03 },
      { id: 'glitch', label: 'Glitch', in: 'glitch', unit: 'char', order: 'random', dir: 'up', stagger: 0.02 },
      { id: 'elastic', label: 'Elastic drop', in: 'elastic-drop', unit: 'char', order: 'start', dir: 'up', stagger: 0.04 },
      { id: 'lines', label: 'Lines rise', in: 'rise', unit: 'line', order: 'start', dir: 'up', stagger: 0.15 },
    ];
    LOOKS.forEach((L) => { this.looks[L.id] = L; });
    const pickLook = (L: typeof LOOKS[number]) => {
      const mo = MOTIONS.find((x) => x.id === L.in);
      c.inId = L.in; c.inUnit = L.unit; c.inOrder = L.order; c.inDir = L.dir; c.stagger = L.stagger; c.look = L.id;
      if (mo?.ease) c.inEase = mo.ease;
      this.syncExit(); save(); this.renderGrid(); refreshAll();
    };
    const looks = Picks(LOOKS, {
      isOn: (t) => c.look === t.id, onPick: pickLook,
      preview: (t) => this.mini(t.id),
      min: 132,
    });
    const exits = Chips<'none' | 'same' | 'fade'>([{ value: 'none', label: 'Stays on screen' }, { value: 'same', label: 'Same, reversed' }, { value: 'fade', label: 'Fade away' }], () => c.exit, (v) => { c.exit = v; this.syncExit(); save(); refreshAll(); });
    const loopChips = Chips<string>([{ value: '', label: 'None' }, ...LOOPS.map((x) => ({ value: x.id, label: x.label }))], () => c.loopId ?? '', (v) => { c.loopId = v || null; save(); refreshAll(); });
    const body = [
      this.preview,
      Step(1, 'Pick a look', [looks.el]),
      Step(2, 'Speed', [h('div', { class: 'row' },
        Slider({ label: 'Duration', min: 0.1, max: 2, step: 0.01, unit: ' s', get: () => c.inDur, set: (v) => { c.inDur = v; c.outDur = Math.max(0.1, +(v * 0.75).toFixed(2)); save(); } }),
        Slider({ label: 'Delay between', min: 0, max: 0.3, step: 0.005, unit: ' s', get: () => c.stagger, set: set('stagger') }))]),
      Step(3, 'Leaving & looping', [exits, h('div', { class: 'lbl' }, 'While on screen'), loopChips], 'optional'),
      More('type-adv', [
        Field('Preview text', TextInput({ get: () => c.sample, set: (v) => { c.sample = v || 'Kinetix Type'; save(); } })),
        Seg<Phase>([{ value: 'in', label: 'Edit IN' }, { value: 'out', label: 'Edit OUT' }], () => (c.phase === 'loop' ? 'in' : c.phase), (v) => { c.phase = v; save(); this.renderGrid(); refreshAll(); }),
        h('div', { class: 'row' }, h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'lbl' }, 'Direction'), pad()), h('div', { class: 'stack grow' }, unitSeg(), Field('Order', orderSeg()))),
        this.grid,
        h('div', { class: 'row' },
          Field('In ease', Select(easeOpts, () => c.inEase, set('inEase'))),
          Field('Out ease', Select(easeOpts, () => c.outEase, set('outEase')))),
        h('div', { class: 'row' },
          Slider({ label: 'Strength', min: 0.1, max: 3, step: 0.05, get: () => c.strength, set: set('strength') }),
          Slider({ label: 'Loop speed', min: 5, max: 400, unit: ' %', get: () => c.speed, set: set('speed') })),
        h('div', { class: 'row' },
          Toggle('Fit the whole text into 1.2 s', () => c.autoFit, set('autoFit')),
          Slider({ label: 'Random seed', min: 1, max: 999, get: () => c.seed, set: set('seed') })),
        Btn('Remove Kinetix type animation from selected layers', () => this.clear(), { variant: 'danger', size: 'sm' }),
      ], 'All motions & fine control'),
    ];
    this.el = Flow({
      title: 'Type', sub: 'Animate text letter by letter, word by word or line by line. The text stays live — change words or font any time.',
      body, action: { label: 'Animate selected text', icon: 'send', need: 'text', run: () => this.apply() },
    }).el;
    this.renderGrid();
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
        onPick: (x) => { c.loopId = x.id === '__none' ? null : x.id; save(); t.refresh(); refreshAll(); }, isOn: (x) => (c.loopId ?? '__none') === x.id, min: 130,
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
  private minis: { c: HTMLCanvasElement; look: string }[] = [];
  private looks: Record<string, { in: string; unit: Unit; order: Order; dir: Dir; stagger: number }> = {};
  private mini(look: string) {
    const c = h('canvas') as HTMLCanvasElement;
    this.minis.push({ c, look });
    return c;
  }
  /** Out follows the chosen exit: nothing, the same motion reversed, or a fade. */
  private syncExit() {
    const c = this.c;
    if (c.exit === 'none') c.outId = null;
    else if (c.exit === 'fade') { c.outId = 'fade'; c.outUnit = 'line'; c.outOrder = 'start'; c.outEase = 'cubicIn'; }
    else { c.outId = c.inId; c.outUnit = c.inUnit; c.outOrder = c.inOrder === 'start' ? 'end' : c.inOrder; c.outDir = c.inDir; c.outEase = 'expoIn'; }
  }
  private draw(time: number) {
    this.paint(this.preview, time, this.phase('in'), this.phase('out'), LOOKS_LOOP(this.c.loopId), this.c.sample, false);
    for (const m of this.minis) {
      const L = this.looks[m.look];
      const motion = L && MOTIONS.find((x) => x.id === L.in);
      if (motion) this.paint(m.c, time, { motion, dir: L.dir, strength: 1, unit: L.unit, order: L.order, ease: easeById(motion.ease ?? 'expoOut') }, null, undefined, L.unit === 'line' ? 'Ab' : 'Abc', true, L.stagger);
    }
  }
  private paint(cv: HTMLCanvasElement, time: number, inP: PhaseOpts | null, outP: PhaseOpts | null, loopM: (typeof LOOPS)[number] | undefined, text: string, small: boolean, staggerOverride?: number) {
    const r = cv.getBoundingClientRect();
    if (r.width < 2 || r.bottom < 0 || r.top > innerHeight) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height;
    g.clearRect(0, 0, W, H);
    const c = this.c;
    const stagger = staggerOverride ?? c.stagger;
    const size = small ? Math.min(30, H * 0.55) : Math.min(44, (W * 1.5) / Math.max(6, text.length));
    g.font = `800 ${size}px "Space Grotesk", Inter, sans-serif`;
    g.textBaseline = 'middle';
    const life = small ? 1.8 : 3.2, cycle = life + 0.6;
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
        const a = previewAmount(pr, out, i, n, t, 0, life, small ? 0.45 : out ? c.outDur : c.inDur, stagger, c.seed) / 100;
        const P = pr.motion.props(DIRV[pr.dir], pr.strength);
        const ps = small ? 0.25 : 0.5;
        if (P.pos) { ox += P.pos[0] * a * ps; oy += P.pos[1] * a * ps; }
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
      g.fillStyle = small ? '#d1fe17' : '#f7f7f8';
      g.fillText(gl.ch, -gl.w / 2, 0);
      g.restore();
    });
  }
}
