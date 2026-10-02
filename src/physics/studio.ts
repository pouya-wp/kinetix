import { h, Section, Slider, Seg, Btn, Toggle, toast, refreshAll, icon } from '../ui/kit';
import { Page, Tiles, Group } from '../core/page';
import { call, inAE } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { simplifyKeys } from '../core/math';
import { simulate, previewPieces, RECIPES, type PhysLayer, type PhysParams, type SimResult } from './sim';
import type { Studio } from '../main';

const LS = 'kinetix.physics';
const COLORS = ['#d1fe17', '#4cc9f0', '#b388ff', '#ff7ac6', '#ffb238', '#2ee59d', '#ff5a5f', '#ffffff'];

export class PhysicsStudio implements Studio {
  id = 'physics';
  el: HTMLElement;
  private p: PhysParams = { recipe: 'fall', gravity: 1, bounce: 0.35, friction: 0.4, air: 0.01, duration: 4, strength: 1, seed: 4, floor: true, walls: true, ceiling: false, floorOffset: 0, shape: 'auto', spin: true };
  private layers: PhysLayer[] = [];
  private comp = { w: 1920, h: 1080, fps: 30, time: 0 };
  private res: SimResult | null = null;
  private canvas: HTMLCanvasElement;
  private list: HTMLElement;
  private frame = 0;
  private playing = false;
  private raf = 0;
  private scrub: HTMLInputElement;

