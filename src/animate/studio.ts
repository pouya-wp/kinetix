import { h, Slider, Btn, Field, Select, toast, refreshAll, clear, Chips } from '../ui/kit';
import { Flow, Step, More, Tabs, Picks } from '../ui/flow';
import { bakeSelected } from '../core/bake';
import { call } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { EASE_LIBRARY, EASE_GROUPS, easeById, easeThumb, easeExprFn, easeFn, type EaseDef } from './eases';
import { ANIM_LIBRARY, ANIM_GROUPS, animById, buildRecipe, evalSnippet, type AnimDef } from './inout';
import { WIGGLES, buildWiggle, LOOPS } from './wiggle';
import type { Studio } from '../main';

type Tab = 'ease' | 'inout' | 'wiggle';
const LS = 'kinetix.animate';

// hand-picked starting points — the full libraries stay one click away under “More”
const TOP_EASES: [string, string][] = [
  ['easyEase', 'Smooth'], ['cinematic', 'Cinematic'], ['swift', 'Snappy'], ['glide', 'Glide'], ['mdEmph', 'Fast out'], ['overshoot', 'Overshoot'],
  ['anticipate', 'Wind-up'], ['springDefault', 'Spring'], ['springBouncy', 'Bouncy'], ['elasticOut', 'Elastic'], ['bounceOut', 'Bounce'], ['slowMo', 'Slow-mo'],
];
const TOP_IN = ['fade', 'fade-up', 'pop', 'squash-pop', 'slide-up', 'zoom-in', 'blur-in', 'drop', 'rotate-in', 'flip-y', 'wipe-right', 'melt'];
const TOP_OUT = ['fade', 'fade-down', 'zoom-out', 'pop', 'slide-down', 'blur-in', 'spin-in', 'melt', 'glitch', 'dissolve'];
const PROPS = [{ value: 'position', label: 'Position' }, { value: 'scale', label: 'Scale' }, { value: 'rotation', label: 'Rotation' }, { value: 'opacity', label: 'Opacity' }];

export class AnimateStudio implements Studio {
  id = 'animate';
  el: HTMLElement;
  private tab: Tab = 'inout';
  private ease = 'easyEase';
  private easeGroup = 'Design';
  private spring = { k: 12, z: 0.45 };
  private inId: string | null = 'pop';
  private outId: string | null = 'fade-down';
  private inEase = 'overshoot';
  private outEase = 'cubicIn';
  private inDur = 0.6;
  private outDur = 0.45;
  private strength = 1;
  private allGroup = 'Basic';
  private allFor: 'in' | 'out' = 'in';
  private wig = { id: 'smooth', prop: 'position', freq: 2, amp: 30, seed: 1, loop: 4 };
  private body: HTMLElement;
  private preview: HTMLCanvasElement;
  private minis: { c: HTMLCanvasElement; draw: (g: CanvasRenderingContext2D, W: number, H: number, t: number) => void }[] = [];
  private raf = 0;
  private active = false;

  constructor() {
    try { const s = JSON.parse(localStorage.getItem(LS) || '{}'); Object.assign(this, s.cfg ?? {}); } catch { /* first run */ }
    this.body = h('div', { class: 'stack', style: { gap: '16px' } });
    this.preview = h('canvas', { style: { width: '100%', height: '120px', display: 'block', borderRadius: '14px', background: 'var(--bg-deep)' } });
    const tabs = Tabs<Tab>([{ id: 'inout', label: 'Appear & disappear' }, { id: 'ease', label: 'Smooth keyframes' }, { id: 'wiggle', label: 'Shake & loop' }], () => this.tab, (v) => { this.tab = v; this.render(); });
    const page = Flow({
      title: 'Animate', sub: 'Give any layer an entrance and exit, make keyframes feel great, or add shake and loops — one click each.',
      tabs, body: [this.preview, this.body],
      action: {
        label: 'Apply', icon: 'send',
        need: () => (this.tab === 'ease' ? 'keys' : 'layers'),
        run: () => (this.tab === 'ease' ? this.applyEase() : this.tab === 'inout' ? this.applyAnim() : this.applyWiggle()),
        secondary: [Btn('Bake', () => bakeSelected(), { variant: 'ghost', title: 'Turn Kinetix animation on the selected layers into plain keyframes (faster renders)' })],
      },
    });
    this.el = page.el;
    this.render();
    registerCommands([
      ...EASE_LIBRARY.map((e) => ({ id: 'ease.' + e.id, label: 'Ease: ' + e.label, group: 'Ease', keywords: e.group, run: () => { this.ease = e.id; this.applyEase(); } })),
      ...ANIM_LIBRARY.map((a) => ({ id: 'in.' + a.id, label: 'In: ' + a.label, group: 'In / Out', keywords: a.group, run: () => { this.inId = a.id; this.applyAnim(); } })),
      ...ANIM_LIBRARY.map((a) => ({ id: 'out.' + a.id, label: 'Out: ' + a.label, group: 'In / Out', keywords: a.group, run: () => { this.outId = a.id; this.applyAnim(); } })),
      { id: 'anim.clear', label: 'Remove Kinetix animations from selected layers', group: 'In / Out', run: () => this.clearAnim() },
    ]);
  }

