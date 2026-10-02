import { h, Section, Slider, Seg, Btn, Field, Select, Toggle, toast, refreshAll, onRefresh, Chips } from '../ui/kit';
import { Page, Tiles, Group } from '../core/page';
import { call, inAE } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { EASE_LIBRARY, easeById } from '../animate/eases';
import { MOVES, MOVE_GROUPS, SHAKES, LENSES, shakeExpr, type MoveDef } from './moves';
import { ARRANGES, arrange, distributeDepth, DEPTH_MODES, type SceneLayer, type ArrangeId, type DepthMode } from './layout';
import type { Studio } from '../main';

interface Scene {
  comp: { w: number; h: number; fps: number; time: number; duration: number; name: string };
  rig: null | { name: string; pos: number[]; distance: number; orbit: number; tilt: number; roll: number; focal: number; pan: number; look: number; overshoot: number };
  cameras: { index: number; name: string; active: boolean }[];
  layers: SceneLayer[];
  cam: number[];
}

const LS = 'kinetix.camera';
const BEZ_EASES = EASE_LIBRARY.filter((e) => e.bezier);

export class CameraStudio implements Studio {
  id = 'camera';
  el: HTMLElement;
  private scene: Scene | null = null;
  private cfg = {
    dur: 2.5, intensity: 1, ease: 'camera', physical: 0,
    depthMode: 'linear' as DepthMode, near: 0, far: 3000, compensate: true,
    spacing: 1.2, radius: 900, depth: 800, seed: 3, face: false, around: 'comp' as 'comp' | 'selection',
    shake: 'handheld', amount: 100, speed: 100, sseed: 1,
    fstop: 2.8, blur: 100, pull: 0.6, hold: 1.5, travel: 1.4, orbitTour: 0, follow: 0.3,
    view: 'top' as 'top' | 'side', dof: true, lens: 50,
  };
  private canvas: HTMLCanvasElement;
  private rigBox: HTMLElement;
  private drag: { li: number; ox: number; oy: number } | null = null;
  private vmap: { s: number; ox: number; oy: number } = { s: 1, ox: 0, oy: 0 };