  constructor() {
    try { Object.assign(this.p, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { /* */ }
    const p = this.p;
    const save = () => { try { localStorage.setItem(LS, JSON.stringify(p)); } catch { /* */ } };
    const set = <K extends keyof PhysParams>(k: K) => (v: any, fin = true) => { (p as any)[k] = v; save(); if (fin) this.run(); };
    this.canvas = h('canvas', { style: { width: '100%', aspectRatio: '16 / 9', display: 'block', borderRadius: '14px', background: '#0a0b0c' } });
    this.list = h('div', { class: 'list' });
    this.scrub = h('input', { type: 'range', min: '0', max: '100', value: '0', style: { flex: '1', accentColor: '#d1fe17' } }) as HTMLInputElement;
    this.scrub.addEventListener('input', () => { this.playing = false; this.frame = +this.scrub.value; this.draw(); });

    const recipes = Tiles(RECIPES.map((r) => ({ id: r.id, label: r.label, sub: r.sub })), {
      onPick: (x) => { const r = RECIPES.find((q) => q.id === x.id)!; Object.assign(p, { floor: true, walls: true, ceiling: false }, r.set ?? {}, { recipe: r.id }); save(); recipes.refresh(); refreshAll(); this.run(true); },
      isOn: (x) => x.id === p.recipe, min: 132,
    });
    const playBtn = h('button', { class: 'play', title: 'Play / pause' }, icon('play'));
    playBtn.addEventListener('click', () => { this.playing = !this.playing; if (this.playing && this.res && this.frame >= this.res.frames.length - 1) this.frame = 0; this.loop(); });

    const side = [
      Section('Layers', [
        Btn('Import selected layers', () => this.importLayers(), { variant: 'primary', block: true, icon: 'import' }),
        this.list,
        Seg([{ value: 'auto', label: 'Exact shape' }, { value: 'box', label: 'Boxes' }, { value: 'circle', label: 'Circles' }], () => p.shape, (v) => set('shape')(v)),
        h('div', { class: 'hint' }, 'Shape layers collide with their exact outline — concave and custom paths too — and morphing shapes keep colliding correctly as their path changes. Text and footage use their bounds.'),
      ], { color: 'var(--lime)' }),
    ];
    const main = [
      h('div', { class: 'panel-card' },
        this.canvas,
        h('div', { class: 'hstack' }, playBtn, this.scrub),
        h('div', { class: 'row' },
          Btn('Simulate', () => this.run(true), { icon: 'sync' }),
          Btn('Bake to keyframes', () => this.bake(), { variant: 'primary', icon: 'send' })),
        h('div', { class: 'hint' }, 'Baking writes Position + Rotation keyframes starting at the playhead, plus “KX:hit” markers at every collision for Auto-SFX.')),
      Group('Recipes', [recipes.el]),
    ];
    const right = [
      Section('Physics', [
        Slider({ label: 'Gravity', min: -2, max: 3, step: 0.05, get: () => p.gravity, set: (v, f) => set('gravity')(v, f) }),
        Slider({ label: 'Bounciness', min: 0, max: 1.1, step: 0.01, get: () => p.bounce, set: (v, f) => set('bounce')(v, f) }),
        Slider({ label: 'Friction', min: 0, max: 1, step: 0.01, get: () => p.friction, set: (v, f) => set('friction')(v, f) }),
        Slider({ label: 'Air drag', min: 0, max: 0.2, step: 0.002, get: () => p.air, set: (v, f) => set('air')(v, f) }),
        Slider({ label: 'Strength', min: 0.1, max: 4, step: 0.05, get: () => p.strength, set: (v, f) => set('strength')(v, f) }),
        Slider({ label: 'Duration (s)', min: 0.5, max: 20, step: 0.1, get: () => p.duration, set: (v, f) => set('duration')(v, f) }),
        Slider({ label: 'Seed', min: 1, max: 999, get: () => p.seed, set: (v, f) => set('seed')(v, f) }),
        Toggle('Random spin', () => p.spin, (v) => set('spin')(v)),
      ], { color: 'var(--lime)' }),
      Section('World', [
        Toggle('Floor', () => p.floor, (v) => set('floor')(v)),
        Slider({ label: 'Floor raise (px)', min: 0, max: 800, get: () => p.floorOffset, set: (v, f) => set('floorOffset')(v, f) }),
        Toggle('Side walls', () => p.walls, (v) => set('walls')(v)),
        Toggle('Ceiling', () => p.ceiling, (v) => set('ceiling')(v)),
      ], { color: 'var(--info)' }),
    ];
    this.el = Page({ title: 'Physics', sub: 'Real rigid-body physics for any layer — pick a recipe, preview, bake. That simple.', side, main, right }).el;
    registerCommands(RECIPES.map((r) => ({ id: 'phys.' + r.id, label: 'Physics: ' + r.label, group: 'Physics', run: () => { Object.assign(p, r.set ?? {}, { recipe: r.id }); this.importLayers().then(() => this.bake()); } })));
    if (!inAE) this.demo();
  }

  activate() { this.draw(); }
  deactivate() { this.playing = false; }

  private demo() {
    const L: PhysLayer[] = [];
    const sizes = [[260, 260], [180, 180], [420, 120], [140, 140]];
    sizes.forEach(([w, hh], i) => L.push({ index: i + 1, name: ['Logo', 'Ball', 'Title', 'Dot'][i], cx: 420 + i * 200, cy: 200 + (i % 3) * 120, w, h: hh, rot: (i % 2) * 15, offX: 0, offY: 0, pos: [420 + i * 200, 200 + (i % 3) * 120], kind: i === 1 || i === 3 ? 'shape' : 'footage' }));
    // concave custom shapes (exact outlines) — an L, a star and a shape that morphs star → circle
    const star = (r1: number, r2: number, n: number) => Array.from({ length: n * 2 }, (_, k) => { const a = -Math.PI / 2 + (k / (n * 2)) * Math.PI * 2, r = k % 2 ? r2 : r1; return [Math.cos(a) * r, Math.sin(a) * r]; });
    const circle = (r: number) => Array.from({ length: 40 }, (_, k) => [Math.cos((k / 40) * Math.PI * 2) * r, Math.sin((k / 40) * Math.PI * 2) * r]);
    const lshape = [[-110, -110], [-30, -110], [-30, 50], [110, 50], [110, 110], [-110, 110]];
    const morph = Array.from({ length: 121 }, (_, f) => { const u = Math.min(1, f / 60), A = star(120, 50, 5), C = circle(95); const s2 = A.map((q, k) => { const c = C[Math.round((k / A.length) * C.length) % C.length]; return [q[0] + (c[0] - q[0]) * u, q[1] + (c[1] - q[1]) * u]; }); return [s2]; });
    const ex = (name: string, x: number, y: number, frames: number[][][][], morphing = false): PhysLayer => ({ index: L.length + 1, name, cx: x, cy: y, w: 240, h: 240, rot: 0, offX: 0, offY: 0, pos: [x, y], kind: 'shape', outlines: frames, anchor: [0, 0], scale: [100, 100], morphing });
    L.push(ex('L-shape', 1300, 220, [[lshape]]), ex('Star', 1550, 160, [[star(130, 55, 5)]]), ex('Star→Circle', 1020, 120, morph, true));
    this.layers = L;
    this.renderList();
    this.run();
  }

  private async importLayers() {
    try {
      const r = await call<{ comp: { w: number; h: number; fps: number; time: number }; layers: PhysLayer[] }>('physScene2', { duration: this.p.duration });
      if (!r.layers.length) { toast('Select some layers first', 'info'); return; }
      this.comp = r.comp;
      this.layers = r.layers;
      this.renderList();
      this.run(true);
      toast(`Imported ${r.layers.length} layer(s)` + (r.layers.some((l) => l.morphing) ? ' · morphing outlines tracked' : ''));
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }

  private renderList() {
    this.list.innerHTML = '';
    this.layers.forEach((l, i) => this.list.appendChild(h('div', { class: 'item' }, h('span', { class: 'sw-dot', style: { background: COLORS[i % COLORS.length] } }), h('span', { class: 'name' }, l.name), h('span', { class: 'meta' }, l.morphing ? 'morph' : l.outlines ? 'exact' : `${Math.round(l.w)}×${Math.round(l.h)}`))));
    if (!this.layers.length) this.list.appendChild(h('div', { class: 'empty' }, 'No layers imported'));
  }

  private run(play = false) {
    if (!this.layers.length) return;
    const t = performance.now();
    this.res = simulate(this.layers, this.p, this.comp);
    this.scrub.max = String(this.res.frames.length - 1);
    this.frame = 0;
    if (performance.now() - t > 400) toast('Heavy scene — preview may be slow', 'info');
    if (play) { this.playing = true; this.loop(); } else this.draw();
  }

  private loop() {
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const tick = (now: number) => {
      if (!this.playing || !this.res) { this.draw(); return; }
      if (now - last >= 1000 / this.comp.fps) { last = now; this.frame++; if (this.frame >= this.res.frames.length) { this.frame = this.res.frames.length - 1; this.playing = false; } this.scrub.value = String(this.frame); this.draw(); }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private draw() {
    const cv = this.canvas, r = cv.getBoundingClientRect();
    if (r.width < 2) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const g = cv.getContext('2d')!;
    const s = (r.width / this.comp.w) * dpr;
    g.setTransform(s, 0, 0, s, 0, 0);
    g.fillStyle = '#16181a';
    g.fillRect(0, 0, this.comp.w, this.comp.h);
    g.strokeStyle = 'rgba(255,255,255,.06)';
    g.lineWidth = 2 / s * dpr;
    for (let x = 0; x < this.comp.w; x += 120) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, this.comp.h); g.stroke(); }
    if (this.p.floor) { g.fillStyle = 'rgba(209,254,23,.15)'; g.fillRect(0, this.comp.h - this.p.floorOffset, this.comp.w, 6); }
    const fr = this.res?.frames[Math.min(this.frame, (this.res?.frames.length ?? 1) - 1)];
    this.layers.forEach((l, i) => {
      const ax = fr ? fr.x[i] : l.pos[0], ay = fr ? fr.y[i] : l.pos[1], a = fr ? fr.a[i] : (l.rot * Math.PI) / 180;
      const col = COLORS[i % COLORS.length];
      const pieces = this.p.shape === 'auto' ? previewPieces(l, this.frame, ax, ay, a) : null;
      g.fillStyle = col + 'cc';
      if (pieces) {
        g.beginPath();
        for (const pc of pieces) { pc.forEach((v, k) => (k ? g.lineTo(v.x, v.y) : g.moveTo(v.x, v.y))); g.closePath(); }
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; g.stroke();
        return;
      }
      // centre = anchor + rotated (centre - anchor) offset
      const d = a - (l.rot * Math.PI) / 180, c = Math.cos(d), sn = Math.sin(d);
      const x = ax + l.offX * c - l.offY * sn, y = ay + l.offX * sn + l.offY * c;
      g.save();
      g.translate(x, y); g.rotate(a);
      const circle = this.p.shape === 'circle' || (this.p.shape === 'auto' && Math.abs(l.w - l.h) < Math.min(l.w, l.h) * 0.12 && l.kind !== 'text');
      g.beginPath();
      if (circle) g.arc(0, 0, Math.min(l.w, l.h) / 2, 0, 7); else g.roundRect(-l.w / 2, -l.h / 2, l.w, l.h, 12);
      g.fill();
      g.fillStyle = '#111';
      g.font = '600 26px Inter';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(l.name.slice(0, 14), 0, 0);
      g.restore();
    });
  }

  private async bake() {
    if (!this.res || !this.layers.length) { toast('Import layers first', 'info'); return; }
    const { frames, hits, fps } = this.res;
    const t: number[] = frames.map((_, f) => f / fps);
    const items = this.layers.map((l, i) => {
      const pos: number[][] = [], rot: number[][] = [];
      frames.forEach((fr) => { pos.push([fr.x[i], fr.y[i]]); rot.push([(fr.a[i] * 180) / Math.PI]); });
      const pi = simplifyKeys(t, pos, [0.3, 0.3]), ri = simplifyKeys(t, rot, [0.25]);
      return { index: l.index, pos: { t: pi.map((k) => t[k]), v: pi.map((k) => pos[k]) }, rot: { t: ri.map((k) => t[k]), v: ri.map((k) => rot[k][0]) } };
    });
    try {
      const r = await call<{ layers: number }>('physBake', { items, hits: hits.map((h0) => ({ t: h0.t, index: h0.index, speed: Math.round(h0.speed), x: h0.x })) });
      toast(`Baked ${r.layers} layer(s) · ${hits.length} hits marked`);
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }
}