  activate() { this.active = true; this.loop(); }
  deactivate() { this.active = false; cancelAnimationFrame(this.raf); }

  private save() {
    try {
      const cfg = { tab: this.tab, ease: this.ease, inId: this.inId, outId: this.outId, inEase: this.inEase, outEase: this.outEase, inDur: this.inDur, outDur: this.outDur, strength: this.strength, wig: this.wig, spring: this.spring };
      localStorage.setItem(LS, JSON.stringify({ cfg }));
    } catch { /* storage blocked */ }
  }

  private render() {
    clear(this.body);
    this.minis = [];
    this.save();
    if (this.tab === 'ease') this.easePage();
    else if (this.tab === 'inout') this.inoutPage();
    else this.wigglePage();
    refreshAll();
  }

  private mini(draw: (g: CanvasRenderingContext2D, W: number, H: number, t: number) => void) {
    const c = h('canvas') as HTMLCanvasElement;
    this.minis.push({ c, draw });
    return c;
  }

  // ───────── Appear & disappear ─────────
  private inoutPage() {
    const tile = (id: string | null) => {
      const a = animById(id);
      return { id: id ?? '__none', label: a?.label ?? 'None', sub: '' };
    };
    const ins = Picks([tile(null), ...TOP_IN.map(tile)], {
      isOn: (t) => (this.inId ?? '__none') === t.id,
      onPick: (t) => { this.inId = t.id === '__none' ? null : t.id; this.save(); },
      preview: (t) => this.mini((g, W, H, time) => this.drawCard(g, W, H, time, t.id === '__none' ? null : animById(t.id), null, 0.45)),
      min: 118,
    });
    const outs = Picks([tile(null), ...TOP_OUT.map(tile)], {
      isOn: (t) => (this.outId ?? '__none') === t.id,
      onPick: (t) => { this.outId = t.id === '__none' ? null : t.id; this.save(); },
      preview: (t) => this.mini((g, W, H, time) => this.drawCard(g, W, H, time, null, t.id === '__none' ? null : animById(t.id), 0.45)),
      min: 118,
    });
    // full library
    const allBox = h('div', { class: 'stack' });
    const drawAll = () => {
      clear(allBox);
      const items = ANIM_LIBRARY.filter((a) => a.group === this.allGroup).map((a) => ({ id: a.id, label: a.label }));
      const p = Picks(items, {
        isOn: (t) => (this.allFor === 'in' ? this.inId : this.outId) === t.id,
        onPick: (t) => { if (this.allFor === 'in') this.inId = t.id; else this.outId = t.id; this.save(); ins.refresh(); outs.refresh(); },
        min: 118,
      });
      allBox.append(p.el);
    };
    drawAll();
    this.body.append(
      Step(1, 'How it appears', [ins.el]),
      Step(2, 'How it disappears', [outs.el]),
      Step(3, 'Speed', [h('div', { class: 'row' },
        Slider({ label: 'Duration', min: 0.1, max: 2.5, step: 0.05, unit: ' s', get: () => this.inDur, set: (v) => { this.inDur = v; this.outDur = Math.max(0.1, +(v * 0.75).toFixed(2)); this.save(); } }),
        Slider({ label: 'Strength', min: 0.2, max: 2.5, step: 0.05, get: () => this.strength, set: (v) => { this.strength = v; this.save(); } }))],
        'follows the layer’s in/out points'),
      More('anim-all', [
        h('div', { class: 'row wrap' },
          Chips<'in' | 'out'>([{ value: 'in', label: 'Choose for IN' }, { value: 'out', label: 'Choose for OUT' }], () => this.allFor, (v) => { this.allFor = v; drawAll(); refreshAll(); }),
          Select(ANIM_GROUPS.map((g) => ({ value: g, label: g })), () => this.allGroup, (v) => { this.allGroup = v; drawAll(); })),
        allBox,
      ], `All ${ANIM_LIBRARY.length} styles`),
      More('anim-adv', [
        h('div', { class: 'row' },
          Slider({ label: 'In duration', min: 0.05, max: 4, step: 0.05, unit: ' s', get: () => this.inDur, set: (v) => { this.inDur = v; this.save(); } }),
          Slider({ label: 'Out duration', min: 0.05, max: 4, step: 0.05, unit: ' s', get: () => this.outDur, set: (v) => { this.outDur = v; this.save(); } })),
        h('div', { class: 'row' },
          Field('In ease', Select(EASE_LIBRARY.map((e) => ({ value: e.id, label: e.label })), () => this.inEase, (v) => { this.inEase = v; this.save(); })),
          Field('Out ease', Select(EASE_LIBRARY.map((e) => ({ value: e.id, label: e.label })), () => this.outEase, (v) => { this.outEase = v; this.save(); }))),
        Btn('Remove Kinetix animation from selected layers', () => this.clearAnim(), { variant: 'danger', size: 'sm' }),
      ]),
    );
  }

