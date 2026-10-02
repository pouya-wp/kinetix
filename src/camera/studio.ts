import { h, Section, Slider, Seg, Btn, Field, Select, Toggle, toast, refreshAll, Chips, clear } from '../ui/kit';
import { Page, Group } from '../core/page';
import { call, inAE } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { EASE_LIBRARY, easeById } from '../animate/eases';
import { MOVES, SHAKES, LENSES, shakeExpr, type MoveDef } from './moves';
import { ARRANGES, arrange, distributeDepth, type SceneLayer, type ArrangeId } from './layout';
import type { Studio } from '../main';

interface Scene {
  comp: { w: number; h: number; fps: number; time: number; duration: number; name: string };
  rig: null | { name: string; pos: number[]; distance: number; orbit: number; tilt: number; roll: number; focal: number; pan: number; look: number; overshoot: number };
  cameras: { index: number; name: string; active: boolean }[];
  layers: SceneLayer[];
  cam: number[];
  twoD?: number;
}
interface Pose {
  rig: string | null; t: number; fps: number; duration: number;
  values?: { distance: number; orbit: number; tilt: number; roll: number; pan: number; look: number; focal: number; position: number[] };
  keys?: number[];
  dof?: { on: boolean; focus: number; aperture: number; blur: number; auto: boolean } | null;
}

const LS = 'kinetix.camera2';
const BEZ = EASE_LIBRARY.filter((e) => e.bezier);
const READY = ['push-in', 'pull-out', 'orbit-l', 'orbit-r', 'crane-up', 'vertigo-in', 'truck-r', 'whip-r', 'spiral-in', 'hero-reveal', 'drone', 'dutch-r'];
const SHAKE_QUICK = ['handheld', 'breathing', 'walk', 'steadicam', 'drone', 'impact', 'earthquake', 'subtle'];
const IRIS = ['Fast Rectangle', 'Triangle', 'Square', 'Pentagon', 'Hexagon', 'Heptagon', 'Octagon', 'Nonagon', 'Decagon'];

export class CameraStudio implements Studio {
  id = 'camera';
  el: HTMLElement;
  private scene: Scene | null = null;
  private pose: Pose | null = null;
  private c = { ease: 'camera', dur: 2.5, strength: 1, physical: 0, shake: 'handheld', amount: 100, speed: 100, near: 0, far: 3000, keepSize: true, fstop: 2.8, blur: 100, iris: 7, lens: 50, view: 'top' as 'top' | 'side', arrange: 'line-z' as ArrangeId, spacing: 1.2, radius: 900, depth: 800 };
  private active = false;
  private poll = 0;
  private live: Record<string, any> = {};
  private sending = false;
  private status: HTMLElement;
  private keysBar: HTMLElement;
  private layerBox: HTMLElement;
  private focusSel: HTMLSelectElement;
  private view: HTMLCanvasElement;
  private readouts: Record<string, HTMLElement> = {};

