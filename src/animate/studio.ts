import { h, Section, Slider, Seg, Btn, Field, Select, Toggle, toast, refreshAll, onRefresh, clear } from '../ui/kit';
import { bakeSelected } from '../core/bake';
import { Page, Tiles, Group } from '../core/page';
import { call } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { EASE_LIBRARY, EASE_GROUPS, easeById, easeThumb, easeExprFn, easeFn, type EaseDef } from './eases';
import { ANIM_LIBRARY, ANIM_GROUPS, animById, buildRecipe, evalSnippet, type AnimDef } from './inout';
import { WIGGLES, buildWiggle, LOOPS } from './wiggle';
import type { Studio } from '../main';

type Tab = 'ease' | 'inout' | 'wiggle';
const LS = 'kinetix.animate';

export class AnimateStudio implements Studio {
  id = 'animate';
  el: HTMLElement;
  private tab: Tab = 'ease';
  private ease = 'easyEase';
  private easeGroup = 'All';
  private easeQuery = '';
  private spring = { k: 12, z: 0.45 };
  private favs = new Set<string>();
  private inId: string | null = 'pop';
  private outId: string | null = 'fade-down';
  private pick: 'in' | 'out' = 'in';
  private inEase = 'overshoot';
  private outEase = 'cubicIn';
  private inDur = 0.6;
  private outDur = 0.45;
  private strength = 1;
  private animGroup = 'All';
  private wig = { id: 'smooth', prop: 'position', freq: 2, amp: 30, seed: 1, loop: 4 };
  private body: HTMLElement;
  private preview: HTMLCanvasElement;
  private raf = 0;
  private active = false;

