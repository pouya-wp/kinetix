import { store, newBall, type BallObj, type Bounce } from '../core/state';
import { Viewport } from '../core/viewport';
import { clock } from '../core/clock';
import { Transport } from '../core/transport';
import { SceneSection, CompSection, ViewSection, GuideSection } from '../core/common-ui';
import { h, Section, Slider, Toggle, Seg, Btn, ColorField, Swatches, TextInput, Field, clear, toast, icon, refreshAll, PALETTE, Select } from '../ui/kit';
import { CurveEditor } from '../ui/curve';
import { uid, vdist, clamp, type Vec } from '../core/math';
import { sample, trackOf, durationOf, buildKeyed, physicsToKeyed, effectiveTravel } from './solver';
import { buildPayload, type ExportStyle, type ExportTarget } from './export';
import { call, inAE } from '../core/ae-bridge';
import { ActionBar, Picks } from '../ui/flow';
import type { Studio } from '../main';

type SoftGen = { count: number; height: number; dist: number; hDecay: number; dDecay: number };
const S = () => store.state;
const B = () => store.state.bounce;

type Drag =
  | { kind: 'start'; id: string }
  | { kind: 'point'; id: string; i: number }
  | { kind: 'arc'; id: string; i: number; y0: number; arc0: number }
  | { kind: 'vel'; id: string }
  | { kind: 'collider'; id: string; cid: string; end: 'a' | 'b' | 'new' };

export class BounceStudio implements Studio {
  id = 'bounce';
  el: HTMLElement;
  vp: Viewport;
  private right: HTMLElement;
  private sig = '';
  private drag: Drag | null = null;
  private hoverHit: string | null = null;
  private tool: 'edit' | 'collider' = 'edit';
  private exportStyle: ExportStyle = 'smart';
  private exportTarget: ExportTarget = 'new';
  private transport;
  private toolbar: HTMLElement;

  constructor() {
    this.vp = new Viewport((ctx, vp) => this.draw(ctx, vp));
    this.vp.tool = {
      down: (p, e) => this.onDown(p, e),
      move: (p) => this.onDrag(p),
      up: () => this.onUp(),
      hover: (p) => { this.hoverHit = this.hit(p)?.key ?? null; },
      cursor: () => (this.drag ? 'grabbing' : this.hoverHit ? 'grab' : this.tool === 'collider' ? 'crosshair' : 'copy'),
    };
    this.transport = Transport({ marks: () => this.marks() });

    this.toolbar = h('div', { class: 'toolbar' });
    const fold = <T extends HTMLElement>(el: T) => { el.classList.add('collapsed'); return el; };
    const left = h('div', { class: 'side' },
      this.quickSection(),
      fold(this.objectsSection()),
      h('div', { class: 'insp-slot' }),
      fold(SceneSection()),
      fold(CompSection()),
      fold(ViewSection([
        Toggle('Motion trail', () => S().view.trail, (v) => store.silent((s) => { s.view.trail = v; })),
        Toggle('Speed heatmap', () => S().view.heat, (v) => store.silent((s) => { s.view.heat = v; })),
        Slider({ label: 'Onion skin', min: 0, max: 12, get: () => S().view.onion, set: (v) => store.silent((s) => { s.view.onion = v; }) }),
      ])),
      fold(GuideSection()),
      fold(this.exportSection()),
    );
    this.right = h('div', { class: 'side right' });
    const stage = h('div', { class: 'stage' },
      h('div', { class: 'stage-top' }, this.toolbar, this.vp.zoomEl),
      this.vp.el,
      h('div', { class: 'stage-hint' }, 'Click to place the start, then click to add bounces · drag points & arc handles · Space play · ←/→ frame · Shift+←/→ jump bounce · scroll zoom · Alt-drag pan'),
      this.transport.el,
      ActionBar({ label: 'Send to After Effects', icon: 'send', need: () => (this.exportTarget === 'selected' ? 'layers' : 'comp'), run: () => this.export(false) }),
    );
    // move hint above the transport
    stage.insertBefore(stage.querySelector('.stage-hint')!, this.transport.el);
    (stage.querySelector('.stage-hint') as HTMLElement).style.bottom = '128px';
    this.el = h('div', { class: 'view' }, left, stage, this.right);

    store.subscribe(() => this.onState());
    clock.on(() => { if (this.active) this.vp.request(); });
    this.onState();
    // never open on an empty canvas
    if (!this.obj()?.start) this.generate();
  }

  private active = false;
  activate() {
    this.active = true;
    this.updateDuration();
    this.vp.resize();
    this.vp.request();
  }
  deactivate() { this.active = false; }

  // ───────── helpers ─────────
  private obj(): BallObj | null {
    const b = B();
    return b.objects.find((o) => o.id === b.sel) ?? b.objects[0] ?? null;
  }
  private edit(fn: (o: BallObj) => void, final = true) {
    const id = this.obj()?.id;
    store.set((s) => { const o = s.bounce.objects.find((x) => x.id === id); if (o) fn(o); }, final);
  }
  private totalDuration() {
    const c = S().comp;
    let d = 0;
    for (const o of B().objects) if (o.visible) d = Math.max(d, durationOf(o, c.w, c.h));
    return d;
  }
  private updateDuration() {
    clock.fps = S().comp.fps;
    clock.setDuration(Math.max(0.5, this.totalDuration() + 0.25));
    this.transport.update();
    this.transport.updateMarks();
  }
  private marks() {
    const o = this.obj();
    if (!o || o.mode !== 'keyed') return [];
    const tl = buildKeyed(o);
    return tl.segs.map((s) => ({ t: s.t0 + s.tUp + s.tHang + s.tDown, kind: 'key' as const }));
  }