  // ───────── Smooth keyframes ─────────
  private easePage() {
    const top = Picks(TOP_EASES.map(([id, label]) => ({ id, label })), {
      isOn: (t) => t.id === this.ease,
      onPick: (t) => { this.ease = t.id; this.save(); },
      preview: (t) => easeThumb(easeById(t.id), 140, 56),
      min: 118,
    });
    const allBox = h('div');
    const drawAll = () => {
      clear(allBox);
      const p = Picks(EASE_LIBRARY.filter((e) => e.group === this.easeGroup).map((e) => ({ id: e.id, label: e.label })), {
        isOn: (t) => t.id === this.ease, onPick: (t) => { this.ease = t.id; this.save(); top.refresh(); }, preview: (t) => easeThumb(easeById(t.id), 140, 56), min: 118,
      });
      allBox.append(p.el);
    };
    drawAll();
    this.body.append(
      Step(1, 'Pick a feel', [top.el], 'select 2+ keyframes in AE, then Apply'),
      More('ease-all', [Select(EASE_GROUPS.map((g) => ({ value: g, label: g })), () => this.easeGroup, (v) => { this.easeGroup = v; drawAll(); }), allBox], `All ${EASE_LIBRARY.length} eases`),
      More('ease-adv', [
        h('div', { class: 'hint' }, 'Curves are written as real AE keyframe speed. Springs, elastic and bounce become a small expression that keeps your keyframes.'),
        Btn('Apply as expression instead', () => this.applyEase(true), { variant: 'soft', size: 'sm' }),
        h('div', { class: 'lbl' }, 'Custom spring'),
        h('div', { class: 'row' },
          Slider({ label: 'Stiffness', min: 3, max: 40, step: 0.5, get: () => this.spring.k, set: (v) => { this.spring.k = v; } }),
          Slider({ label: 'Bounciness', min: 0.05, max: 0.98, step: 0.01, get: () => 1 - this.spring.z, set: (v) => { this.spring.z = 1 - v; } })),
        Btn('Apply custom spring', () => this.applySpring(), { size: 'sm', variant: 'soft' }),
      ]),
    );
  }

  // ───────── Shake & loop ─────────
  private wigglePage() {
    const w = this.wig;
    const t = Picks(WIGGLES.map((x) => ({ id: x.id, label: x.label, sub: x.sub })), {
      isOn: (x) => x.id === w.id, onPick: (x) => { w.id = x.id; this.save(); },
      preview: (x) => this.mini((g, W, H, time) => { const v = buildWiggle(x.id, 'position').preview(time, w.freq, Math.min(18, w.amp * 0.4), w.seed, w.loop); g.fillStyle = '#d1fe17'; g.beginPath(); g.arc(W / 2 + v[0], H / 2 + v[1], 9, 0, 7); g.fill(); }),
      min: 130,
    });
    const loops = Picks(LOOPS.map((x) => ({ id: x.id, label: x.label, sub: x.sub })), { isOn: () => false, onPick: (x) => this.applyExpr(LOOPS.find((l) => l.id === x.id)!.expr, 'selected', [], `Loop: ${x.label}`, 'KX-LOOP'), min: 130 });
    this.body.append(
      Step(1, 'Pick a motion', [t.el]),
      Step(2, 'Adjust', [
        Chips(PROPS, () => w.prop, (v) => { w.prop = v; this.save(); refreshAll(); }),
        h('div', { class: 'row' },
          Slider({ label: 'Amount', min: 0, max: 400, get: () => w.amp, set: (v) => { w.amp = v; this.save(); } }),
          Slider({ label: 'Speed', min: 0.1, max: 12, step: 0.1, unit: ' /s', get: () => w.freq, set: (v) => { w.freq = v; this.save(); } }))]),
      More('wig-adv', [
        h('div', { class: 'row' },
          Slider({ label: 'Loop every', min: 0, max: 20, step: 0.1, unit: ' s', get: () => w.loop, set: (v) => { w.loop = v; this.save(); }, title: '0 = no loop' }),
          Slider({ label: 'Variation (seed)', min: 1, max: 999, get: () => w.seed, set: (v) => { w.seed = v; this.save(); } })),
        h('div', { class: 'lbl' }, 'Loop existing keyframes — select the properties in AE, then click'),
        loops.el,
      ]),
    );
  }