  constructor() {
    try { Object.assign(this.c, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { /* */ }
    const c = this.c;
    const save = () => { try { localStorage.setItem(LS, JSON.stringify(c)); } catch { /* */ } };
    const set = <K extends keyof typeof c>(k: K) => (v: any) => { (c as any)[k] = v; save(); };
    this.status = h('div', { class: 'stack' });
    this.keysBar = h('div');
    this.layerBox = h('div', { class: 'list' });
    this.focusSel = h('select', { class: 'input' }) as HTMLSelectElement;
    this.view = h('canvas', { style: { width: '100%', height: '220px', display: 'block', borderRadius: '14px', background: 'var(--bg-deep)' } });

    // ───── 1. camera
    const camSec = Section('1 · Camera', [
      this.status,
      Btn('Add camera', () => this.addCamera(), { variant: 'primary', block: true, icon: 'camera' }),
      h('div', { class: 'lbl' }, 'Lens'),
      Chips(LENSES.map((mm) => ({ value: String(mm), label: mm + 'mm' })), () => String(c.lens), (v) => { c.lens = +v; save(); this.send({ focal: +v }, true); }),
    ], { color: 'var(--lime)' });

    // ───── 3. focus & blur
    this.focusSel.addEventListener('change', () => { if (this.focusSel.value) this.act('camFocus', { mode: 'auto', layers: [this.focusSel.value], fstop: c.fstop, blur: c.blur }, 'Focus follows ' + this.focusSel.value); });
    const focusSec = Section('3 · Focus & blur', [
      Toggle('Depth of field', () => !!this.pose?.dof?.on, (v) => this.act('camDOF', { on: v }, v ? 'DOF on' : 'DOF off')),
      Field('Focus on layer (auto)', this.focusSel),
      Slider({ label: 'Manual focus distance', min: 50, max: 10000, step: 10, get: () => this.pose?.dof?.focus ?? 2000, set: (v, f) => { if (this.pose?.dof) this.pose.dof.focus = v; if (f) this.act('camDOF', { focus: v }, 'Focus set'); } }),
      h('div', { class: 'lbl' }, 'Aperture'),
      Chips(['1.2', '1.8', '2.8', '4', '5.6', '8', '11', '16'].map((f) => ({ value: f, label: 'f/' + f })), () => String(c.fstop), (v) => { c.fstop = +v; save(); this.act('camDOF', { fstop: +v }, `f/${v}`); }),
      Slider({ label: 'Blur amount %', min: 0, max: 400, get: () => c.blur, set: (v, f) => { c.blur = v; save(); if (f) this.act('camDOF', { blur: v }, 'Blur set'); } }),
      Field('Bokeh shape', Select(IRIS.map((n, i) => ({ value: String(i + 1), label: n })), () => String(c.iris), (v) => { c.iris = +v; save(); this.act('camDOF', { iris: +v }, IRIS[+v - 1] + ' bokeh'); })),
      Btn('Rack focus through selected layers', () => this.rack(), { size: 'sm', variant: 'soft' }),
    ], { color: 'var(--info)' });

    // ───── main: 2-axis director pads
    const director = h('div', { class: 'panel-card' },
      h('div', { class: 'hstack' }, h('b', { class: 'grow', style: { fontSize: '15px' } }, '🎮 Director'), h('span', { class: 'hint' }, 'Drag the pads — AE follows live')),
      h('div', { class: 'pads' },
        this.pad('Orbit', 'drag ↔ orbit · ↕ height', (dx, dy, st) => ({ orbit: st.orbit + dx * 0.35, tilt: Math.max(-85, Math.min(85, st.tilt - dy * 0.25)) })),
        this.pad('Move', 'drag to slide the camera', (dx, dy, st) => { const k = Math.max(0.4, st.distance / 1200); return { position: [st.position[0] - dx * k, st.position[1] - dy * k, st.position[2]] }; }),
        this.strip('Dolly', (dy, st) => ({ distance: Math.max(40, st.distance * Math.exp(dy * 0.005)) })),
      ),
      h('div', { class: 'row' },
        Slider({ label: 'Roll °', min: -45, max: 45, step: 0.5, get: () => this.pose?.values?.roll ?? 0, set: (v, f) => this.send({ roll: v }, f) }),
        Slider({ label: 'Lens mm', min: 10, max: 200, step: 1, get: () => this.pose?.values?.focal ?? 50, set: (v, f) => this.send({ focal: v }, f) })),
      h('div', { class: 'row' },
        Slider({ label: 'Pan (look left/right) °', min: -60, max: 60, step: 0.5, get: () => this.pose?.values?.pan ?? 0, set: (v, f) => this.send({ pan: v }, f) }),
        Slider({ label: 'Look up/down °', min: -40, max: 40, step: 0.5, get: () => this.pose?.values?.look ?? 0, set: (v, f) => this.send({ look: v }, f) })),
      h('div', { class: 'keyrow' },
        Btn('◆ Key pose', () => this.act('camKeyPose', { bezier: easeById(c.ease).bezier }, 'Pose keyed at the playhead'), { variant: 'primary' }),
        Btn('◀', () => this.jump(-1), { title: 'Previous key' }),
        Btn('▶', () => this.jump(1), { title: 'Next key' }),
        Btn('Delete key', () => this.act('camDeleteKey', {}, 'Key deleted'), { variant: 'danger' }),
        Btn('Clear', () => this.act('camClearKeys', {}, 'All camera keys removed'), {}),
      ),
      Field('Ease between poses', Select(BEZ.map((e) => ({ value: e.id, label: `${e.group} · ${e.label}` })), () => c.ease, set('ease'))),
      this.keysBar,
      h('div', { class: 'hint' }, 'Workflow: move the AE playhead → pose the camera with the pads → ◆ Key pose. Repeat. Keys that already exist update automatically while you drag.'),
    );

    // ───── 2. layers & depth
    const layersCard = h('div', { class: 'panel-card' },
      h('div', { class: 'hstack' },
        Btn('− Closer together', () => this.act('camSpread', { factor: 0.8 }, 'Depth compressed'), { size: 'sm' }),
        Btn('+ Further apart', () => this.act('camSpread', { factor: 1.25 }, 'Depth expanded'), { size: 'sm' })),
      h('div', { class: 'row' },
        Slider({ label: 'Front Z', min: -3000, max: 3000, step: 10, get: () => c.near, set: set('near') }),
        Slider({ label: 'Back Z', min: -2000, max: 12000, step: 10, get: () => c.far, set: set('far') })),
      h('div', { class: 'row' }, Toggle('Keep on-screen size', () => c.keepSize, set('keepSize')), Btn('Spread evenly', () => this.distribute(), { size: 'sm', variant: 'soft' })),
      Field('Arrange selected', h('div', { class: 'hstack' }, Select(ARRANGES.map((a) => ({ value: a.id, label: a.label })), () => c.arrange, set('arrange')), Btn('Apply', () => this.arrangeSel(), { size: 'sm' }))),
      this.layerBox,
    );

    // ───── 4. ready effects
    const ready = h('div', { class: 'panel-card' },
      h('div', { class: 'lbl' }, 'Moves (start at the playhead)'),
      h('div', { class: 'chips' }, ...READY.map((id) => { const m = MOVES.find((x) => x.id === id)!; return h('button', { class: 'chip', title: m.sub, onclick: () => this.move(m) }, m.label); })),
      h('div', { class: 'row' },
        Slider({ label: 'Move duration (s)', min: 0.3, max: 10, step: 0.1, get: () => c.dur, set: set('dur') }),
        Slider({ label: 'Strength', min: 0.2, max: 3, step: 0.05, get: () => c.strength, set: set('strength') })),
      Slider({ label: 'Camera weight (overshoot)', min: 0, max: 100, get: () => c.physical, set: set('physical') }),
      h('div', { class: 'lbl' }, 'Shake'),
      h('div', { class: 'chips' }, ...SHAKE_QUICK.map((id) => { const s = SHAKES.find((x) => x.id === id)!; return h('button', { class: 'chip', title: s.sub, onclick: () => { c.shake = id; save(); this.shake(); } }, s.label); }),
        h('button', { class: 'chip', onclick: () => this.act('camShake', { clear: true, amount: c.amount, speed: c.speed, seed: 1 }, 'Shake removed') }, '✕ No shake')),
      h('div', { class: 'row' },
        Slider({ label: 'Shake amount %', min: 0, max: 400, get: () => c.amount, set: set('amount') }),
        Slider({ label: 'Shake speed %', min: 10, max: 400, get: () => c.speed, set: set('speed') })),
      h('div', { class: 'lbl' }, 'Tools'),
      h('div', { class: 'chips' },
        h('button', { class: 'chip', onclick: () => this.act('camFrame', { margin: 1.15 }, 'Framed the selection') }, 'Frame selected'),
        h('button', { class: 'chip', onclick: () => this.act('camTour', { hold: 1.2, travel: 1.4, orbit: 8, bezier: easeById(c.ease).bezier }, 'Tour created') }, 'Tour selected'),
        h('button', { class: 'chip', onclick: () => this.act('camFollow', { smooth: 0.3 }, 'Camera follows the selection') }, 'Follow selected'),
        h('button', { class: 'chip', onclick: () => this.act('camFollow', { off: true }, 'Follow off') }, 'Stop follow'),
        h('button', { class: 'chip', onclick: () => this.act('camMotionBlur', { on: true, angle: 180 }, 'Motion blur on') }, 'Motion blur'),
        h('button', { class: 'chip', onclick: () => this.act('camDepthFx', { mode: 'fog', near: 1500, far: 6000, blur: 18 }, 'Atmosphere on') }, 'Atmosphere'),
        h('button', { class: 'chip', onclick: () => this.act('camBake', {}, 'Camera baked to keyframes') }, 'Bake')),
    );

    const right = [
      Section('Scene view', [
        Seg([{ value: 'top', label: 'Top' }, { value: 'side', label: 'Side' }], () => c.view, (v) => { c.view = v; save(); this.draw(); }),
        this.view,
        h('div', { class: 'hint' }, 'Blue = camera and what it sees. Lime = selected layers.'),
      ], { color: 'var(--info)' }),
    ];
    this.el = Page({
      title: '3D Camera', sub: 'Add a camera, arrange your layers in depth, pose and key the camera with the Director pads, set focus — done.',
      side: [camSec, focusSec],
      main: [Group('Director', [director]), Group('2 · Layers & depth', [layersCard]), Group('4 · Ready moves & shake', [ready])],
      right,
    }).el;
    new ResizeObserver(() => this.draw()).observe(this.view);
    registerCommands([
      { id: 'cam.add', label: 'Camera: Add camera', group: 'Camera', run: () => this.addCamera() },
      { id: 'cam.key', label: 'Camera: Key pose at playhead', group: 'Camera', run: () => this.act('camKeyPose', { bezier: easeById(c.ease).bezier }, 'Pose keyed') },
      ...MOVES.map((m) => ({ id: 'cam.' + m.id, label: 'Camera: ' + m.label, group: 'Camera', keywords: m.sub, run: () => this.move(m) })),
    ]);
  }

  activate() {
    this.active = true;
    this.refresh();
    clearInterval(this.poll);
    // follow the AE playhead / undo while the tab is open
    this.poll = window.setInterval(() => { if (this.active && !this.sending && !document.hidden) this.refreshPose(); }, 1200);
  }
  deactivate() { this.active = false; clearInterval(this.poll); }

  // ───────── data ─────────
  private async refresh() {
    try { this.scene = await call<Scene>('camScene'); } catch (e: any) { if (inAE) toast(e.message, 'info'); }
    await this.refreshPose();
    this.renderLayers();
    this.draw();
  }
  private async refreshPose() {
    try { this.pose = await call<Pose>('camPose'); } catch { return; }
    this.renderStatus();
    this.renderKeys();
    refreshAll();
  }
  private async act(fn: string, args: any, ok: string) {
    try {
      const r = await call<any>(fn, args);
      toast(ok);
      r?.warnings?.slice?.(0, 3).forEach((w: string) => toast(w, 'info', 5000));
      await this.refresh();
      return r;
    } catch (e: any) { toast(e.message, 'err', 6000); return null; }
  }
  private async addCamera() {
    await this.act('camRig', { lens: this.c.lens, dof: false, make3D: true }, 'Camera added — your layers are now 3D');
  }

  /** Throttled live updates while dragging. */
  private send(v: Record<string, any>, final = false) {
    if (!this.pose?.rig) { if (final) toast('Add a camera first', 'info'); return; }
    Object.assign(this.pose.values!, v);
    Object.assign(this.live, v);
    this.updateReadouts();
    this.drawFromPose();
    const flush = async () => {
      if (this.sending) return;
      const payload = this.live;
      this.live = {};
      if (!Object.keys(payload).length) return;
      this.sending = true;
      try { await call('camLive', payload); } catch (e: any) { toast(e.message, 'err'); }
      this.sending = false;
      if (Object.keys(this.live).length) flush();
      else if (final) this.refreshPose();
    };
    flush();
  }

  // ───────── pads ─────────
  private pad(label: string, sub: string, map: (dx: number, dy: number, st: NonNullable<Pose['values']>) => Record<string, any>) {
    const dot = h('div', { class: 'pad-dot' });
    const read = h('div', { class: 'pad-read' });
    this.readouts[label] = read;
    const el = h('div', { class: 'pad' }, h('div', { class: 'pad-grid' }), dot, h('div', { class: 'pad-label' }, label), h('div', { class: 'pad-sub' }, sub), read);
    let st: NonNullable<Pose['values']> | null = null, x0 = 0, y0 = 0;
    el.addEventListener('pointerdown', (e) => {
      if (!this.pose?.values) { toast('Add a camera first', 'info'); return; }
      el.setPointerCapture(e.pointerId);
      st = structuredClone(this.pose.values);
      x0 = e.clientX; y0 = e.clientY;
      el.classList.add('on');
    });
    el.addEventListener('pointermove', (e) => {
      if (!st) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      const r = el.getBoundingClientRect();
      dot.style.transform = `translate(${Math.max(-r.width / 2 + 10, Math.min(r.width / 2 - 10, dx))}px, ${Math.max(-r.height / 2 + 10, Math.min(r.height / 2 - 10, dy))}px)`;
      this.send(map(dx, dy, st));
    });
    const end = (e: PointerEvent) => {
      if (!st) return;
      this.send(map(e.clientX - x0, e.clientY - y0, st), true);
      st = null;
      dot.style.transform = '';
      el.classList.remove('on');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    return el;
  }
  private strip(label: string, map: (dy: number, st: NonNullable<Pose['values']>) => Record<string, any>) {
    const knob = h('div', { class: 'strip-knob' });
    const read = h('div', { class: 'pad-read' });
    this.readouts[label] = read;
    const el = h('div', { class: 'strip' }, knob, h('div', { class: 'pad-label' }, label), h('div', { class: 'pad-sub' }, '↑ closer · ↓ farther'), read);
    let st: NonNullable<Pose['values']> | null = null, y0 = 0;
    el.addEventListener('pointerdown', (e) => { if (!this.pose?.values) { toast('Add a camera first', 'info'); return; } el.setPointerCapture(e.pointerId); st = structuredClone(this.pose.values); y0 = e.clientY; el.classList.add('on'); });
    el.addEventListener('pointermove', (e) => { if (!st) return; const dy = e.clientY - y0; knob.style.transform = `translateY(${Math.max(-60, Math.min(60, dy))}px)`; this.send(map(dy, st)); });
    const end = (e: PointerEvent) => { if (!st) return; this.send(map(e.clientY - y0, st), true); st = null; knob.style.transform = ''; el.classList.remove('on'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    return el;
  }
  private updateReadouts() {
    const v = this.pose?.values;
    if (!v) { Object.values(this.readouts).forEach((r) => (r.textContent = '—')); return; }
    this.readouts.Orbit && (this.readouts.Orbit.textContent = `${v.orbit.toFixed(0)}° · ${v.tilt.toFixed(0)}°`);
    this.readouts.Move && (this.readouts.Move.textContent = `${v.position[0].toFixed(0)}, ${v.position[1].toFixed(0)}`);
    this.readouts.Dolly && (this.readouts.Dolly.textContent = `${v.distance.toFixed(0)} px`);
  }

  // ───────── panels ─────────
  private renderStatus() {
    clear(this.status);
    const p = this.pose;
    if (!p?.rig) this.status.append(h('div', { class: 'empty' }, 'No camera yet. “Add camera” creates one and turns your layers 3D — the view looks exactly the same until you move it.'));
    else this.status.append(h('div', { class: 'kv' }, h('span', null, 'Camera'), h('b', null, p.rig), h('span', null, 'Playhead'), h('b', null, p.t.toFixed(2) + 's'), h('span', null, 'Keys'), h('b', null, String(p.keys?.length ?? 0))));
    const n2 = this.scene?.twoD ?? 0;
    if (p?.rig && n2 > 0) this.status.append(h('div', { class: 'hint', style: { color: '#ffb4b6' } }, `${n2} layer(s) are still 2D and ignore the camera.`), Btn('Make all layers 3D', () => this.act('camMake3D', { on: true, all: true }, 'All layers are 3D'), { size: 'sm', variant: 'soft' }));
    this.updateReadouts();
  }

  private renderKeys() {
    const p = this.pose;
    clear(this.keysBar);
    if (!p?.rig) return;
    const D = Math.max(p.duration, 0.1);
    const bar = h('div', { class: 'keybar' }, h('div', { class: 'keybar-head', style: { left: (p.t / D) * 100 + '%' } }));
    (p.keys ?? []).forEach((t, i) => {
      const k = h('button', { class: 'keybar-key' + (Math.abs(t - p.t) < 0.5 / p.fps ? ' on' : ''), style: { left: (t / D) * 100 + '%' }, title: `Pose ${i + 1} · ${t.toFixed(2)}s` });
      k.addEventListener('click', () => this.goto(t));
      bar.appendChild(k);
    });
    bar.addEventListener('click', (e) => { if ((e.target as HTMLElement).classList.contains('keybar-key')) return; const r = bar.getBoundingClientRect(); this.goto(((e.clientX - r.left) / r.width) * D); });
    this.keysBar.append(h('div', { class: 'lbl' }, `Poses on the timeline (${p.keys?.length ?? 0}) — click to jump`), bar);
  }

  private async goto(t: number) {
    try { await call('camSetTime', { t }); await this.refreshPose(); } catch (e: any) { toast(e.message, 'err'); }
  }
  private jump(dir: number) {
    const p = this.pose;
    if (!p?.keys?.length) return;
    const eps = 0.5 / p.fps;
    const nxt = dir > 0 ? p.keys.find((t) => t > p.t + eps) : [...p.keys].reverse().find((t) => t < p.t - eps);
    if (nxt !== undefined) this.goto(nxt);
  }

  private renderLayers() {
    clear(this.layerBox);
    const L = (this.scene?.layers ?? []).filter((l) => l.threeD);
    this.focusSel.innerHTML = '';
    this.focusSel.append(h('option', { value: '' }, '— pick a layer —'), ...L.map((l) => h('option', { value: l.name }, l.name)));
    if (!L.length) { this.layerBox.append(h('div', { class: 'empty' }, 'No 3D layers yet — Add camera turns them 3D.')); return; }
    for (const l of L) {
      const row = h('div', { class: 'layer-row' + (l.sel ? ' sel' : '') },
        h('div', { class: 'name' }, l.name),
        Slider({ label: 'Z', min: -3000, max: 8000, step: 5, get: () => l.pos[2], set: (v, f) => { const k = this.c.keepSize && this.scene ? (v - this.scene.cam[2]) / Math.max(1, l.pos[2] - this.scene.cam[2]) : 1; const prevZ = l.pos[2]; l.pos[2] = v; if (k !== 1) { l.scale = l.scale.map((s) => s * k); l.pos[0] = this.scene!.cam[0] + (l.pos[0] - this.scene!.cam[0]) * k; l.pos[1] = this.scene!.cam[1] + (l.pos[1] - this.scene!.cam[1]) * k; } this.draw(); if (f) call('camLayout', { items: [{ index: l.index, pos: l.pos, scale: this.c.keepSize ? l.scale : undefined }] }).catch((e) => toast(e.message, 'err')); void prevZ; } }),
        Slider({ label: 'Size %', min: 5, max: 400, step: 1, get: () => l.scale[0], set: (v, f) => { const r = v / (l.scale[0] || 100); l.scale = l.scale.map((s) => s * r); if (f) call('camLayout', { items: [{ index: l.index, pos: l.pos, scale: l.scale }] }).catch((e) => toast(e.message, 'err')); } }),
      );
      this.layerBox.appendChild(row);
    }
    refreshAll();
  }

  private move(m: MoveDef) {
    const c = this.c, k = c.strength;
    const ops = m.ops.map((o) => ({ ...o, value: o.op === 'mul' ? 1 + (o.value - 1) * k : o.op === 'add' ? o.value * k : o.value }));
    this.act('camKeys', { ops, dur: c.dur, bezier: easeById(m.ease ?? c.ease).bezier ?? [0.33, 0, 0.67, 1], physical: c.physical, marker: m.label }, `${m.label} from the playhead`);
  }
  private shake() {
    const s = SHAKES.find((x) => x.id === this.c.shake) ?? SHAKES[0];
    this.act('camShake', { pos: shakeExpr(s, 'pos'), rx: shakeExpr(s, 'rx'), ry: shakeExpr(s, 'ry'), rz: shakeExpr(s, 'rz'), amount: this.c.amount, speed: this.c.speed, seed: 1 }, `${s.label} shake`);
  }
  private async distribute() {
    await this.refresh();
    const L = (this.scene?.layers ?? []).filter((l) => l.sel);
    const use = L.length ? L : (this.scene?.layers ?? []).filter((l) => l.threeD);
    if (!use.length) { toast('No layers', 'info'); return; }
    this.act('camLayout', { items: distributeDepth(use, 'linear', this.c.near, this.c.far, this.c.keepSize, this.scene!.cam, 1) }, `Spread ${use.length} layers in depth`);
  }
  private async arrangeSel() {
    await this.refresh();
    const L = (this.scene?.layers ?? []).filter((l) => l.sel);
    if (!L.length) { toast('Select layers in AE first', 'info'); return; }
    const s = this.scene!;
    this.act('camLayout', { items: arrange(this.c.arrange, L, { spacing: this.c.spacing, radius: this.c.radius, depth: this.c.depth, center: [s.comp.w / 2, s.comp.h / 2, 0], seed: 3, face: false }) }, ARRANGES.find((a) => a.id === this.c.arrange)!.label);
  }
  private async rack() {
    await this.refresh();
    const L = (this.scene?.layers ?? []).filter((l) => l.sel);
    if (L.length < 2) { toast('Select 2+ layers in the order focus should travel', 'info'); return; }
    const t0 = this.scene!.comp.time;
    this.act('camFocus', { mode: 'rack', layers: L.map((l) => l.name), times: L.map((_, i) => t0 + i * 1.5), fstop: this.c.fstop, blur: this.c.blur, pull: 0.6 }, `Rack focus through ${L.length} layers`);
  }

  // ───────── scene view ─────────
  private drawFromPose() {
    const s = this.scene, v = this.pose?.values;
    if (!s || !v) return;
    const d = v.distance, tl = (-v.tilt * Math.PI) / 180, ob = (v.orbit * Math.PI) / 180;
    const y1 = d * Math.sin(tl), z1 = -d * Math.cos(tl);
    s.cam = [v.position[0] + z1 * Math.sin(ob), v.position[1] + y1, v.position[2] + z1 * Math.cos(ob)];
    if (s.rig) { s.rig.pos = v.position; s.rig.focal = v.focal; }
    this.draw();
  }
  private draw() {
    const cv = this.view, r = cv.getBoundingClientRect();
    if (r.width < 2) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height;
    g.clearRect(0, 0, W, H);
    const s = this.scene;
    if (!s) { g.fillStyle = 'rgba(247,247,248,.4)'; g.font = '12px Inter'; g.fillText('Open a comp in After Effects', 12, 22); return; }
    const top = this.c.view === 'top';
    const P = (p: number[]) => (top ? [p[0], p[2]] : [p[2], p[1]]);
    const pts = [...s.layers.map((l) => P(l.pos)), P(s.cam)];
    let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const pad = Math.max(250, (x1 - x0) * 0.12, (y1 - y0) * 0.12);
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    const sc = Math.min(W / (x1 - x0), H / (y1 - y0));
    const ox = (W - (x1 - x0) * sc) / 2 - x0 * sc;
    const S = (p: number[]): [number, number] => { const q = P(p); return top ? [ox + q[0] * sc, H - ((H - (y1 - y0) * sc) / 2 + (q[1] - y0) * sc)] : [ox + q[0] * sc, (H - (y1 - y0) * sc) / 2 + (q[1] - y0) * sc]; };
    for (const l of s.layers) {
      const c = S(l.pos);
      const half = (((top ? l.w : l.h) * Math.abs(l.scale[top ? 0 : 1])) / 200) * sc;
      g.strokeStyle = l.sel ? '#d1fe17' : l.threeD ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.25)';
      g.lineWidth = l.sel ? 3 : 2;
      g.beginPath(); g.moveTo(c[0] - half, c[1]); g.lineTo(c[0] + half, c[1]); g.stroke();
    }
    const cp = S(s.cam), tp = S(s.rig?.pos ?? [s.comp.w / 2, s.comp.h / 2, 0]);
    const dir = Math.atan2(tp[1] - cp[1], tp[0] - cp[0]);
    const fov = Math.atan((s.comp.w / 2) / (s.comp.w * (s.rig?.focal ?? 50) / 36));
    g.fillStyle = 'rgba(76,201,240,.13)';
    g.beginPath(); g.moveTo(cp[0], cp[1]); g.lineTo(cp[0] + Math.cos(dir - fov) * 900, cp[1] + Math.sin(dir - fov) * 900); g.lineTo(cp[0] + Math.cos(dir + fov) * 900, cp[1] + Math.sin(dir + fov) * 900); g.closePath(); g.fill();
    g.fillStyle = '#4cc9f0';
    g.beginPath(); g.arc(cp[0], cp[1], 6, 0, 7); g.fill();
    g.beginPath(); g.arc(tp[0], tp[1], 3, 0, 7); g.fill();
  }
}