  private onState() {
    if (!B().sel && B().objects[0]) B().sel = B().objects[0].id;
    const o = this.obj();
    const sig = [o?.id, o?.mode, B().selBounce, o?.bounces.length, !!o?.start, B().objects.length].join('|');
    if (sig !== this.sig) { this.sig = sig; this.buildInspector(); this.buildToolbar(); }
    this.updateDuration();
    refreshAll();
    this.vp.request();
  }

  // ───────── left: objects & export ─────────
  private objectsSection() {
    const list = h('div', { class: 'list' });
    const render = () => {
      list.innerHTML = '';
      for (const o of B().objects) {
        const it = h('div', { class: 'item' + (o.id === this.obj()?.id ? ' sel' : '') },
          h('span', { class: 'sw-dot', style: { background: o.color, borderRadius: '50%' } }),
          h('span', { class: 'name' }, o.name),
          h('span', { class: 'meta' }, o.mode === 'physics' ? 'PHYS' : `${o.bounces.length}b`),
          h('button', { class: 'btn btn-sm btn-icon x', title: o.visible ? 'Hide' : 'Show', onclick: (e: Event) => { e.stopPropagation(); store.set((s) => { const x = s.bounce.objects.find((q) => q.id === o.id)!; x.visible = !x.visible; }); } }, o.visible ? '◉' : '○'),
        );
        it.addEventListener('click', () => store.set((s) => { s.bounce.sel = o.id; s.bounce.selBounce = -1; }));
        list.appendChild(it);
      }
    };
    store.subscribe(render);
    queueMicrotask(render);
    const o = () => this.obj();
    return Section('Objects', [
      list,
      h('div', { class: 'row3' },
        Btn('Add', () => store.set((s) => { const n = newBall(s.bounce.objects.length + 1, PALETTE[s.bounce.objects.length % 7]); s.bounce.objects.push(n); s.bounce.sel = n.id; s.bounce.selBounce = -1; }), { icon: 'plus', size: 'sm' }),
        Btn('Copy', () => this.duplicate(), { icon: 'copy', size: 'sm' }),
        Btn('', () => this.removeObject(), { icon: 'trash', size: 'sm', variant: 'danger', title: 'Delete object' }),
      ),
      Field('Name', TextInput({ get: () => o()?.name ?? '', set: (v) => this.edit((x) => { x.name = v || x.name; }) })),
      Seg([{ value: 'keyed', label: 'Keyed arcs' }, { value: 'physics', label: 'Physics' }], () => o()?.mode ?? 'keyed', (v) => this.edit((x) => {
        x.mode = v;
        if (v === 'physics' && !x.start) x.start = [S().comp.w * 0.15, S().comp.h * 0.3];
      })),
      Slider({ label: 'Radius', min: 4, max: 400, get: () => o()?.radius ?? 48, set: (v, f) => this.edit((x) => { x.radius = v; }, f), begin: () => store.begin() }),
      Field('Colour', ColorField(() => o()?.color ?? '#fff', (v, f) => this.edit((x) => { x.color = v; }, f), () => store.begin())),
      Swatches((c) => this.edit((x) => { x.color = c; })),
      Slider({ label: 'Start delay (s)', min: 0, max: 5, step: 0.01, get: () => o()?.delay ?? 0, set: (v, f) => this.edit((x) => { x.delay = v; }, f), begin: () => store.begin() }),
    ], { color: 'var(--lime)' });
  }

  private duplicate() {
    const o = this.obj();
    if (!o) return;
    store.set((s) => {
      const c: BallObj = structuredClone(o);
      c.id = uid('ball');
      c.name = o.name + ' copy';
      c.bounces.forEach((b) => (b.id = uid('b')));
      c.start = c.start ? [c.start[0] + 40, c.start[1]] : null;
      c.bounces.forEach((b) => { b.x += 40; });
      s.bounce.objects.push(c);
      s.bounce.sel = c.id;
    });
  }
  private removeObject() {
    const o = this.obj();
    if (!o) return;
    store.set((s) => {
      s.bounce.objects = s.bounce.objects.filter((x) => x.id !== o.id);
      if (!s.bounce.objects.length) s.bounce.objects.push(newBall(1));
      s.bounce.sel = s.bounce.objects[0].id;
      s.bounce.selBounce = -1;
    });
  }

  private exportSection() {
    const styleSel = Select<ExportStyle>([
      { value: 'smart', label: 'Smart keyframes (reduced)' },
      { value: 'baked', label: 'Baked keyframes (every frame)' },
      { value: 'expression', label: 'Expression (editable)' },
    ], () => this.exportStyle, (v) => { this.exportStyle = v; refreshAll(); });
    const scope = { all: false };
    return Section('Export', [
      Field('Style', styleSel),
      Field('Target', Seg<ExportTarget>([{ value: 'new', label: 'New shape layer' }, { value: 'selected', label: 'Selected layer' }], () => this.exportTarget, (v) => { this.exportTarget = v; refreshAll(); })),
      Toggle('Export all visible objects', () => scope.all, (v) => { scope.all = v; refreshAll(); }),
      Btn('Send to After Effects', () => this.export(scope.all), { variant: 'primary', size: 'lg', block: true, icon: 'send' }),
      h('div', { class: 'hint' }, 'Selected layer: drives the selected AE layer through a deform null, so any footage or precomp bounces with squash & stretch.'),
    ], { color: 'var(--lime)' });
  }