  // ───────── AE actions ─────────
  private async applyEase(forceExpr = false) {
    const e = easeById(this.ease);
    try {
      const r = e.bezier && !forceExpr
        ? await call<{ keys: number; props: number }>('easeApplyKeys', { bezier: e.bezier })
        : await call<{ props: number }>('exprApply', { target: 'selectedProps', expr: easeExpression(e), marker: 'KX-EASE', label: e.label });
      toast(`${e.label} → ${'keys' in r ? r.keys + ' keyframes on ' : ''}${r.props} propert${r.props === 1 ? 'y' : 'ies'}`);
    } catch (err: any) { toast(err.message, 'err', 6000); }
  }
  private applySpring() {
    const { k, z } = this.spring;
    const e: EaseDef = { id: 'custom-spring', label: `Spring ${k}/${z.toFixed(2)}`, group: 'Spring', src: `var w=${k},z=${z};if(t<=0)return 0;if(t>=1)return 1;var wd=w*Math.sqrt(1-z*z);var e=1-Math.exp(-z*w*t)*(Math.cos(wd*t)+(z*w/wd)*Math.sin(wd*t));var e1=1-Math.exp(-z*w)*(Math.cos(wd)+(z*w/wd)*Math.sin(wd));return e+(1-e1)*t;` };
    call('exprApply', { target: 'selectedProps', expr: easeExpression(e), marker: 'KX-EASE', label: e.label }).then((r: any) => toast(`Spring applied to ${r.props} propert${r.props === 1 ? 'y' : 'ies'}`)).catch((er) => toast(er.message, 'err'));
  }
  private async applyAnim() {
    const recipe = buildRecipe(animById(this.inId), animById(this.outId), easeById(this.inEase), easeById(this.outEase), this.inDur, this.outDur, this.strength);
    try {
      const r = await call<{ layers: number }>('animApply', recipe);
      toast(`${animById(this.inId)?.label ?? 'No in'} / ${animById(this.outId)?.label ?? 'no out'} → ${r.layers} layer(s)`);
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }
  private async clearAnim() {
    try { const r = await call<{ layers: number }>('animClear'); toast(`Cleared ${r.layers} layer(s)`); } catch (e: any) { toast(e.message, 'err'); }
  }
  private applyWiggle() {
    const w = this.wig;
    const b = buildWiggle(w.id, w.prop);
    return this.applyExpr(b.expr, w.prop, [
      { name: 'KX Wiggle Speed', value: w.freq }, { name: 'KX Wiggle Amount', value: w.amp }, { name: 'KX Wiggle Seed', value: w.seed }, { name: 'KX Loop Length', value: w.loop },
    ], b.label, 'KX-WIGGLE');
  }
  private async applyExpr(expr: string, prop: string, controls: { name: string; value: number }[], label: string, marker = 'KX-EXPR') {
    try {
      const r = await call<{ props: number }>('exprApply', { target: prop === 'selected' ? 'selectedProps' : 'layerProp', prop, expr, controls, marker, label });
      toast(`${label} → ${r.props} propert${r.props === 1 ? 'y' : 'ies'}`);
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }

  // ───────── previews ─────────
  private loop() {
    const tick = (now: number) => {
      if (!this.active) return;
      const t = now / 1000;
      this.paint(this.preview, (g, W, H) => this.drawMain(g, W, H, t));
      for (const m of this.minis) this.paint(m.c, (g, W, H) => m.draw(g, W, H, t));
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  private paint(c: HTMLCanvasElement, fn: (g: CanvasRenderingContext2D, W: number, H: number) => void) {
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.bottom < 0 || r.top > innerHeight) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    fn(g, r.width, r.height);
  }
  private drawMain(g: CanvasRenderingContext2D, W: number, H: number, time: number) {
    if (this.tab === 'ease') {
      const f = easeFn(easeById(this.ease)), t = Math.min(1, (time % 2) / 1.4), v = f(t);
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 2; g.beginPath(); g.moveTo(30, H / 2); g.lineTo(W - 30, H / 2); g.stroke();
      g.fillStyle = '#d1fe17'; g.beginPath(); g.arc(30 + (W - 60) * v, H / 2, 14, 0, 7); g.fill();
      return;
    }
    if (this.tab === 'wiggle') {
      const v = buildWiggle(this.wig.id, 'position').preview(time, this.wig.freq, Math.min(40, this.wig.amp), this.wig.seed, this.wig.loop);
      g.fillStyle = '#d1fe17'; g.beginPath(); g.arc(W / 2 + v[0], H / 2 + v[1], 14, 0, 7); g.fill();
      return;
    }
    this.drawCard(g, W, H, time, animById(this.inId), animById(this.outId), 1);
  }
  /** A card that enters, holds and exits — the same expression snippets AE runs. */
  private drawCard(g: CanvasRenderingContext2D, W: number, H: number, time: number, inA: AnimDef | null, outA: AnimDef | null, scale: number) {
    const inDur = this.inDur, outDur = this.outDur;
    const hold = inA && !outA ? 0.9 : !inA && outA ? 0.5 : 0.8;
    const life = (inA ? inDur : 0) + hold + (outA ? outDur : 0);
    const t = time % (life + 0.45);
    if (t > life) return;
    const ri = inA ? Math.min(1, t / inDur) : 1, ro = outA ? Math.min(1, (life - t) / outDur) : 1;
    const ei = easeFn(easeById(this.inEase))(ri), eo = easeFn(easeById(this.outEase))(ro);
    const cw = Math.min(150 * scale + 20, W * 0.55), ch = Math.max(18, 54 * scale);
    const env = { k: this.strength, W: cw, H: ch, CW: W, CH: H, time };
    const run = (key: keyof AnimDef['props'], v: any) => evalSnippet(outA?.props[key], evalSnippet(inA?.props[key], v, ei, ri, env), eo, ro, env);
    const pos = run('position', [W / 2, H / 2]), sc = run('scale', [100, 100]), rot = run('rotation', 0), op = run('opacity', 100);
    const rx = run('rotationX', 0), ry = run('rotationY', 0);
    const fxVis = (name: string) => [inA, outA].some((a) => a?.fx?.some((f) => f.match === name));
    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, op / 100));
    g.translate(pos[0], pos[1]);
    g.rotate((rot * Math.PI) / 180);
    g.scale((sc[0] / 100) * Math.cos((ry * Math.PI) / 180), (sc[1] / 100) * Math.cos((rx * Math.PI) / 180));
    const vis = Math.min(ri, ro);
    if (fxVis('ADBE Box Blur2') || fxVis('ADBE Motion Blur') || fxVis('ADBE Wave Warp')) g.filter = `blur(${((1 - vis) * 8 * scale).toFixed(1)}px)`;
    if (fxVis('ADBE Linear Wipe') || fxVis('ADBE Radial Wipe') || fxVis('ADBE Venetian Blinds') || fxVis('ADBE Block Dissolve')) { g.beginPath(); g.rect(-cw / 2, -ch / 2, cw * vis, ch); g.clip(); }
    g.fillStyle = '#d1fe17';
    g.beginPath(); g.roundRect(-cw / 2, -ch / 2, cw, ch, 12 * scale + 4); g.fill();
    if (scale >= 1) { g.fillStyle = '#1a1a1a'; g.font = '700 18px "Space Grotesk", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('KINETIX', 0, 1); }
    g.restore();
  }
}

/** Expression that re-times the segment between each pair of keyframes with an ease. */
export function easeExpression(e: EaseDef) {
  return `// KX-EASE ${e.label}
${easeExprFn(e, 'E')}
var n=0;if(numKeys>1){n=nearestKey(time).index;if(key(n).time>time)n--;}
function L(a,b,s){if(a instanceof Array){var r=[];for(var i=0;i<a.length;i++)r.push(a[i]+(b[i]-a[i])*s);return r;}return a+(b-a)*s;}
if(n>=1&&n<numKeys){var t1=key(n).time,t2=key(n+1).time;L(key(n).value,key(n+1).value,E((time-t1)/(t2-t1)));}else value;`;
}