  constructor() {
    try { Object.assign(this.cfg, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { /* */ }
    this.canvas = h('canvas', { style: { width: '100%', height: '260px', display: 'block', borderRadius: '14px', background: 'var(--bg-deep)', cursor: 'grab' } });
    this.rigBox = h('div', { class: 'stack' });
    this.bindCanvas();
    const c = this.cfg;
    const set = <K extends keyof typeof c>(k: K) => (v: any) => { (c as any)[k] = v; this.save(); };

    const left = [
      Section('Camera rig', [
        h('div', { class: 'hint' }, 'The Smart Rig drives AE’s own camera with simple sliders: distance, orbit, tilt, roll, pan, lens.'),
        Btn('Create Smart Rig', () => this.act('camRig', { lens: c.lens, dof: c.dof, forceNew: false }, 'Smart Rig ready'), { variant: 'primary', block: true, icon: 'camera' }),
        h('div', { class: 'row' },
          Btn('1-Node Cam', () => this.act('camCreate', { type: 'one', lens: c.lens }, 'Camera created'), { size: 'sm' }),
          Btn('2-Node Cam', () => this.act('camCreate', { type: 'two', lens: c.lens }, 'Camera created'), { size: 'sm' })),
        Toggle('Depth of field on new rigs', () => c.dof, set('dof')),
        h('div', { class: 'lbl' }, 'Lens'),
        Chips(LENSES.map((mm) => ({ value: String(mm), label: mm + 'mm' })), () => String(c.lens), (v) => { c.lens = +v; this.save(); this.act('camLens', { mm: +v }, `${v}mm lens`); }),
        this.rigBox,
      ], { color: 'var(--lime)' }),
      Section('Scene', [
        Seg([{ value: 'top', label: 'Top view' }, { value: 'side', label: 'Side view' }], () => c.view, (v) => { c.view = v; this.save(); this.draw(); }),
        this.canvas,
        h('div', { class: 'row' },
          Btn('Refresh', () => this.refresh(), { size: 'sm', icon: 'sync' }),
          Btn('Make 3D', () => this.act('camMake3D', { on: true }, '3D on for selection'), { size: 'sm' })),
        h('div', { class: 'hint' }, 'Drag a layer in the view to move it in depth. Lime = selected in AE.'),
      ], { color: 'var(--info)' }),
    ];

    const moveGroups = MOVE_GROUPS.map((g) => {
      const t = Tiles(MOVES.filter((m) => m.group === g).map((m) => ({ id: m.id, label: m.label, sub: m.sub })), { onPick: (x) => this.move(MOVES.find((m) => m.id === x.id)!), min: 128 });
      return Group('Moves · ' + g, [t.el]);
    });
    const arr = Tiles(ARRANGES, { onPick: (x) => this.arrange(x.id as ArrangeId), min: 128 });
    const shk = Tiles(SHAKES.map((s) => ({ id: s.id, label: s.label, sub: s.sub })), { onPick: (x) => { c.shake = x.id; this.save(); this.shake(); shk.refresh(); }, isOn: (x) => x.id === c.shake, min: 128 });

    const main = [
      h('div', { class: 'panel-card' },
        h('div', { class: 'hint' }, 'Moves start at the current time indicator and keyframe the Smart Rig (created automatically if needed). Set duration, strength and ease on the right.')),
      ...moveGroups,
      Group('3D layout (selected layers)', [
        h('div', { class: 'panel-card' },
          h('div', { class: 'row' },
            Field('Depth spread', Select(DEPTH_MODES.map((d) => ({ value: d.id, label: d.label })), () => c.depthMode, set('depthMode'))),
            Toggle('Keep apparent size', () => c.compensate, set('compensate'))),
          h('div', { class: 'row' },
            Slider({ label: 'Near Z', min: -3000, max: 3000, step: 10, get: () => c.near, set: set('near') }),
            Slider({ label: 'Far Z', min: -3000, max: 12000, step: 10, get: () => c.far, set: set('far') })),
          Btn('Distribute depth', () => this.depth(), { variant: 'soft', icon: 'wand' })),
        arr.el,
      ]),
      Group('Focus & depth of field', [h('div', { class: 'panel-card' },
        Chips(['1.4', '2', '2.8', '4', '5.6', '8', '11', '16'].map((f) => ({ value: f, label: 'f/' + f })), () => String(c.fstop), (v) => { c.fstop = +v; this.save(); }),
        h('div', { class: 'row' },
          Slider({ label: 'Blur level %', min: 0, max: 300, get: () => c.blur, set: set('blur') }),
          Slider({ label: 'Focus pull (s)', min: 0.1, max: 3, step: 0.05, get: () => c.pull, set: set('pull') })),
        h('div', { class: 'row3' },
          Btn('Auto focus', () => this.focus('auto'), { size: 'sm', variant: 'soft', title: 'Focus follows the selected layer' }),
          Btn('Rack focus', () => this.focus('rack'), { size: 'sm', title: 'Pull focus through the selected layers, one per hold time' }),
          Btn('DOF off', () => this.focus('off'), { size: 'sm' })))]),
      Group('Camera shake', [shk.el,
        h('div', { class: 'row' }, Btn('Apply shake', () => this.shake(), { variant: 'soft', icon: 'wand' }), Btn('Remove shake', () => this.act('camShake', { clear: true, amount: c.amount, speed: c.speed, seed: c.sseed }, 'Shake removed'), { variant: 'danger' }))]),
      Group('Smart tools', [h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' } },
        ...[
          ['Frame selected', 'fit the selection in shot', () => this.act('camFrame', { margin: 1.15 }, 'Framed')],
          ['Tour selected', 'visit layers in selection order', () => this.act('camTour', { hold: c.hold, travel: c.travel, orbit: c.orbitTour, bezier: easeById(c.ease).bezier }, 'Tour created')],
          ['Follow selected', 'rig tracks a moving layer', () => this.act('camFollow', { smooth: c.follow }, 'Following')],
          ['Stop following', 'release the target', () => this.act('camFollow', { off: true }, 'Follow removed')],
          ['Depth fade', 'far layers fade out', () => this.act('camDepthFx', { mode: 'fade', near: 1500, far: 6000 }, 'Depth fade on')],
          ['Atmosphere', 'fade + blur with distance', () => this.act('camDepthFx', { mode: 'fog', near: 1500, far: 6000, blur: 18 }, 'Atmosphere on')],
          ['Auto cull', 'hide layers behind camera', () => this.act('camDepthFx', { mode: 'cull' }, 'Culling on')],
          ['Clear depth FX', 'remove fade / cull', () => this.act('camDepthFx', { mode: 'none' }, 'Depth FX cleared')],
          ['Motion blur 180°', 'cinematic blur on 3D layers', () => this.act('camMotionBlur', { on: true, angle: 180 }, 'Motion blur on')],
          ['Smooth keyframes', 'remove jitter on selected props', () => this.act('camSmooth', { strength: 0.5 }, 'Smoothed')],
          ['Bake camera', 'expressions → keyframes', () => this.act('camBake', {}, 'Camera baked')],
          ['Cut at markers', 'switch selected cameras', () => this.act('camCuts', {}, 'Camera cuts set')],
        ].map(([label, sub, fn]) => { const t = h('div', { class: 'tile' }, h('div', { class: 'tile-label' }, label as string), h('div', { class: 'tile-sub' }, sub as string)); t.addEventListener('click', fn as () => void); return t; }))]),
    ];

    const right = [
      Section('Move settings', [
        Slider({ label: 'Duration (s)', min: 0.2, max: 12, step: 0.1, get: () => c.dur, set: set('dur') }),
        Slider({ label: 'Strength', min: 0.1, max: 3, step: 0.05, get: () => c.intensity, set: set('intensity') }),
        Field('Ease', Select(BEZ_EASES.map((e) => ({ value: e.id, label: `${e.group} · ${e.label}` })), () => c.ease, set('ease'))),
        Slider({ label: 'Physical overshoot', min: 0, max: 100, get: () => c.physical, set: set('physical'), title: 'The camera has mass: it overshoots and settles after each move' }),
      ], { color: 'var(--lime)' }),
      Section('Layout settings', [
        Slider({ label: 'Spacing', min: 0.3, max: 4, step: 0.05, get: () => c.spacing, set: set('spacing') }),
        Slider({ label: 'Radius', min: 50, max: 5000, step: 10, get: () => c.radius, set: set('radius') }),
        Slider({ label: 'Depth', min: 0, max: 8000, step: 10, get: () => c.depth, set: set('depth') }),
        Slider({ label: 'Seed', min: 1, max: 999, get: () => c.seed, set: set('seed') }),
        Field('Center', Seg([{ value: 'comp', label: 'Comp' }, { value: 'selection', label: 'Selection' }], () => c.around, set('around'))),
        Toggle('Face camera (auto-orient)', () => c.face, set('face')),
      ], { color: 'var(--violet)' }),
      Section('Shake settings', [
        Slider({ label: 'Amount %', min: 0, max: 400, get: () => c.amount, set: set('amount') }),
        Slider({ label: 'Speed %', min: 5, max: 400, get: () => c.speed, set: set('speed') }),
        Slider({ label: 'Seed', min: 1, max: 999, get: () => c.sseed, set: set('sseed') }),
      ], { color: 'var(--info)', collapsed: true }),
      Section('Tour & focus', [
        Slider({ label: 'Hold per stop (s)', min: 0.2, max: 6, step: 0.1, get: () => c.hold, set: set('hold') }),
        Slider({ label: 'Travel (s)', min: 0.2, max: 6, step: 0.1, get: () => c.travel, set: set('travel') }),
        Slider({ label: 'Tour orbit swing (°)', min: 0, max: 60, get: () => c.orbitTour, set: set('orbitTour') }),
        Slider({ label: 'Follow smoothing (s)', min: 0, max: 2, step: 0.05, get: () => c.follow, set: set('follow') }),
      ], { color: 'var(--text-3)', collapsed: true }),
    ];
    this.el = Page({ title: '3D Camera', sub: 'Direct control of After Effects’ camera and 3D layers — rigs, moves, depth, focus and shake in one click.', side: left, main, right }).el;
    registerCommands([
      ...MOVES.map((m) => ({ id: 'cam.' + m.id, label: 'Camera: ' + m.label, group: 'Camera', keywords: m.group + ' ' + m.sub, run: () => this.move(m) })),
      ...ARRANGES.map((a) => ({ id: 'arr.' + a.id, label: '3D Layout: ' + a.label, group: 'Camera', run: () => this.arrange(a.id) })),
      { id: 'cam.rig', label: 'Camera: Create Smart Rig', group: 'Camera', run: () => this.act('camRig', { lens: c.lens, dof: c.dof }, 'Smart Rig ready') },
      { id: 'cam.frame', label: 'Camera: Frame selected layers', group: 'Camera', run: () => this.act('camFrame', { margin: 1.15 }, 'Framed') },
    ]);
  }

  activate() { this.refresh(); }
  deactivate() {}
  private save() { try { localStorage.setItem(LS, JSON.stringify(this.cfg)); } catch { /* */ } }

  private async act(fn: string, args: any, ok: string) {
    try {
      const r = await call<any>(fn, args);
      toast(ok + (r?.layers !== undefined ? ` · ${r.layers} layer(s)` : ''));
      if (r?.warnings?.length) r.warnings.slice(0, 3).forEach((w: string) => toast(w, 'info', 5000));
      this.refresh();
      return r;
    } catch (e: any) { toast(e.message, 'err', 6000); return null; }
  }

  async refresh() {
    try {
      this.scene = await call<Scene>('camScene');
      this.renderRig();
      this.draw();
    } catch (e: any) { if (inAE) toast(e.message, 'info', 4000); }
  }

  // ───────── rig live controls ─────────
  private renderRig() {
    const box = this.rigBox;
    box.innerHTML = '';
    const r = this.scene?.rig;
    if (!r) { box.append(h('div', { class: 'empty' }, 'No Smart Rig in this comp yet.')); return; }
    box.append(h('div', { class: 'lbl' }, 'Rig · ' + r.name));
    const live = (label: string, key: keyof typeof r, min: number, max: number, step = 1) => Slider({
      label, min, max, step, get: () => (this.scene?.rig?.[key] as number) ?? 0,
      set: (v, fin) => { (this.scene!.rig as any)[key] = v; refreshAll(); this.draw(); if (fin) call('camSetRig', { [key]: v }).catch((e) => toast(e.message, 'err')); },
    });
    box.append(
      live('Distance', 'distance', 50, 12000, 10), live('Orbit °', 'orbit', -360, 360), live('Tilt °', 'tilt', -89, 89),
      live('Roll °', 'roll', -180, 180), live('Pan °', 'pan', -90, 90), live('Look °', 'look', -60, 60), live('Focal mm', 'focal', 8, 300),
    );
    refreshAll();
  }

  // ───────── actions ─────────
  private move(m: MoveDef) {
    const c = this.cfg;
    const k = c.intensity;
    const ops = m.ops.map((o) => ({ ...o, value: o.op === 'mul' ? 1 + (o.value - 1) * k : o.op === 'add' ? o.value * k : o.value }));
    const ease = easeById(m.ease && !this.userEase ? m.ease : c.ease);
    const bez = ease.bezier ?? easeById('camera').bezier;
    this.act('camKeys', { ops, dur: m.dur && c.dur === 2.5 ? m.dur : c.dur, bezier: bez, physical: c.physical || 0, marker: m.label }, `${m.label} at the playhead`);
  }
  private get userEase() { return this.cfg.ease !== 'camera'; }

  private selected(): SceneLayer[] { return (this.scene?.layers ?? []).filter((l) => l.sel); }

  private async arrange(id: ArrangeId) {
    await this.refresh();
    const L = this.selected();
    if (!L.length) { toast('Select layers in After Effects first', 'info'); return; }
    const c = this.cfg, s = this.scene!;
    const center: [number, number, number] = c.around === 'selection'
      ? [L.reduce((a, l) => a + l.pos[0], 0) / L.length, L.reduce((a, l) => a + l.pos[1], 0) / L.length, L.reduce((a, l) => a + l.pos[2], 0) / L.length]
      : [s.comp.w / 2, s.comp.h / 2, 0];
    const items = arrange(id, L, { spacing: c.spacing, radius: c.radius, depth: c.depth, center, seed: c.seed, face: c.face });
    this.act('camLayout', { items, face: c.face ? true : undefined }, ARRANGES.find((a) => a.id === id)!.label);
  }

  private async depth() {
    await this.refresh();
    const L = this.selected();
    if (!L.length) { toast('Select layers in After Effects first', 'info'); return; }
    const c = this.cfg;
    const items = distributeDepth(L, c.depthMode, c.near, c.far, c.compensate, this.scene!.cam, c.seed);
    this.act('camLayout', { items }, 'Depth distributed');
  }

  private async focus(mode: 'auto' | 'rack' | 'off') {
    const c = this.cfg;
    if (mode === 'off') return this.act('camFocus', { mode }, 'Depth of field off');
    await this.refresh();
    const L = this.selected();
    if (!L.length) { toast('Select the layer(s) to focus on', 'info'); return; }
    const t0 = this.scene!.comp.time;
    this.act('camFocus', { mode, layers: L.map((l) => l.name), times: L.map((_, i) => t0 + i * c.hold), fstop: c.fstop, blur: c.blur, pull: c.pull }, mode === 'auto' ? `Focus locked on ${L[0].name}` : `Rack focus through ${L.length} layers`);
  }

  private shake() {
    const c = this.cfg;
    const s = SHAKES.find((x) => x.id === c.shake) ?? SHAKES[0];
    this.act('camShake', { pos: shakeExpr(s, 'pos'), rx: shakeExpr(s, 'rx'), ry: shakeExpr(s, 'ry'), rz: shakeExpr(s, 'rz'), amount: c.amount, speed: c.speed, seed: c.sseed }, `${s.label} shake`);
  }

  // ───────── schematic view ─────────
  private draw() {
    const cv = this.canvas, r = cv.getBoundingClientRect();
    if (r.width < 2) { requestAnimationFrame(() => this.draw()); return; }
    const dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height;
    g.clearRect(0, 0, W, H);
    const s = this.scene;
    if (!s) { g.fillStyle = 'rgba(247,247,248,.4)'; g.font = '12px Inter'; g.fillText('Open a comp in AE and press Refresh', 14, 24); return; }
    const top = this.cfg.view === 'top';
    // horizontal axis: x (top) or z (side); vertical: z (top, depth goes up) or y (side)
    const P = (p: number[]) => (top ? [p[0], p[2]] : [p[2], p[1]]);
    const pts = [...s.layers.map((l) => P(l.pos)), P(s.cam)];
    if (s.rig) pts.push(P(s.rig.pos));
    let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    let y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const padX = Math.max(200, (x1 - x0) * 0.15), padY = Math.max(200, (y1 - y0) * 0.15);
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
    const sc = Math.min(W / (x1 - x0), H / (y1 - y0));
    const ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oy = top ? H - ((H - (y1 - y0) * sc) / 2 - y0 * sc) : (H - (y1 - y0) * sc) / 2 - y0 * sc;
    const S = (p: number[]): [number, number] => { const q = P(p); return top ? [ox + q[0] * sc, oy - q[1] * sc] : [ox + q[0] * sc, oy + q[1] * sc]; };
    this.vmap = { s: sc, ox, oy };
    // grid
    g.strokeStyle = 'rgba(255,255,255,.05)';
    g.lineWidth = 1;
    const step = Math.pow(10, Math.floor(Math.log10((x1 - x0) / 6)));
    for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) { const X = ox + x * sc; g.beginPath(); g.moveTo(X, 0); g.lineTo(X, H); g.stroke(); }
    // comp plane at z=0
    const zp = S([0, 0, 0]);
    g.strokeStyle = 'rgba(209,254,23,.18)';
    g.setLineDash([4, 4]);
    g.beginPath();
    if (top) { g.moveTo(0, zp[1]); g.lineTo(W, zp[1]); } else { g.moveTo(zp[0], 0); g.lineTo(zp[0], H); }
    g.stroke();
    g.setLineDash([]);
    // layers
    for (const l of s.layers) {
      const c = S(l.pos);
      const half = ((top ? l.w : l.h) * Math.abs(l.scale[top ? 0 : 1]) / 100 / 2) * sc;
      const ang = top ? ((l.rot[1] ?? 0) * Math.PI) / 180 : ((l.rot[0] ?? 0) * Math.PI) / 180;
      g.strokeStyle = l.sel ? '#d1fe17' : l.threeD ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.3)';
      g.lineWidth = l.sel ? 3 : 2;
      g.beginPath();
      g.moveTo(c[0] - Math.cos(ang) * half, c[1] - Math.sin(ang) * half);
      g.lineTo(c[0] + Math.cos(ang) * half, c[1] + Math.sin(ang) * half);
      g.stroke();
      g.fillStyle = l.sel ? '#d1fe17' : 'rgba(247,247,248,.55)';
      g.font = '10px Inter';
      g.fillText(l.name.slice(0, 16), c[0] + 4, c[1] - 6);
    }
    // camera
    const cp = S(s.cam), tp = s.rig ? S(s.rig.pos) : S([s.comp.w / 2, s.comp.h / 2, 0]);
    g.strokeStyle = 'rgba(76,201,240,.5)';
    g.beginPath(); g.moveTo(cp[0], cp[1]); g.lineTo(tp[0], tp[1]); g.stroke();
    const dir = Math.atan2(tp[1] - cp[1], tp[0] - cp[0]);
    const fov = s.rig ? Math.atan((s.comp.w / 2) / (s.comp.w * s.rig.focal / 36)) : 0.35;
    g.fillStyle = 'rgba(76,201,240,.12)';
    g.beginPath(); g.moveTo(cp[0], cp[1]);
    g.lineTo(cp[0] + Math.cos(dir - fov) * 400, cp[1] + Math.sin(dir - fov) * 400);
    g.lineTo(cp[0] + Math.cos(dir + fov) * 400, cp[1] + Math.sin(dir + fov) * 400);
    g.closePath(); g.fill();
    g.fillStyle = '#4cc9f0';
    g.beginPath(); g.arc(cp[0], cp[1], 6, 0, 7); g.fill();
    g.beginPath(); g.arc(tp[0], tp[1], 3.5, 0, 7); g.fill();
    g.fillStyle = 'rgba(247,247,248,.5)';
    g.fillText(top ? 'TOP · X / Z' : 'SIDE · Z / Y', 10, 16);
  }

  private bindCanvas() {
    const cv = this.canvas;
    const hit = (mx: number, my: number) => {
      const s = this.scene;
      if (!s) return -1;
      const top = this.cfg.view === 'top', { s: sc, ox, oy } = this.vmap;
      let best = -1, bd = 14;
      s.layers.forEach((l, i) => {
        const q = top ? [ox + l.pos[0] * sc, oy - l.pos[2] * sc] : [ox + l.pos[2] * sc, oy + l.pos[1] * sc];
        const d = Math.hypot(q[0] - mx, q[1] - my);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };
    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect();
      const i = hit(e.clientX - r.left, e.clientY - r.top);
      if (i < 0) return;
      cv.setPointerCapture(e.pointerId);
      this.drag = { li: i, ox: e.clientX, oy: e.clientY };
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.drag || !this.scene) return;
      const l = this.scene.layers[this.drag.li];
      const dx = (e.clientX - this.drag.ox) / this.vmap.s, dy = (e.clientY - this.drag.oy) / this.vmap.s;
      this.drag.ox = e.clientX; this.drag.oy = e.clientY;
      if (this.cfg.view === 'top') { l.pos[0] += dx; l.pos[2] -= dy; } else { l.pos[2] += dx; l.pos[1] += dy; }
      this.draw();
    });
    cv.addEventListener('pointerup', () => {
      if (!this.drag || !this.scene) return;
      const l = this.scene.layers[this.drag.li];
      this.drag = null;
      call('camLayout', { items: [{ index: l.index, pos: l.pos.map((v) => Math.round(v * 10) / 10) }] }).then(() => this.refresh()).catch((e) => toast(e.message, 'err'));
    });
    new ResizeObserver(() => this.draw()).observe(cv);
    onRefresh(cv, () => {});
  }
}