  private async export(all: boolean) {
    const objs = (all ? B().objects.filter((o) => o.visible) : [this.obj()!]).filter((o) => o && (o.mode === 'physics' || (o.start && o.bounces.length)));
    if (!objs.length) { toast('Nothing to export — place a start point and at least one bounce', 'info'); return; }
    let style = this.exportStyle;
    if (style === 'expression' && objs.some((o) => o.mode === 'physics')) { toast('Physics objects export as smart keyframes', 'info'); }
    const payload = buildPayload(objs, S().comp, style, this.exportTarget);
    try {
      const r = await call<{ layers: string[] }>('bounceExport', payload);
      toast(inAE ? `Created ${r?.layers?.length ?? 0} layer(s) in AE` : `Preview mode: built ${payload.balls.length} object(s), ${payload.balls.reduce((n, b) => n + b.pos.t.length, 0)} position keys`);
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }

  // ───────── right: inspector ─────────
  private buildInspector() {
    clear(this.right);
    const o = this.obj();
    if (!o) return;
    if (o.mode === 'keyed') this.right.append(this.bouncesSection(o), this.bounceSection(), this.generatorSection());
    else this.right.append(this.physicsSection());
    this.right.append(this.deformSection(), this.rotationSection(), o.mode === 'keyed' ? this.profileSection() : h('div'));
  }

  private bouncesSection(o: BallObj) {
    const list = h('div', { class: 'list' });
    const tl = buildKeyed(o);
    const sel = B().selBounce;
    if (o.start) {
      const st = h('div', { class: 'item' + (sel === -1 ? ' sel' : '') }, h('span', { class: 'sw-dot', style: { background: 'transparent', boxShadow: 'inset 0 0 0 2px currentColor' } }), h('span', { class: 'name' }, 'Start'), h('span', { class: 'meta' }, `${o.delay.toFixed(2)}s`));
      st.addEventListener('click', () => store.set((s) => { s.bounce.selBounce = -1; }));
      list.appendChild(st);
    }
    o.bounces.forEach((b, i) => {
      const seg = tl.segs[i];
      const t = seg ? seg.t0 + seg.tUp + seg.tHang + seg.tDown : 0;
      const it = h('div', { class: 'item' + (sel === i ? ' sel' : '') },
        h('span', { class: 'sw-dot', style: { background: o.color, borderRadius: '50%' } }),
        h('span', { class: 'name' }, `Bounce ${i + 1}`),
        h('span', { class: 'meta' }, `${t.toFixed(2)}s`));
      it.addEventListener('click', () => { store.set((s) => { s.bounce.selBounce = i; }); clock.seek(t); });
      list.appendChild(it);
    });
    return Section('Bounces', [
      h('div', { class: 'hint' }, !o.start ? 'Click the canvas to place the ball’s starting position.' : o.bounces.length ? 'Click the canvas to add more bounces. Drag the diamond above an arc to change its height.' : 'Now click where the ball should land.'),
      o.start ? list : null,
      h('div', { class: 'row' },
        Btn('Delete', () => this.deleteSelectedBounce(), { size: 'sm', icon: 'trash' }),
        Btn('Clear all', () => this.edit((x) => { x.start = null; x.bounces = []; B().selBounce = -1; }), { size: 'sm', variant: 'danger' }),
      ),
    ], { color: 'var(--lime)' });
  }

  private deleteSelectedBounce() {
    const i = B().selBounce;
    this.edit((x) => {
      if (i >= 0) x.bounces.splice(i, 1);
      else if (x.bounces.length) { x.start = [x.bounces[0].x, x.bounces[0].y]; x.bounces.shift(); }
      else x.start = null;
    });
    store.silent((s) => { s.bounce.selBounce = Math.min(i, (this.obj()?.bounces.length ?? 0) - 1); });
  }

  private bounceSection() {
    const o = this.obj()!;
    const i = B().selBounce;
    if (i < 0 || !o.bounces[i]) return Section('Bounce', [h('div', { class: 'hint' }, 'Select a bounce to adjust it.')]);
    const bv = <K extends keyof Bounce>(k: K) => () => (this.obj()?.bounces[B().selBounce]?.[k] as any) ?? 0;
    const bs = <K extends keyof Bounce>(k: K) => (v: Bounce[K], f = true) => this.edit((x) => { const b = x.bounces[B().selBounce]; if (b) b[k] = v; }, f);
    const sl = (label: string, k: 'arc' | 'travel' | 'hang' | 'hangEase' | 'squash' | 'stretch' | 'squashTime', min: number, max: number, step: number, unit = '', mult = 1) =>
      Slider({ label, min, max, step, unit, get: () => bv(k)() * mult, set: (v, f) => bs(k)(v / mult, f), begin: () => store.begin() });
    const travel = Slider({
      label: 'Travel time (s)', min: 0.05, max: 2, step: 0.01, begin: () => store.begin(),
      get: () => { const x = this.obj()!; const j = B().selBounce; return x.bounces[j] ? effectiveTravel(x, j) : 0; },
      set: (v, f) => this.edit((x) => { const b = x.bounces[B().selBounce]; if (b) { b.travel = v; if (B().selBounce > 0) b.follow = false; } }, f),
      title: 'Time from the top of the arc down to the contact',
    });
    return Section(`Bounce ${i + 1}`, [
      sl('Arc height (px)', 'arc', 0, 1200, 1),
      travel,
      Toggle('Travel time follows arc height', () => !!bv('follow')(), (v) => bs('follow')(v)),
      sl('Hang time (s)', 'hang', 0, 1, 0.01),
      sl('Hang ease (%)', 'hangEase', 0, 100, 1),
      sl('Squash (%)', 'squash', 0, 90, 1, '', 100),
      sl('Stretch (%)', 'stretch', 0, 120, 1, '', 100),
      sl('Squash timing (s)', 'squashTime', 0, 0.4, 0.005),
      h('div', { class: 'row' },
        Btn('Apply to following', () => this.applyToFollowing(), { size: 'sm', variant: 'soft', title: 'Copy timing / squash / stretch to all later bounces' }),
        Btn('Apply to all', () => this.applyToFollowing(true), { size: 'sm' }),
      ),
    ], { color: 'var(--lime)' });
  }

  private applyToFollowing(all = false) {
    const i = B().selBounce;
    this.edit((x) => {
      const src = x.bounces[i];
      if (!src) return;
      x.bounces.forEach((b, j) => {
        if (j === i || (!all && j < i)) return;
        b.hang = src.hang; b.hangEase = src.hangEase; b.squash = src.squash; b.stretch = src.stretch; b.squashTime = src.squashTime;
        if (!b.follow) b.travel = src.travel;
      });
    });
    toast('Applied');
  }

  private gen = { count: 6, height: 520, dist: 260, hDecay: 55, dDecay: 85, dir: 1 as 1 | -1, floor: 0 };
  private quick = 'drop';
  /** One click: a complete, good-looking bounce. */
  private quickSection() {
    const QUICK: { id: string; label: string; sub: string; g: Partial<SoftGen> }[] = [
      { id: 'drop', label: 'Ball drop', sub: 'classic, 6 bounces', g: { count: 6, height: 520, dist: 260, hDecay: 55, dDecay: 85 } },
      { id: 'big', label: 'Big bounce', sub: 'tall and energetic', g: { count: 8, height: 850, dist: 320, hDecay: 62, dDecay: 88 } },
      { id: 'hops', label: 'Little hops', sub: 'small, quick, playful', g: { count: 10, height: 180, dist: 130, hDecay: 72, dDecay: 92 } },
      { id: 'land', label: 'Drop & land', sub: 'one hit, settles fast', g: { count: 3, height: 600, dist: 80, hDecay: 25, dDecay: 60 } },
      { id: 'float', label: 'Floaty', sub: 'long soft arcs', g: { count: 5, height: 420, dist: 380, hDecay: 70, dDecay: 95 } },
      { id: 'heavy', label: 'Heavy', sub: 'barely bounces', g: { count: 2, height: 500, dist: 120, hDecay: 15, dDecay: 50 } },
    ];
    const picks = Picks(QUICK, { isOn: (t) => t.id === this.quick, onPick: (t) => { this.quick = t.id; Object.assign(this.gen, t.g); this.generate(); clock.play(); }, min: 92 });
    return Section('Quick bounce', [
      picks.el,
      Slider({ label: 'Height', min: 50, max: 1500, get: () => this.gen.height, set: (v, f) => { this.gen.height = v; if (f) this.generate(); } }),
      Slider({ label: 'Bounciness', min: 5, max: 95, unit: ' %', get: () => this.gen.hDecay, set: (v, f) => { this.gen.hDecay = v; if (f) this.generate(); } }),
      Seg([{ value: '1', label: 'Left → right' }, { value: '-1', label: 'Right → left' }], () => String(this.gen.dir) as '1' | '-1', (v) => { this.gen.dir = +v as 1 | -1; this.generate(); refreshAll(); }),
      h('div', { class: 'hint' }, 'Or click on the canvas to place your own start and bounces.'),
    ], { color: 'var(--lime)' });
  }
  private generatorSection() {
    const g = this.gen;
    if (!g.floor) g.floor = S().comp.h - 140;
    const sl = (label: string, k: 'count' | 'height' | 'dist' | 'hDecay' | 'dDecay' | 'floor', min: number, max: number, step = 1) =>
      Slider({ label, min, max, step, get: () => g[k], set: (v) => { g[k] = v; refreshAll(); } });
    return Section('Auto bounce generator', [
      sl('Bounces', 'count', 1, 30),
      sl('First height (px)', 'height', 20, 1500),
      sl('First distance (px)', 'dist', 0, 1200),
      sl('Height kept per bounce (%)', 'hDecay', 5, 100),
      sl('Distance kept per bounce (%)', 'dDecay', 5, 120),
      sl('Floor Y (px)', 'floor', 0, 4000),
      Seg([{ value: '1', label: 'Left → Right' }, { value: '-1', label: 'Right → Left' }], () => String(g.dir) as '1' | '-1', (v) => { g.dir = +v as 1 | -1; refreshAll(); }),
      Btn('Generate bounces', () => this.generate(), { variant: 'soft', block: true, icon: 'wand' }),
    ], { collapsed: true, color: 'var(--violet)' });
  }

  private generate() {
    const g = this.gen;
    const c = S().comp;
    const d = B().defaults;
    this.edit((x) => {
      const x0 = g.dir > 0 ? Math.max(x.radius + 20, c.w * 0.08) : Math.min(c.w - x.radius - 20, c.w * 0.92);
      x.start = [x0, g.floor - g.height];
      x.bounces = [];
      let px = x0, hgt = g.height, dist = g.dist; // hgt = height of the *next* arc
      for (let i = 0; i < g.count; i++) {
        px += g.dir * (i === 0 ? dist * 0.5 : dist);
        x.bounces.push({ ...d, id: uid('b'), x: px, y: g.floor, arc: i === 0 ? 0 : hgt, follow: i > 0, travel: i === 0 ? Math.sqrt((2 * g.height) / 2400) : d.travel, squash: d.squash * Math.max(0.25, hgt / g.height) ** 0.5, stretch: d.stretch * Math.max(0.3, hgt / g.height) ** 0.5 });
        if (i > 0) dist *= g.dDecay / 100;
        hgt *= g.hDecay / 100;
      }
      x.mode = 'keyed';
    });
    store.silent((s) => { s.bounce.selBounce = 0; });
    clock.seek(0);
  }

  private physicsSection() {
    const p = () => this.obj()!.phys;
    const sl = (label: string, k: keyof BallObj['phys'], min: number, max: number, step = 1, mult = 1) =>
      Slider({ label, min, max, step, get: () => (p()[k] as number) * mult, set: (v, f) => this.edit((x) => { (x.phys as any)[k] = v / mult; }, f), begin: () => store.begin() });
    const tg = (label: string, k: 'walls' | 'floor' | 'ceiling') => Toggle(label, () => p()[k], (v) => this.edit((x) => { x.phys[k] = v; }));
    return Section('Physics', [
      h('div', { class: 'hint' }, 'Drag the ball to set its start, drag the arrow to set the throw. Draw extra colliders with the line tool.'),
      sl('Gravity (px/s²)', 'gravity', 0, 8000, 10),
      sl('Bounciness (%)', 'restitution', 0, 100, 1, 100),
      sl('Friction (%)', 'friction', 0, 100, 1, 100),
      sl('Air drag', 'drag', 0, 3, 0.01),
      h('div', { class: 'row' }, sl('Throw X', 'vx', -4000, 4000, 10), sl('Throw Y', 'vy', -4000, 4000, 10)),
      sl('Duration (s)', 'duration', 0.5, 30, 0.1),
      sl('Squash (%)', 'squash', 0, 90, 1, 100),
      sl('Squash time (s)', 'squashTime', 0.01, 0.4, 0.005),
      tg('Floor', 'floor'), tg('Side walls', 'walls'), tg('Ceiling', 'ceiling'),
      h('div', { class: 'row' },
        Btn('Clear colliders', () => this.edit((x) => { x.colliders = []; }), { size: 'sm' }),
        Btn('Convert to keyed', () => {
          const c = S().comp;
          this.edit((x) => { const r = physicsToKeyed(x, c.w, c.h); x.start = r.start; x.bounces = r.bounces; x.mode = 'keyed'; });
          toast('Converted — every bounce is now editable');
        }, { size: 'sm', variant: 'soft' }),
      ),
    ], { color: 'var(--info)' });
  }

  private deformSection() {
    const d = () => this.obj()!.deform;
    return Section('Deform', [
      Toggle('Stretch along velocity', () => d().align, (v) => this.edit((x) => { x.deform.align = v; })),
      Toggle('Preserve volume', () => d().volume, (v) => this.edit((x) => { x.deform.volume = v; })),
      Slider({ label: 'Recovery overshoot', min: 0, max: 1, step: 0.01, get: () => d().recover, set: (v, f) => this.edit((x) => { x.deform.recover = v; }, f), begin: () => store.begin() }),
      Slider({ label: 'Anticipation boost', min: 0, max: 2, step: 0.01, get: () => d().anticipate, set: (v, f) => this.edit((x) => { x.deform.anticipate = v; }, f), begin: () => store.begin() }),
    ], { color: 'var(--violet)', collapsed: true });
  }

  private rotationSection() {
    const r = () => this.obj()!.rot;
    return Section('Rotation', [
      Seg([{ value: 'none', label: 'None' }, { value: 'roll', label: 'Roll' }, { value: 'spin', label: 'Spin' }], () => r().mode, (v) => this.edit((x) => { x.rot.mode = v; })),
      Slider({ label: 'Spin (°/s)', min: -1440, max: 1440, step: 5, get: () => r().spin, set: (v, f) => this.edit((x) => { x.rot.spin = v; }, f), begin: () => store.begin() }),
      Slider({ label: 'Spin decay', min: 0, max: 5, step: 0.01, get: () => r().decay, set: (v, f) => this.edit((x) => { x.rot.decay = v; }, f), begin: () => store.begin() }),
    ], { color: 'var(--text-3)', collapsed: true });
  }

  private profileSection() {
    const o = () => this.obj()!;
    return Section('Arc profile', [
      Seg([{ value: 'physical', label: 'Physical' }, { value: 'curve', label: 'Custom curve' }], () => o().profile, (v) => this.edit((x) => { x.profile = v; })),
      CurveEditor(() => o().curve, (e, f) => this.edit((x) => { x.curve = e; x.profile = 'curve'; }, f), () => store.begin()),
      h('div', { class: 'hint' }, 'Curve maps apex → contact. Physical is a true gravity parabola shaped by Hang ease.'),
    ], { color: 'var(--text-3)', collapsed: true });
  }

  private buildToolbar() {
    this.toolbar.innerHTML = '';
    const o = this.obj();
    const mk = (t: 'edit' | 'collider', ic: 'cursor' | 'pen', title: string) => {
      const b = h('button', { class: 'btn btn-sm' + (this.tool === t ? ' on' : ''), title }, icon(ic));
      b.addEventListener('click', () => { this.tool = t; this.buildToolbar(); });
      return b;
    };
    this.toolbar.append(mk('edit', 'cursor', 'Edit / add bounces'));
    if (o?.mode === 'physics') this.toolbar.append(mk('collider', 'pen', 'Draw collider line'));
    this.toolbar.append(h('div', { class: 'sep' }),
      h('button', { class: 'btn btn-sm', title: 'Fit view', onclick: () => this.vp.fit() }, icon('fit')),
      h('button', { class: 'btn btn-sm', title: 'Undo (Ctrl+Z)', onclick: () => store.undo() }, icon('undo')),
      h('button', { class: 'btn btn-sm', title: 'Redo (Ctrl+Shift+Z)', onclick: () => store.redo() }, icon('redo')),
    );
  }

  // ───────── canvas interaction ─────────
  private hit(p: Vec): { key: string; drag: Drag; obj: BallObj } | null {
    const tol = this.vp.px(10);
    const o = this.obj();
    const c = S().comp;
    if (o) {
      if (o.mode === 'keyed') {
        const tl = buildKeyed(o);
        for (let i = tl.segs.length - 1; i >= 0; i--) {
          const s = tl.segs[i];
          const air = s.tUp + s.tHang + s.tDown;
          const ax = s.p0[0] + (s.p1[0] - s.p0[0]) * ((s.tUp + s.tHang / 2) / Math.max(1e-6, air));
          if (vdist(p, [ax, s.apexY - this.vp.px(16)]) < tol) return { key: 'arc' + i, drag: { kind: 'arc', id: o.id, i, y0: p[1], arc0: o.bounces[i].arc }, obj: o };
        }
        for (let i = o.bounces.length - 1; i >= 0; i--) {
          const b = o.bounces[i];
          if (vdist(p, [b.x, b.y]) < Math.max(tol, this.vp.px(8))) return { key: 'p' + i, drag: { kind: 'point', id: o.id, i }, obj: o };
        }
        if (o.start && vdist(p, o.start) < Math.max(tol, this.vp.px(9))) return { key: 'start', drag: { kind: 'start', id: o.id }, obj: o };
      } else {
        const st = o.start ?? [0, 0];
        const tip: Vec = [st[0] + o.phys.vx * 0.15, st[1] + o.phys.vy * 0.15];
        if (vdist(p, tip) < tol) return { key: 'vel', drag: { kind: 'vel', id: o.id }, obj: o };
        if (vdist(p, st) < Math.max(o.radius, tol)) return { key: 'start', drag: { kind: 'start', id: o.id }, obj: o };
        for (const col of o.colliders) {
          if (vdist(p, col.a) < tol) return { key: 'ca' + col.id, drag: { kind: 'collider', id: o.id, cid: col.id, end: 'a' }, obj: o };
          if (vdist(p, col.b) < tol) return { key: 'cb' + col.id, drag: { kind: 'collider', id: o.id, cid: col.id, end: 'b' }, obj: o };
        }
      }
    }
    // clicking another object's ball selects it
    for (const other of B().objects) {
      if (other === o || !other.visible) continue;
      const s = sample(other, clock.t, c.w, c.h);
      if (vdist(p, [s.x, s.y]) < other.radius) return { key: 'obj' + other.id, drag: null as any, obj: other };
    }
    return null;
  }

  private onDown(p: Vec, e: PointerEvent) {
    const o = this.obj();
    if (!o) return;
    const hit = this.hit(p);
    if (hit && hit.obj !== o) { store.set((s) => { s.bounce.sel = hit.obj.id; s.bounce.selBounce = -1; }); return; }
    clock.pause();
    if (hit) {
      this.drag = hit.drag;
      store.begin();
      if (hit.drag.kind === 'point') store.silent((s) => { s.bounce.selBounce = (hit.drag as any).i; });
      if (hit.drag.kind === 'arc') store.silent((s) => { s.bounce.selBounce = (hit.drag as any).i; });
      if (hit.drag.kind === 'start') store.silent((s) => { s.bounce.selBounce = -1; });
      return;
    }
    if (o.mode === 'physics') {
      if (this.tool === 'collider') {
        const cid = uid('col');
        store.begin();
        this.edit((x) => { x.colliders.push({ id: cid, a: p, b: [p[0] + 1, p[1]] }); }, false);
        this.drag = { kind: 'collider', id: o.id, cid, end: 'new' };
      }
      return;
    }
    // keyed: place start or add bounce
    const snap = e.shiftKey ? this.snap(p) : p;
    if (!o.start) {
      this.edit((x) => { x.start = snap; });
      store.silent((s) => { s.bounce.selBounce = -1; });
      return;
    }
    const prev = o.bounces[o.bounces.length - 1];
    const d = B().defaults;
    let nb: Bounce;
    if (prev) {
      // each new arc is a bit lower than the last one, like a real bounce
      const tl = buildKeyed(o);
      const lastFall = tl.segs[tl.segs.length - 1]?.fall ?? d.arc;
      const base = prev.arc > 0 ? prev.arc : lastFall;
      nb = { ...prev, id: uid('b'), x: snap[0], y: snap[1], arc: Math.max(0, Math.round(base * 0.62)), follow: true };
    } else {
      // first bounce: dropping from above needs no extra arc; a throw upward gets one
      const drop = o.start[1] < snap[1] - 20;
      nb = { id: uid('b'), x: snap[0], y: snap[1], ...d, follow: false, arc: drop ? 0 : d.arc, travel: drop ? Math.sqrt((2 * (snap[1] - o.start[1])) / 2400) : d.travel };
    }
    this.edit((x) => { x.bounces.push(nb); });
    store.silent((s) => { const x = s.bounce.objects.find((q) => q.id === o.id); s.bounce.selBounce = (x?.bounces.length ?? 1) - 1; });
  }

  private snap(p: Vec): Vec {
    const g = S().view.gridSize;
    return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
  }

  private onDrag(p: Vec) {
    const d = this.drag;
    if (!d) return;
    const shift = (window.event as PointerEvent | undefined)?.shiftKey;
    const q = shift ? this.snap(p) : p;
    this.edit((x) => {
      switch (d.kind) {
        case 'start': x.start = q; break;
        case 'point': { const b = x.bounces[d.i]; if (b) { b.x = q[0]; b.y = q[1]; } break; }
        case 'arc': { const b = x.bounces[d.i]; if (b) b.arc = Math.max(0, Math.round(d.arc0 + (d.y0 - p[1]))); break; }
        case 'vel': { const st = x.start ?? [0, 0]; x.phys.vx = Math.round((p[0] - st[0]) / 0.15); x.phys.vy = Math.round((p[1] - st[1]) / 0.15); break; }
        case 'collider': {
          const c = x.colliders.find((k) => k.id === d.cid);
          if (c) { if (d.end === 'a') c.a = q; else c.b = q; }
          break;
        }
      }
    }, false);
  }

  private onUp() {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.kind === 'collider' && d.end === 'new') {
      const o = this.obj();
      const c = o?.colliders.find((k) => k.id === d.cid);
      if (c && vdist(c.a, c.b) < 6) this.edit((x) => { x.colliders = x.colliders.filter((k) => k.id !== d.cid); }, false);
    }
    store.commit();
    store.emit('drag-end');
  }