  constructor() {
    try { const s = JSON.parse(localStorage.getItem(LS) || '{}'); Object.assign(this, s.cfg ?? {}); this.favs = new Set(s.favs ?? []); } catch { /* */ }
    this.body = h('div', { class: 'stack', style: { gap: '20px' } });
    this.preview = h('canvas', { style: { width: '100%', height: '170px', display: 'block', borderRadius: '14px', background: 'var(--bg-deep)' } });
    const tabs = Seg<Tab>([{ value: 'ease', label: 'Ease Library' }, { value: 'inout', label: 'In / Out' }, { value: 'wiggle', label: 'Wiggle & Loop' }], () => this.tab, (v) => { this.tab = v; this.render(); });
    const page = Page({
      title: 'Animate',
      sub: 'Eases, entrance & exit animations and procedural motion — applied to whatever you select in After Effects.',
      extra: h('div', { style: { width: '380px', maxWidth: '100%' } }, tabs),
      main: [this.body],
      right: [Section('Preview', [this.preview, h('div', { class: 'hint' }, 'Live preview of the current selection.')], { color: 'var(--lime)' }), this.inspector()],
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
      localStorage.setItem(LS, JSON.stringify({ cfg, favs: [...this.favs] }));
    } catch { /* */ }
  }

  // ───────── pages ─────────
  private render() {
    clear(this.body);
    this.save();
    if (this.tab === 'ease') this.easePage();
    else if (this.tab === 'inout') this.inoutPage();
    else this.wigglePage();
    refreshAll();
  }

  private easePage() {
    const search = h('input', { class: 'input', placeholder: `Search ${EASE_LIBRARY.length} eases…`, value: this.easeQuery, style: { fontFamily: 'var(--font-ui)' } }) as HTMLInputElement;
    search.addEventListener('keydown', (e) => e.stopPropagation());
    const gridBox = h('div');
    const draw = () => {
      clear(gridBox);
      const q = this.easeQuery.toLowerCase();
      const groups = this.easeGroup === 'Favorites' ? ['Favorites'] : this.easeGroup === 'All' ? EASE_GROUPS : [this.easeGroup];
      for (const g of groups) {
        const items = EASE_LIBRARY.filter((e) => (g === 'Favorites' ? this.favs.has(e.id) : e.group === g) && (!q || e.label.toLowerCase().includes(q)));
        if (!items.length) continue;
        const t = Tiles(items.map((e) => ({ id: e.id, label: e.label, sub: e.bezier ? 'keyframe' : 'expression' })), {
          onPick: (x) => { this.ease = x.id; t.refresh(); refreshAll(); },
          isOn: (x) => x.id === this.ease,
          preview: (x) => easeThumb(easeById(x.id), 130, 56),
          min: 132,
        });
        gridBox.appendChild(Group(g, [t.el]));
      }
    };
    search.addEventListener('input', () => { this.easeQuery = search.value; draw(); });
    const chips = h('div', { class: 'chips' }, ...['All', 'Favorites', ...EASE_GROUPS].map((g) => {
      const b = h('button', { class: 'chip' + (g === this.easeGroup ? ' on' : '') }, g);
      b.addEventListener('click', () => { this.easeGroup = g; this.render(); });
      return b;
    }));
    draw();
    this.body.append(
      h('div', { class: 'panel-card' }, search, chips,
        h('div', { class: 'row' },
          Btn('Apply to selected keyframes', () => this.applyEase(), { variant: 'primary', icon: 'send' }),
          Btn('Apply as expression', () => this.applyEase(true), { variant: 'soft' })),
        h('div', { class: 'hint' }, 'Select keyframes in the timeline (2 or more on a property). Curve eases are written as native AE keyframe velocity; Elastic / Bounce / Spring become an expression that keeps your keyframes.')),
      gridBox,
    );
  }

  private inoutPage() {
    const chips = h('div', { class: 'chips' }, ...['All', ...ANIM_GROUPS].map((g) => {
      const b = h('button', { class: 'chip' + (g === this.animGroup ? ' on' : '') }, g);
      b.addEventListener('click', () => { this.animGroup = g; this.render(); });
      return b;
    }));
    const pickSeg = Seg<'in' | 'out'>([{ value: 'in', label: 'Choosing IN' }, { value: 'out', label: 'Choosing OUT' }], () => this.pick, (v) => { this.pick = v; this.render(); });
    const grid = h('div', { class: 'stack', style: { gap: '18px' } });
    const groups = this.animGroup === 'All' ? ANIM_GROUPS : [this.animGroup];
    for (const g of groups) {
      const items = ANIM_LIBRARY.filter((a) => a.group === g);
      const t = Tiles([{ id: '__none', label: 'None' } as any, ...items].filter((x, i) => i > 0 || g === groups[0]), {
        onPick: (x) => { const id = x.id === '__none' ? null : x.id; if (this.pick === 'in') this.inId = id; else this.outId = id; this.save(); this.render(); },
        isOn: (x) => (this.pick === 'in' ? this.inId : this.outId) === (x.id === '__none' ? null : x.id),
        min: 118,
      });
      grid.appendChild(Group(g, [t.el]));
    }
    this.body.append(
      h('div', { class: 'panel-card' },
        pickSeg,
        h('div', { class: 'kv' }, h('span', null, 'In'), h('b', null, animById(this.inId)?.label ?? 'None'), h('span', null, 'Out'), h('b', null, animById(this.outId)?.label ?? 'None')),
        chips,
        h('div', { class: 'row' },
          Btn('Apply to selected layers', () => this.applyAnim(), { variant: 'primary', icon: 'send' }),
          Btn('Bake to keyframes', () => bakeSelected(), { variant: 'soft', title: 'Replace Kinetix expressions on the selected layers with plain keyframes — faster renders' }),
          Btn('Remove', () => this.clearAnim(), { variant: 'danger' })),
        h('div', { class: 'hint' }, 'Animations follow the layer’s in/out points — trim or move the layer and they stay attached. Duration, strength and eases stay editable on the layer as KX sliders.')),
      grid,
    );
  }

  private wigglePage() {
    const w = this.wig;
    const t = Tiles(WIGGLES.map((x) => ({ id: x.id, label: x.label, sub: x.sub })), { onPick: (x) => { w.id = x.id; this.render(); }, isOn: (x) => x.id === w.id, min: 150 });
    const loops = Tiles(LOOPS.map((x) => ({ id: x.id, label: x.label, sub: x.sub })), { onPick: (x) => this.applyExpr(LOOPS.find((l) => l.id === x.id)!.expr, 'selected', [], `Loop: ${x.label}`, 'KX-LOOP'), min: 150 });
    this.body.append(
      h('div', { class: 'panel-card' },
        h('div', { class: 'row' },
          Field('Property', Select([{ value: 'position', label: 'Position' }, { value: 'scale', label: 'Scale' }, { value: 'rotation', label: 'Rotation' }, { value: 'opacity', label: 'Opacity' }, { value: 'selected', label: 'Selected properties' }], () => w.prop, (v) => { w.prop = v; this.save(); })),
          Slider({ label: 'Speed (Hz)', min: 0.1, max: 12, step: 0.1, get: () => w.freq, set: (v) => { w.freq = v; this.save(); } })),
        h('div', { class: 'row' },
          Slider({ label: 'Amount', min: 0, max: 400, get: () => w.amp, set: (v) => { w.amp = v; this.save(); } }),
          Slider({ label: 'Loop length (s)', min: 0, max: 20, step: 0.1, get: () => w.loop, set: (v) => { w.loop = v; this.save(); }, title: '0 = no loop' })),
        Slider({ label: 'Seed', min: 1, max: 999, get: () => w.seed, set: (v) => { w.seed = v; this.save(); } }),
        Btn('Apply motion to selected layers', () => this.applyWiggle(), { variant: 'primary', icon: 'send' }),
        Btn('Bake to keyframes', () => bakeSelected(), { variant: 'soft' }),
        h('div', { class: 'hint' }, 'Amount, speed and seed become KX sliders on the layer, so you can keyframe them later.')),
      Group('Procedural motion', [t.el]),
      Group('Loops (apply to selected properties with keyframes)', [loops.el]),
    );
  }

  private inspector() {
    const easeOpts = EASE_LIBRARY.map((e) => ({ value: e.id, label: `${e.group} · ${e.label}` }));
    const box = h('div', { class: 'stack' });
    onRefresh(box, () => {
      const show = this.tab;
      box.querySelectorAll<HTMLElement>('[data-tab]').forEach((x) => (x.style.display = x.dataset.tab === show ? '' : 'none'));
    });
    box.append(
      h('div', { 'data-tab': 'ease', class: 'stack' },
        h('div', { class: 'lbl' }, 'Selected'), (() => { const n = h('b'); onRefresh(n, () => { n.textContent = easeById(this.ease).label; }); return n; })(),
        Btn('★ Favorite', () => { this.favs.has(this.ease) ? this.favs.delete(this.ease) : this.favs.add(this.ease); this.save(); toast(this.favs.has(this.ease) ? 'Added to favorites' : 'Removed from favorites'); }, { size: 'sm' }),
        h('div', { class: 'divider' }),
        h('div', { class: 'lbl' }, 'Spring wizard'),
        Slider({ label: 'Stiffness', min: 3, max: 40, step: 0.5, get: () => this.spring.k, set: (v) => { this.spring.k = v; } }),
        Slider({ label: 'Damping', min: 0.05, max: 0.98, step: 0.01, get: () => this.spring.z, set: (v) => { this.spring.z = v; } }),
        Btn('Apply spring as expression', () => this.applySpring(), { size: 'sm', variant: 'soft' })),
      h('div', { 'data-tab': 'inout', class: 'stack' },
        Slider({ label: 'In duration (s)', min: 0.05, max: 4, step: 0.05, get: () => this.inDur, set: (v) => { this.inDur = v; this.save(); } }),
        Field('In ease', Select(easeOpts, () => this.inEase, (v) => { this.inEase = v; this.save(); })),
        Slider({ label: 'Out duration (s)', min: 0.05, max: 4, step: 0.05, get: () => this.outDur, set: (v) => { this.outDur = v; this.save(); } }),
        Field('Out ease', Select(easeOpts, () => this.outEase, (v) => { this.outEase = v; this.save(); })),
        Slider({ label: 'Strength', min: 0.1, max: 3, step: 0.05, get: () => this.strength, set: (v) => { this.strength = v; this.save(); } })),
      h('div', { 'data-tab': 'wiggle', class: 'stack' }, h('div', { class: 'hint' }, 'Tip: “Loopable” wiggles repeat perfectly every loop length — great for seamless social loops.')),
    );
    return Section('Settings', [box], { color: 'var(--violet)' });
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
    const e: EaseDef = { id: 'custom-spring', label: `Spring ${k}/${z}`, group: 'Spring', src: `var w=${k},z=${z};if(t<=0)return 0;if(t>=1)return 1;var wd=w*Math.sqrt(1-z*z);var e=1-Math.exp(-z*w*t)*(Math.cos(wd*t)+(z*w/wd)*Math.sin(wd*t));var e1=1-Math.exp(-z*w)*(Math.cos(wd)+(z*w/wd)*Math.sin(wd));return e+(1-e1)*t;` };
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
    this.applyExpr(b.expr, w.prop, [
      { name: 'KX Wiggle Speed', value: w.freq }, { name: 'KX Wiggle Amount', value: w.amp }, { name: 'KX Wiggle Seed', value: w.seed }, { name: 'KX Loop Length', value: w.loop },
    ], b.label, 'KX-WIGGLE');
  }
  private async applyExpr(expr: string, prop: string, controls: { name: string; value: number }[], label: string, marker = 'KX-EXPR') {
    try {
      const r = await call<{ props: number }>('exprApply', { target: prop === 'selected' ? 'selectedProps' : 'layerProp', prop, expr, controls, marker, label });
      toast(`${label} → ${r.props} propert${r.props === 1 ? 'y' : 'ies'}`);
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }

  // ───────── preview ─────────
  private loop() {
    const tick = (now: number) => {
      if (!this.active) return;
      this.drawPreview(now / 1000);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private drawPreview(time: number) {
    const c = this.preview;
    const r = c.getBoundingClientRect();
    if (r.width < 2) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height;
    g.clearRect(0, 0, W, H);
    if (this.tab === 'ease') return this.drawEasePreview(g, W, H, time);
    if (this.tab === 'wiggle') return this.drawWigglePreview(g, W, H, time);
    // in/out: card enters, holds, exits
    const cycle = this.inDur + 0.8 + this.outDur + 0.4;
    const t = time % cycle;
    const life = this.inDur + 0.8 + this.outDur;
    if (t > life) return;
    const inA = animById(this.inId), outA = animById(this.outId);
    const ri = inA ? Math.min(1, t / this.inDur) : 1, ro = outA ? Math.min(1, (life - t) / this.outDur) : 1;
    const ei = easeFn(easeById(this.inEase))(ri), eo = easeFn(easeById(this.outEase))(ro);
    const cw = Math.min(150, W * 0.5), ch = 54;
    const env = { k: this.strength, W: cw, H: ch, CW: W, CH: H, time };
    const run = (key: keyof AnimDef['props'], v: any) => evalSnippet(outA?.props[key], evalSnippet(inA?.props[key], v, ei, ri, env), eo, ro, env);
    const pos = run('position', [W / 2, H / 2]);
    const sc = run('scale', [100, 100]);
    const rot = run('rotation', 0);
    const op = run('opacity', 100);
    const rx = run('rotationX', 0), ry = run('rotationY', 0);
    const fxVis = (name: string) => [inA, outA].some((a) => a?.fx?.some((f) => f.match === name));
    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, op / 100));
    g.translate(pos[0], pos[1]);
    g.rotate((rot * Math.PI) / 180);
    g.scale((sc[0] / 100) * Math.cos((ry * Math.PI) / 180), (sc[1] / 100) * Math.cos((rx * Math.PI) / 180));
    const vis = Math.min(ri, ro);
    if (fxVis('ADBE Box Blur2') || fxVis('ADBE Motion Blur')) g.filter = `blur(${((1 - vis) * 10).toFixed(1)}px)`;
    if (fxVis('ADBE Linear Wipe') || fxVis('ADBE Radial Wipe') || fxVis('ADBE Venetian Blinds') || fxVis('ADBE Block Dissolve')) { g.beginPath(); g.rect(-cw / 2, -ch / 2, cw * vis, ch); g.clip(); }
    g.fillStyle = '#d1fe17';
    g.beginPath(); g.roundRect(-cw / 2, -ch / 2, cw, ch, 14); g.fill();
    g.fillStyle = '#1a1a1a';
    g.font = '700 18px "Space Grotesk", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('KINETIX', 0, 1);
    g.restore();
  }

  private drawEasePreview(g: CanvasRenderingContext2D, W: number, H: number, time: number) {
    const f = easeFn(easeById(this.ease));
    const t = Math.min(1, (time % 2) / 1.4);
    const v = f(t);
    const x0 = 30, x1 = W - 30;
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x0, H * 0.35); g.lineTo(x1, H * 0.35); g.stroke();
    g.fillStyle = '#d1fe17';
    g.beginPath(); g.arc(x0 + (x1 - x0) * v, H * 0.35, 13, 0, 7); g.fill();
    const s = 0.4 + 0.6 * v;
    g.fillStyle = 'rgba(209,254,23,.18)';
    g.beginPath(); g.arc(W / 2, H * 0.75, 26 * Math.max(0, s), 0, 7); g.fill();
  }

  private drawWigglePreview(g: CanvasRenderingContext2D, W: number, H: number, time: number) {
    const b = buildWiggle(this.wig.id, 'position');
    const v = b.preview(time, this.wig.freq, Math.min(60, this.wig.amp), this.wig.seed, this.wig.loop);
    g.fillStyle = '#d1fe17';
    g.beginPath(); g.arc(W / 2 + v[0], H / 2 + v[1], 14, 0, 7); g.fill();
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

void Toggle;