  onKey(e: KeyboardEvent) {
    const k = e.key;
    if ((k === 'Delete' || k === 'Backspace') && this.obj()) { this.deleteSelectedBounce(); return true; }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && e.shiftKey) {
      const ts = [0, ...this.marks().map((m) => m.t)].sort((a, b) => a - b);
      const cur = clock.t;
      const nxt = k === 'ArrowRight' ? ts.find((t) => t > cur + 1e-4) : [...ts].reverse().find((t) => t < cur - 1e-4);
      clock.pause();
      clock.seek(nxt ?? (k === 'ArrowRight' ? clock.duration : 0));
      return true;
    }
    if (e.ctrlKey && k.toLowerCase() === 'd') { this.duplicate(); return true; }
    return false;
  }

  // ───────── drawing ─────────
  private draw(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const c = S().comp;
    const v = S().view;
    const sel = this.obj();
    const fps = c.fps;
    const px = (n: number) => vp.px(n);

    for (const o of B().objects) {
      if (!o.visible) continue;
      const isSel = o === sel;
      const tr = trackOf(o, c.w, c.h);
      const dur = durationOf(o, c.w, c.h);
      const hasPath = o.mode === 'physics' || (o.start && o.bounces.length);

      // physics colliders
      if (o.mode === 'physics' && isSel) {
        ctx.lineCap = 'round';
        for (const col of o.colliders) {
          ctx.strokeStyle = 'rgba(76,201,240,.9)';
          ctx.lineWidth = px(3);
          ctx.beginPath(); ctx.moveTo(col.a[0], col.a[1]); ctx.lineTo(col.b[0], col.b[1]); ctx.stroke();
          for (const q of [col.a, col.b]) { ctx.fillStyle = '#4cc9f0'; ctx.beginPath(); ctx.arc(q[0], q[1], px(4), 0, 7); ctx.fill(); }
        }
      }

      if (hasPath) {
        // path
        ctx.strokeStyle = isSel ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.1)';
        ctx.lineWidth = px(1.2);
        ctx.setLineDash([px(4), px(4)]);
        ctx.beginPath();
        const steps = Math.min(4000, Math.ceil(dur * 120));
        for (let i = 0; i <= steps; i++) {
          const s = sample(o, (i / steps) * dur, c.w, c.h);
          if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // spacing dots (one per frame)
        if (v.dots) {
          const nF = Math.ceil(dur * fps);
          let maxSp = 1;
          const pts: { x: number; y: number; sp: number }[] = [];
          for (let f = 0; f <= nF; f++) {
            const s = sample(o, f / fps, c.w, c.h);
            const sp = Math.hypot(s.vx, s.vy);
            maxSp = Math.max(maxSp, sp);
            pts.push({ x: s.x, y: s.y, sp });
          }
          for (const q of pts) {
            if (v.heat) {
              const u = Math.min(1, q.sp / maxSp);
              ctx.fillStyle = `hsl(${90 - u * 90}, 95%, ${55 + u * 5}%)`;
            } else ctx.fillStyle = isSel ? 'rgba(209,254,23,.75)' : 'rgba(255,255,255,.3)';
            ctx.beginPath(); ctx.arc(q.x, q.y, px(isSel ? 2.6 : 2), 0, 7); ctx.fill();
          }
        }

        // trail
        if (v.trail) {
          const span = 0.45, n = 40;
          for (let i = 0; i < n; i++) {
            const t0 = clock.t - (span * i) / n, t1 = clock.t - (span * (i + 1)) / n;
            if (t1 < 0) break;
            const a = sample(o, t0, c.w, c.h), b = sample(o, t1, c.w, c.h);
            ctx.strokeStyle = o.color;
            ctx.globalAlpha = 0.5 * (1 - i / n);
            ctx.lineWidth = o.radius * 1.6 * (1 - i / n);
            ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        // onion skin
        for (let i = v.onion; i >= 1; i--) {
          const t = clock.t - (i * 2) / fps;
          if (t < 0) continue;
          ctx.globalAlpha = 0.08 + 0.22 * (1 - i / (v.onion + 1));
          this.drawBall(ctx, o, sample(o, t, c.w, c.h), false);
        }
        ctx.globalAlpha = 1;
      }

      // handles
      if (isSel && o.mode === 'keyed') this.drawKeyedHandles(ctx, vp, o);
      if (isSel && o.mode === 'physics') {
        const st = o.start ?? [0, 0];
        const tip: Vec = [st[0] + o.phys.vx * 0.15, st[1] + o.phys.vy * 0.15];
        ctx.strokeStyle = '#4cc9f0';
        ctx.lineWidth = px(2);
        ctx.beginPath(); ctx.moveTo(st[0], st[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
        const ang = Math.atan2(tip[1] - st[1], tip[0] - st[0]);
        ctx.fillStyle = '#4cc9f0';
        ctx.beginPath();
        ctx.moveTo(tip[0] + Math.cos(ang) * px(10), tip[1] + Math.sin(ang) * px(10));
        ctx.lineTo(tip[0] + Math.cos(ang + 2.5) * px(10), tip[1] + Math.sin(ang + 2.5) * px(10));
        ctx.lineTo(tip[0] + Math.cos(ang - 2.5) * px(10), tip[1] + Math.sin(ang - 2.5) * px(10));
        ctx.fill();
        ctx.strokeStyle = 'rgba(76,201,240,.5)';
        ctx.setLineDash([px(3), px(3)]);
        ctx.beginPath(); ctx.arc(st[0], st[1], o.radius, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }

      // the ball itself
      if (o.mode === 'physics' || o.start) {
        const s = sample(o, clock.t, c.w, c.h);
        this.drawBall(ctx, o, s, true);
      }
      void tr;
    }

    // hover preview of next bounce
    if (sel && sel.mode === 'keyed' && !this.drag && !this.hoverHit && vp.hoverWorld && this.tool === 'edit') {
      const p = vp.hoverWorld;
      ctx.strokeStyle = 'rgba(209,254,23,.5)';
      ctx.lineWidth = px(1.5);
      ctx.setLineDash([px(3), px(4)]);
      ctx.beginPath(); ctx.arc(p[0], p[1], sel.radius, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawKeyedHandles(ctx: CanvasRenderingContext2D, vp: Viewport, o: BallObj) {
    const px = (n: number) => vp.px(n);
    const tl = buildKeyed(o);
    const sel = B().selBounce;
    ctx.font = `600 ${px(11)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    tl.segs.forEach((s, i) => {
      const air = s.tUp + s.tHang + s.tDown;
      const ax = s.p0[0] + (s.p1[0] - s.p0[0]) * ((s.tUp + s.tHang / 2) / Math.max(1e-6, air));
      const hy = s.apexY - px(16);
      // dashed guide from apex handle to apex
      ctx.strokeStyle = 'rgba(179,136,255,.5)';
      ctx.lineWidth = px(1);
      ctx.setLineDash([px(2), px(3)]);
      ctx.beginPath(); ctx.moveTo(ax, hy); ctx.lineTo(ax, Math.max(s.p0[1], s.p1[1])); ctx.stroke();
      ctx.setLineDash([]);
      const hov = this.hoverHit === 'arc' + i;
      ctx.fillStyle = sel === i ? '#d1fe17' : hov ? '#fff' : '#b388ff';
      ctx.save();
      ctx.translate(ax, hy);
      ctx.rotate(Math.PI / 4);
      const k = px(hov ? 6.5 : 5.5);
      ctx.fillRect(-k, -k, k * 2, k * 2);
      ctx.restore();
    });
    // start
    if (o.start) {
      const [x, y] = o.start;
      const k = px(7);
      ctx.strokeStyle = sel === -1 ? '#d1fe17' : '#fff';
      ctx.lineWidth = px(2);
      ctx.strokeRect(x - k, y - k, k * 2, k * 2);
    }
    o.bounces.forEach((b, i) => {
      const hov = this.hoverHit === 'p' + i;
      ctx.fillStyle = i === sel ? '#d1fe17' : hov ? '#fff' : '#1c1e20';
      ctx.strokeStyle = i === sel ? '#d1fe17' : '#fff';
      ctx.lineWidth = px(2);
      ctx.beginPath(); ctx.arc(b.x, b.y, px(7), 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = i === sel ? '#d1fe17' : 'rgba(255,255,255,.7)';
      ctx.fillText(String(i + 1), b.x, b.y + px(22));
    });
    // floor contact line hint
    ctx.textAlign = 'start';
  }

  private drawBall(ctx: CanvasRenderingContext2D, o: BallObj, s: ReturnType<typeof sample>, full: boolean) {
    const r = o.radius;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate((s.axis * Math.PI) / 180);
    ctx.scale(s.sa, s.sb);
    ctx.rotate(((s.rot - s.axis) * Math.PI) / 180);
    if (full) {
      const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      g.addColorStop(0, shade(o.color, 0.35));
      g.addColorStop(0.7, o.color);
      g.addColorStop(1, shade(o.color, -0.25));
      ctx.fillStyle = g;
      ctx.shadowColor = o.color + '55';
      ctx.shadowBlur = r * 0.6;
    } else ctx.fillStyle = o.color;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    if (o.rot.mode !== 'none') {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.arc(r * 0.55, 0, r * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.lineWidth = r * 0.08;
      ctx.beginPath(); ctx.moveTo(-r * 0.9, 0); ctx.lineTo(r * 0.3, 0); ctx.stroke();
    }
    ctx.restore();
  }
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c: number) => Math.round(clamp(k > 0 ? c + (255 - c) * k : c * (1 + k), 0, 255));
  r = f(r); g = f(g); b = f(b);
  return `rgb(${r},${g},${b})`;
}
