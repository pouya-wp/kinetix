import { store, type ShapeItem, type ShapeKey, type BehaviorType, type MergeGroup, type PathData } from '../core/state';
import { Viewport } from '../core/viewport';
import { clock } from '../core/clock';
import { Transport } from '../core/transport';
import { SceneSection, CompSection, ViewSection, GuideSection } from '../core/common-ui';
import { h, Section, Slider, Toggle, Seg, Btn, ColorField, Swatches, TextInput, Field, Select, clear, toast, icon, refreshAll, PALETTE, Chips, modal, pickFile } from '../ui/kit';
import { tracedText, tracedImage, chain, polyPath, type Piece } from './trace';
import { ActionBar, More } from '../ui/flow';
import { CurveEditor } from '../ui/curve';
import { uid, vdist, type Vec } from '../core/math';
import { ShapeEngine, keyState, BEHAVIORS } from './engine';
import { pointInPoly, bbox, rdp, smoothPath, centrePath, flatten, type Poly } from './geometry';
import { FORMS, formPath, makeItem, makeKey, makeGroup, behavior, PRESETS, type FormId } from './library';
import { buildShapesPayload } from './export';
import { call, inAE } from '../core/ae-bridge';
import type { Studio } from '../main';

const S = () => store.state;
const SH = () => store.state.shapes;

type Tool = 'select' | 'rect' | 'rrect' | 'ellipse' | 'polygon' | 'star' | 'pen' | 'draw';
type Drag =
  | { kind: 'move'; id: string; start: Vec; x0: number; y0: number }
  | { kind: 'scale'; id: string; corner: Vec; sx0: number; sy0: number; hw: number; hh: number }
  | { kind: 'rotate'; id: string; rot0: number; a0: number }
  | { kind: 'create'; tool: Tool; a: Vec; b: Vec }
  | { kind: 'draw'; pts: Vec[] }
  | null;

export class ShapesStudio implements Studio {
  id = 'shapes';
  el: HTMLElement;
  vp: Viewport;
  engine: ShapeEngine;
  private right: HTMLElement;
  private toolbar: HTMLElement;
  private transport;
  private tool: Tool = 'select';
  private drag: Drag = null;
  private pen: { pts: Vec[]; ins: Vec[]; outs: Vec[]; dragging: boolean } | null = null;
  private sig = '';
  private active = false;
  private showMembers = true;
  private exportMode: 'auto' | 'baked' = 'auto';
  private lastScene: ReturnType<ShapeEngine['scene']> | null = null;

  constructor() {
    this.engine = new ShapeEngine(() => ({ shapes: S().shapes, comp: S().comp }));
    this.vp = new Viewport((ctx, vp) => this.draw(ctx, vp));
    this.vp.tool = {
      down: (p, e) => this.onDown(p, e),
      move: (p, e) => this.onMove(p, e),
      up: (p) => this.onUp(p),
      hover: () => {},
      dbl: () => this.finishPen(),
      cursor: () => (this.tool === 'select' ? (this.drag ? 'grabbing' : 'default') : 'crosshair'),
    };
    this.transport = Transport({ marks: () => this.marks() });
    this.toolbar = h('div', { class: 'toolbar' });
    this.right = h('div', { class: 'side right' });
    const fold = <T extends HTMLElement>(el: T) => { el.classList.add('collapsed'); return el; };
    const left = h('div', { class: 'side' },
      this.librarySection(),
      this.itemsSection(),
      h('div', { class: 'insp-slot' }),
      fold(this.groupsSection()),
      fold(SceneSection()),
      fold(CompSection({ duration: true })),
      fold(ViewSection([Toggle('Show merge members', () => this.showMembers, (v) => { this.showMembers = v; refreshAll(); this.vp.request(); })])),
      fold(GuideSection()),
      fold(this.exportSection()),
    );
    const stage = h('div', { class: 'stage' },
      h('div', { class: 'stage-top' }, this.toolbar, this.vp.zoomEl),
      this.vp.el,
      h('div', { class: 'stage-hint', style: { bottom: '68px' } }, 'Draw with the tools above · select & drag to move (auto-keys at the playhead) · corner handles scale, top handle rotates · K = add key · Pen: click/drag points, double-click to close'),
      this.transport.el,
      ActionBar({ label: 'Send to After Effects', icon: 'send', need: 'comp', run: () => this.export(this.exportOnlySel) }),
    );
    (stage.querySelector('.stage-hint') as HTMLElement).style.bottom = '128px';
    this.el = h('div', { class: 'view' }, left, stage, this.right);
    store.subscribe(() => this.onState());
    clock.on(() => { if (this.active) this.vp.request(); });
    this.buildToolbar();
    this.onState();
  }

  activate() {
    this.active = true;
    clock.fps = S().comp.fps;
    clock.setDuration(S().comp.duration);
    clock.loop = true;
    this.transport.update();
    this.transport.updateMarks();
    this.vp.resize();
  }
  deactivate() { this.active = false; this.pen = null; }

  private sel(): ShapeItem | null { return SH().items.find((i) => i.id === SH().sel) ?? null; }
  private editItem(fn: (it: ShapeItem) => void, final = true) {
    const id = SH().sel;
    store.set((s) => { const it = s.shapes.items.find((i) => i.id === id); if (it) fn(it); }, final);
  }
  private keyAt(it: ShapeItem, t: number) {
    const half = 0.5 / S().comp.fps;
    return it.keys.find((k) => Math.abs(k.t - t) < half) ?? null;
  }
  /** Key to edit at the playhead: the only key, an existing key, or a new auto-key. */
  private ensureKey(it: ShapeItem): ShapeKey {
    if (it.keys.length === 1) return it.keys[0];
    const t = clock.t;
    const ex = this.keyAt(it, t);
    if (ex) return ex;
    const ks = keyState(it, t)!;
    const prev = [...it.keys].reverse().find((k) => k.t <= t) ?? it.keys[0];
    const path = this.polyToLocalPath(ks.poly);
    const k: ShapeKey = { id: uid('k'), t, path, x: ks.x, y: ks.y, rot: ks.rot, sx: ks.sx, sy: ks.sy, ease: [...prev.ease] as any };
    it.keys.push(k);
    it.keys.sort((a, b) => a.t - b.t);
    store.state.shapes.selKey = k.id;
    return k;
  }
  private polyToLocalPath(poly: Poly): PathData {
    // the interpolated outline becomes a new key path (smooth, reduced)
    const step = Math.max(1, Math.floor(poly.length / 64));
    return smoothPath(poly.filter((_, i) => i % step === 0), true);
  }

  private onState() {
    this.engine.sync();
    const it = this.sel();
    const sig = [SH().sel, SH().selKey, it?.keys.length, it?.behaviors.map((b) => b.type + b.id).join(), it?.group, SH().items.length, SH().groups.map((g) => g.id).join()].join('|');
    if (sig !== this.sig) { this.sig = sig; this.buildInspector(); }
    if (this.active) {
      clock.setDuration(S().comp.duration);
      this.transport.updateMarks();
      this.transport.update();
    }
    refreshAll();
    this.vp.request();
  }

  private marks() {
    const it = this.sel();
    return it ? it.keys.map((k) => ({ t: k.t, kind: 'key' as const })) : [];
  }

  // ───────── toolbar ─────────
  private buildToolbar() {
    this.toolbar.innerHTML = '';
    const tools: [Tool, keyof typeof import('../ui/kit').I, string][] = [
      ['select', 'cursor', 'Select / move (V)'], ['rect', 'rect', 'Rectangle (M)'], ['rrect', 'rrect', 'Rounded rectangle'], ['ellipse', 'ellipse', 'Ellipse (E)'],
      ['polygon', 'polygon', 'Polygon'], ['star', 'star', 'Star'], ['pen', 'pen', 'Pen (P)'], ['draw', 'draw', 'Freehand (B)'],
    ];
    for (const [t, ic, title] of tools) {
      const b = h('button', { class: 'btn btn-sm' + (this.tool === t ? ' on' : ''), title }, icon(ic as any));
      b.addEventListener('click', () => this.setTool(t));
      this.toolbar.appendChild(b);
    }
    this.toolbar.append(h('div', { class: 'sep' }),
      h('button', { class: 'btn btn-sm', title: 'Add key at playhead (K)', onclick: () => this.addKey() }, icon('key')),
      h('button', { class: 'btn btn-sm', title: 'Fit view', onclick: () => this.vp.fit() }, icon('fit')),
      h('button', { class: 'btn btn-sm', title: 'Undo', onclick: () => store.undo() }, icon('undo')),
      h('button', { class: 'btn btn-sm', title: 'Redo', onclick: () => store.redo() }, icon('redo')),
    );
  }
  private setTool(t: Tool) {
    if (this.pen && t !== 'pen') this.finishPen();
    this.tool = t;
    this.buildToolbar();
    this.vp.request();
  }

  // ───────── left sections ─────────
  private itemsSection() {
    const list = h('div', { class: 'list' });
    const render = () => {
      list.innerHTML = '';
      if (!SH().items.length) list.appendChild(h('div', { class: 'empty' }, 'Draw a shape, pick one from the library, or load a preset.'));
      for (const it of [...SH().items].reverse()) {
        const g = SH().groups.find((x) => x.id === it.group);
        const row = h('div', { class: 'item' + (it.id === SH().sel ? ' sel' : '') },
          h('span', { class: 'sw-dot', style: { background: g ? g.color : it.color } }),
          h('span', { class: 'name' }, it.name),
          h('span', { class: 'meta' }, g ? '⦿ ' + g.name : `${it.keys.length}k`),
          h('button', { class: 'btn btn-sm btn-icon x', title: it.visible ? 'Hide' : 'Show', onclick: (e: Event) => { e.stopPropagation(); store.set((s) => { const x = s.shapes.items.find((q) => q.id === it.id)!; x.visible = !x.visible; }); } }, it.visible ? '◉' : '○'),
        );
        row.addEventListener('click', () => store.set((s) => { s.shapes.sel = it.id; s.shapes.selKey = null; }));
        list.appendChild(row);
      }
    };
    store.subscribe(render);
    queueMicrotask(render);
    return Section('Shapes', [
      list,
      h('div', { class: 'row3' },
        Btn('Copy', () => this.duplicate(), { icon: 'copy', size: 'sm' }),
        Btn('Up', () => this.reorder(1), { size: 'sm' }),
        Btn('', () => this.remove(), { icon: 'trash', size: 'sm', variant: 'danger', title: 'Delete shape' }),
      ),
    ], { color: 'var(--lime)' });
  }

  private librarySection() {
    const grid = h('div', { class: 'chips' }, ...FORMS.map((f) => h('button', { class: 'chip', onclick: () => this.addForm(f.id) }, f.label)));
    const presets = h('div', { class: 'chips' }, ...PRESETS.map((p) => h('button', { class: 'chip', onclick: () => this.loadPreset(p.id) }, p.label)));
    return Section('Start here', [
      h('div', { class: 'lbl' }, 'Add a shape'), grid,
      h('div', { class: 'lbl' }, 'Or start from a ready scene'), presets,
      h('div', { class: 'hint' }, 'Demo scenes replace the current shapes (undo restores them).'),
    ], { color: 'var(--violet)' });
  }

  private groupsSection() {
    const body = h('div', { class: 'stack' });
    const render = () => {
      clear(body);
      if (!SH().groups.length) body.appendChild(h('div', { class: 'hint' }, 'Shapes in the same merge group melt together like liquid when they get close.'));
      for (const g of SH().groups) {
        const gid = g.id;
        const G = () => SH().groups.find((x) => x.id === gid) ?? g;
        const set = (fn: (x: MergeGroup) => void, f = true) => store.set((s) => { const x = s.shapes.groups.find((q) => q.id === gid); if (x) fn(x); }, f);
        const members = SH().items.filter((i) => i.group === gid).length;
        body.appendChild(h('div', { class: 'stack', style: { padding: '10px', borderRadius: '12px', background: 'var(--glass)' } },
          h('div', { class: 'hstack' },
            h('span', { class: 'sw-dot', style: { width: '12px', height: '12px', borderRadius: '4px', background: g.color } }),
            h('b', { class: 'grow' }, g.name), h('span', { class: 'meta muted mono', style: { fontSize: '11px' } }, `${members} shapes`),
            Btn('', () => store.set((s) => { s.shapes.groups = s.shapes.groups.filter((x) => x.id !== gid); s.shapes.items.forEach((i) => { if (i.group === gid) i.group = null; }); }), { icon: 'x', size: 'sm', title: 'Remove group' })),
          Field('Name', TextInput({ get: () => G().name, set: (v) => set((x) => { x.name = v || x.name; }) })),
          Field('Colour', ColorField(() => G().color, (v, f) => set((x) => { x.color = v; }, f), () => store.begin())),
          Slider({ label: 'Gooeyness (px)', min: 0, max: 400, get: () => G().blend, set: (v, f) => set((x) => { x.blend = v; }, f), begin: () => store.begin(), title: 'How far apart shapes start to bridge' }),
          Slider({ label: 'Detail (px / cell)', min: 2, max: 24, step: 0.5, get: () => G().res, set: (v, f) => set((x) => { x.res = v; }, f), begin: () => store.begin(), title: 'Lower = smoother edges, slower' }),
          Slider({ label: 'Edge smoothing', min: 0, max: 8, get: () => G().smooth, set: (v, f) => set((x) => { x.smooth = v; }, f), begin: () => store.begin() }),
          Slider({ label: 'Min droplet area', min: 0, max: 5000, step: 10, get: () => G().minArea, set: (v, f) => set((x) => { x.minArea = v; }, f), begin: () => store.begin() }),
        ));
      }
    };
    let gsig = '';
    store.subscribe(() => { const s = SH().groups.map((g) => g.id + g.name + g.color).join() + SH().items.map((i) => i.group).join(); if (s !== gsig) { gsig = s; render(); } });
    queueMicrotask(render);
    return Section('Merge groups', [
      body,
      Btn('New merge group', () => store.set((s) => { const g = makeGroup(s.shapes.groups.length + 1, PALETTE[(s.shapes.groups.length + 2) % 7]); s.shapes.groups.push(g); const it = s.shapes.items.find((i) => i.id === s.shapes.sel); if (it) it.group = g.id; }), { icon: 'merge', size: 'sm', variant: 'soft', block: true }),
    ], { color: 'var(--info)' });
  }

  private exportSection() {
    const scope = { sel: false };
    return Section('Export options', [
      Field('Keyframes', Seg([{ value: 'auto', label: 'Smart', title: 'Editable path keys when possible, baked when behaviors/merge are used' }, { value: 'baked', label: 'Bake every frame' }], () => this.exportMode, (v) => { this.exportMode = v; refreshAll(); })),
      Toggle('Only the selected shape / group', () => this.exportOnlySel, (v) => { this.exportOnlySel = v; refreshAll(); }),
      h('div', { class: 'hint' }, 'Every shape (and every merge group) becomes its own shape layer — ready for your glass plugin or any effect.'),
    ], { color: 'var(--lime)' });
  }

  private async export(onlySel: boolean) {
    if (!SH().items.length) { toast('Nothing to export yet', 'info'); return; }
    const it = this.sel();
    const ids = onlySel && it ? [it.id, ...(it.group ? [it.group] : [])] : undefined;
    toast('Baking frames…', 'info', 1500);
    await new Promise((r) => setTimeout(r, 30));
    const payload = buildShapesPayload({ shapes: S().shapes, comp: S().comp }, this.exportMode, ids);
    try {
      let n = 0;
      // one call per layer keeps each ExtendScript message small
      for (let i = 0; i < payload.layers.length; i++) {
        await call('shapesExport', { comp: payload.comp, layer: payload.layers[i], index: i, total: payload.layers.length });
        n++;
      }
      const keys = payload.layers.reduce((a, l) => a + l.paths.reduce((b, p) => b + p.t.length, 0), 0);
      toast(inAE ? `Created ${n} shape layer(s) · ${keys} path keys` : `Preview mode: ${n} layer(s), ${keys} path keys built`);
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }

  // ───────── actions ─────────
  private addItem(it: ShapeItem) {
    store.set((s) => {
      const cur = s.shapes.items.find((i) => i.id === s.shapes.sel);
      if (cur?.group && s.shapes.groups.some((g) => g.id === cur.group)) it.group = null;
      s.shapes.items.push(it);
      s.shapes.sel = it.id;
      s.shapes.selKey = null;
    });
  }
  private addForm(f: FormId) {
    const c = S().comp;
    const size = Math.min(c.w, c.h) * 0.28;
    const n = SH().items.length;
    const it = makeItem(FORMS.find((x) => x.id === f)!.label, PALETTE[n % 7], formPath(f, size, size, n + 1), c.w / 2 + ((n % 5) - 2) * 40, c.h / 2);
    const sel = this.sel();
    // with a multi-key shape selected, a library click morphs it instead of adding
    if (sel && sel.keys.length > 1) {
      const bb = bbox(flatten(this.keyAtOrEnsure(sel).path, 6));
      this.editItem((x) => { const k = this.ensureKey(x); k.path = formPath(f, bb.w || size, bb.h || size, n + 1); });
      toast(`Key at ${clock.t.toFixed(2)}s morphs into ${f}`);
      return;
    }
    this.addItem(it);
  }
  private keyAtOrEnsure(it: ShapeItem) { return this.keyAt(it, clock.t) ?? it.keys[0]; }

  private addKey() {
    const it = this.sel();
    if (!it) { toast('Select a shape first', 'info'); return; }
    if (this.keyAt(it, clock.t)) { toast('There is already a key here', 'info'); return; }
    this.editItem((x) => {
      if (x.keys.length === 1 && Math.abs(x.keys[0].t - clock.t) > 1e-3) {
        const k0 = x.keys[0];
        x.keys.push({ ...structuredClone(k0), id: uid('k'), t: clock.t });
        x.keys.sort((a, b) => a.t - b.t);
        store.state.shapes.selKey = x.keys.find((k) => Math.abs(k.t - clock.t) < 1e-6)!.id;
      } else this.ensureKey(x);
    });
    toast(`Key added at ${clock.t.toFixed(2)}s — now change the shape, position or pick a form`);
  }
  private duplicate() {
    const it = this.sel();
    if (!it) return;
    const c: ShapeItem = structuredClone(it);
    c.id = uid('shp'); c.name = it.name + ' copy';
    c.keys.forEach((k) => { k.id = uid('k'); k.x += 40; k.y += 40; });
    c.behaviors.forEach((b) => (b.id = uid('bh')));
    store.set((s) => { s.shapes.items.push(c); s.shapes.sel = c.id; });
  }
  private reorder(d: number) {
    const id = SH().sel;
    store.set((s) => {
      const i = s.shapes.items.findIndex((x) => x.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= s.shapes.items.length) return;
      const [x] = s.shapes.items.splice(i, 1);
      s.shapes.items.splice(j, 0, x);
    });
  }
  private remove() {
    const id = SH().sel;
    if (!id) return;
    store.set((s) => { s.shapes.items = s.shapes.items.filter((x) => x.id !== id); s.shapes.sel = s.shapes.items[s.shapes.items.length - 1]?.id ?? null; });
  }
  private loadPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id)!;
    const c = S().comp;
    const part = p.build(c.w, c.h, c.duration);
    store.set((s) => {
      s.shapes.items = part.items ?? [];
      s.shapes.groups = part.groups ?? [];
      s.shapes.loop = part.loop ?? true;
      s.shapes.sel = s.shapes.items[0]?.id ?? null;
      s.shapes.selKey = null;
    });
    clock.seek(0);
    clock.play();
    toast(`${p.label} loaded`);
  }

  // ───────── inspector ─────────
  private buildInspector() {
    clear(this.right);
    const it = this.sel();
    if (!it) {
      this.right.append(Section('Shape', [h('div', { class: 'hint' }, 'Select or create a shape to edit its keys, morphs and behaviors.')]),
        Section('Timeline', [Toggle('Seamless loop', () => SH().loop, (v) => store.set((s) => { s.shapes.loop = v; })), h('div', { class: 'hint' }, 'Loop snaps behavior speeds so the last frame flows into the first.')]));
      return;
    }
    const I = () => this.sel() ?? it;
    this.right.append(
      Section('Colour', [
        Swatches((c) => this.editItem((x) => { x.color = c; })),
        Toggle('Gooey — melts into nearby shapes', () => !!I().group, (v) => this.toggleGoo(v)),
        More('shape-look', [
          Field('Name', TextInput({ get: () => I().name, set: (v) => this.editItem((x) => { x.name = v || x.name; }) })),
          Field('Fill', ColorField(() => I().color, (v, f) => this.editItem((x) => { x.color = v; }, f), () => store.begin())),
          h('div', { class: 'row' },
            Field('Stroke', ColorField(() => I().stroke, (v, f) => this.editItem((x) => { x.stroke = v; }, f), () => store.begin())),
            Slider({ label: 'Width', min: 0, max: 40, step: 0.5, get: () => I().strokeW, set: (v, f) => this.editItem((x) => { x.strokeW = v; }, f), begin: () => store.begin() })),
          Slider({ label: 'Opacity (%)', min: 0, max: 100, get: () => I().opacity, set: (v, f) => this.editItem((x) => { x.opacity = v; }, f), begin: () => store.begin() }),
          Field('Merge group', Select<string>([{ value: '', label: 'None' }, ...SH().groups.map((g) => ({ value: g.id, label: g.name }))], () => I().group ?? '', (v) => this.editItem((x) => { x.group = v || null; }))),
        ], 'Name, stroke, opacity, group'),
      ], { color: 'var(--lime)' }),
      this.keysSection(),
      this.behaviorsSection(),
      Section('Morph', [
        Field('Interpolation', Seg([{ value: 'center', label: 'Round' }, { value: 'linear', label: 'Linear' }, { value: 'twist', label: 'Twist' }], () => I().morph, (v) => this.editItem((x) => { x.morph = v; }))),
        Slider({ label: 'Outline points', min: 24, max: 256, step: 8, get: () => I().points, set: (v, f) => this.editItem((x) => { x.points = v; }, f), begin: () => store.begin() }),
        Toggle('Seamless loop', () => SH().loop, (v) => store.set((s) => { s.shapes.loop = v; })),
      ], { color: 'var(--text-3)', collapsed: true }),
    );
  }

  private keysSection() {
    const it = this.sel()!;
    const list = h('div', { class: 'list' });
    it.keys.forEach((k, i) => {
      const row = h('div', { class: 'item' + (k.id === SH().selKey ? ' sel' : '') },
        h('span', { class: 'sw-dot', style: { background: 'var(--lime)', transform: 'rotate(45deg) scale(.7)', borderRadius: '2px' } }),
        h('span', { class: 'name' }, `Key ${i + 1}`), h('span', { class: 'meta' }, k.t.toFixed(2) + 's'));
      row.addEventListener('click', () => { store.silent((s) => { s.shapes.selKey = k.id; }); clock.pause(); clock.seek(k.t); this.sig = ''; this.onState(); });
      list.appendChild(row);
    });
    const K = () => { const x = this.sel(); return x?.keys.find((q) => q.id === SH().selKey) ?? null; };
    const ek = (fn: (k: ShapeKey) => void, f = true) => this.editItem((x) => { const k = x.keys.find((q) => q.id === SH().selKey); if (k) fn(k); if (f) x.keys.sort((a, b) => a.t - b.t); }, f);
    const others = SH().items.filter((x) => x.id !== it.id);
    const morphInto = Select<string>([{ value: '', label: 'Morph into…' }, ...FORMS.map((f) => ({ value: 'form:' + f.id, label: '◇ ' + f.label })), ...others.map((o) => ({ value: 'item:' + o.id, label: '▣ ' + o.name }))], () => '', (v) => this.morphInto(v));
    const k = K();
    return Section('Keys & morph', [
      list,
      h('div', { class: 'row' },
        Btn('Add key', () => this.addKey(), { size: 'sm', icon: 'key', variant: 'soft' }),
        Btn('Delete key', () => {
          const kk = K();
          if (!kk || this.sel()!.keys.length < 2) { toast('A shape needs at least one key', 'info'); return; }
          this.editItem((x) => { x.keys = x.keys.filter((q) => q.id !== kk.id); });
          store.silent((s) => { s.shapes.selKey = null; });
        }, { size: 'sm', icon: 'trash' })),
      morphInto,
      h('div', { class: 'row' },
        Btn('Into text…', () => this.textDialog(), { size: 'sm', variant: 'soft' }),
        Btn('Into image…', () => this.imageDialog(), { size: 'sm', variant: 'soft' })),
      h('div', { class: 'hint' }, 'Move the playhead, then pick a form, another shape, a word or a logo: a key is created there and the outline morphs into it.'),
      k ? h('div', { class: 'stack' },
        h('div', { class: 'divider' }),
        Slider({ label: 'Key time (s)', min: 0, max: S().comp.duration, step: 0.01, get: () => K()?.t ?? 0, set: (v, f) => ek((q) => { q.t = v; }, f), begin: () => store.begin() }),
        h('div', { class: 'row' },
          Slider({ label: 'X', min: 0, max: S().comp.w, get: () => K()?.x ?? 0, set: (v, f) => ek((q) => { q.x = v; }, f), begin: () => store.begin(), hardMin: -1e5, hardMax: 1e5 }),
          Slider({ label: 'Y', min: 0, max: S().comp.h, get: () => K()?.y ?? 0, set: (v, f) => ek((q) => { q.y = v; }, f), begin: () => store.begin(), hardMin: -1e5, hardMax: 1e5 })),
        Slider({ label: 'Rotation (°)', min: -360, max: 360, get: () => K()?.rot ?? 0, set: (v, f) => ek((q) => { q.rot = v; }, f), begin: () => store.begin(), hardMin: -1e5, hardMax: 1e5 }),
        h('div', { class: 'row' },
          Slider({ label: 'Scale X', min: 0.05, max: 4, step: 0.01, get: () => K()?.sx ?? 1, set: (v, f) => ek((q) => { q.sx = v; }, f), begin: () => store.begin() }),
          Slider({ label: 'Scale Y', min: 0.05, max: 4, step: 0.01, get: () => K()?.sy ?? 1, set: (v, f) => ek((q) => { q.sy = v; }, f), begin: () => store.begin() })),
        h('div', { class: 'lbl' }, 'Ease to next key'),
        CurveEditor(() => K()?.ease ?? [0, 0, 1, 1], (e, f) => ek((q) => { q.ease = e; }, f), () => store.begin()),
        Btn('Apply this ease to all keys', () => { const e = K()?.ease; if (e) this.editItem((x) => x.keys.forEach((q) => { q.ease = [...e] as any; })); }, { size: 'sm' }),
      ) : h('div', { class: 'hint' }, 'Select a key to edit its transform and ease.'),
    ], { color: 'var(--lime)' });
  }

  private morphInto(v: string) {
    const it = this.sel();
    if (!it || !v) return;
    const [kind, id] = v.split(':');
    let path: PathData | null = null, pos: Vec | null = null;
    if (kind === 'form') {
      const cur = this.keyAtOrEnsure(it);
      const bb = bbox(flatten(cur.path, 6));
      path = formPath(id as FormId, Math.max(40, bb.w), Math.max(40, bb.h), Math.round(Math.random() * 99));
    } else {
      const o = SH().items.find((x) => x.id === id);
      if (!o) return;
      const ks = keyState(o, clock.t)!;
      // bake the other shape's scale/rotation into its outline for this key
      const r = (ks.rot * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
      const pts = ks.poly.filter((_, i) => i % Math.max(1, Math.floor(ks.poly.length / 64)) === 0).map((p) => { const x = p[0] * ks.sx, y = p[1] * ks.sy; return [x * cs - y * sn, x * sn + y * cs] as Vec; });
      path = smoothPath(pts, true);
      pos = [ks.x, ks.y];
    }
    // if the playhead sits on the first key of a single-key shape, add a new key 1s later
    if (it.keys.length === 1 && Math.abs(it.keys[0].t - clock.t) < 1e-3) clock.seek(Math.min(S().comp.duration, clock.t + 1));
    this.editItem((x) => {
      if (x.keys.length === 1 && Math.abs(x.keys[0].t - clock.t) > 1e-3) {
        x.keys.push({ ...structuredClone(x.keys[0]), id: uid('k'), t: clock.t });
        x.keys.sort((a, b) => a.t - b.t);
      }
      const k = this.ensureKey(x);
      k.path = path!;
      k.rot = 0; k.sx = 1; k.sy = 1;
      if (pos) { k.x = pos[0]; k.y = pos[1]; }
      store.state.shapes.selKey = k.id;
    });
    if (kind === 'item') {
      store.set((s) => { const o = s.shapes.items.find((x) => x.id === id); if (o) o.visible = false; });
      toast('Morph target hidden — toggle it back on in the Shapes list if needed', 'info');
    }
    this.sig = '';
    this.onState();
  }

  private exportOnlySel = false;
  /** Gooey on: join (or create) the shared merge group; off: leave it. */
  private toggleGoo(on: boolean) {
    store.set((s) => {
      const it = s.shapes.items.find((i) => i.id === s.shapes.sel);
      if (!it) return;
      if (!on) { it.group = null; return; }
      let g = s.shapes.groups[0];
      if (!g) { g = makeGroup(1, it.color); s.shapes.groups.push(g); }
      it.group = g.id;
    });
  }

  // ───────── morph into text / image ─────────
  private pieceOpts = { split: true, stagger: 0.05, text: 'Kinetix', font: 'Inter', weight: 800, height: 0, mode: 'alpha' as 'alpha' | 'dark' | 'light', thr: 0.5, size: 0 };

  private textDialog() {
    const it = this.sel();
    if (!it) return;
    const o = this.pieceOpts;
    const cur = keyState(it, clock.t)!;
    if (!o.height) o.height = Math.max(60, Math.min(260, bbox(cur.poly).h * cur.sy));
    modal((close) => h('div', { class: 'stack', style: { minWidth: '300px' } },
      h('b', null, 'Morph into text'),
      Field('Text', TextInput({ get: () => o.text, set: (v) => { o.text = v; } })),
      Field('Font', TextInput({ get: () => o.font, set: (v) => { o.font = v; }, placeholder: 'Any installed font, e.g. Montserrat' })),
      Seg([{ value: '400', label: 'Regular' }, { value: '700', label: 'Bold' }, { value: '900', label: 'Black' }], () => (o.weight >= 850 ? '900' : o.weight >= 600 ? '700' : '400'), (v) => { o.weight = +v; }),
      Slider({ label: 'Height (px)', min: 30, max: 600, get: () => o.height, set: (v) => { o.height = v; } }),
      this.pieceControls(),
      h('div', { class: 'row' }, Btn('Cancel', close, { variant: 'ghost' }), Btn('Morph', () => {
        const ps = tracedText(o.text.trim(), o.font.trim() || 'Inter', o.weight, o.height);
        if (!ps.length) { toast('Nothing to trace — type some text', 'info'); return; }
        close();
        this.morphIntoPieces(ps, o.text.trim());
      }, { variant: 'primary' }))));
  }

  private async imageDialog() {
    const it = this.sel();
    if (!it) return;
    const f = await pickFile('image/*');
    if (!f) return;
    const o = this.pieceOpts;
    const b = bbox(keyState(it, clock.t)!.poly);
    if (!o.size) o.size = Math.max(120, Math.min(600, Math.max(b.w, b.h) * 1.4));
    modal((close) => h('div', { class: 'stack', style: { minWidth: '300px' } },
      h('b', null, 'Morph into image · ' + f.name),
      h('div', { class: 'hint' }, 'Logos, icons and silhouettes work best. Transparent PNG / SVG use their alpha; photos use brightness.'),
      Seg([{ value: 'alpha', label: 'Auto / alpha' }, { value: 'dark', label: 'Dark parts' }, { value: 'light', label: 'Light parts' }], () => o.mode, (v) => { o.mode = v; }),
      Slider({ label: 'Threshold', min: 0.1, max: 0.9, step: 0.01, get: () => o.thr, set: (v) => { o.thr = v; } }),
      Slider({ label: 'Size (px)', min: 40, max: 1600, get: () => o.size, set: (v) => { o.size = v; } }),
      this.pieceControls(),
      h('div', { class: 'row' }, Btn('Cancel', close, { variant: 'ghost' }), Btn('Morph', async () => {
        try {
          const ps = await tracedImage(f, o.size, o.mode, o.thr);
          if (!ps.length) { toast('No outline found — try the other mode or threshold', 'info'); return; }
          close();
          this.morphIntoPieces(ps, f.name.replace(/\.[^.]+$/, ''));
        } catch (e: any) { toast(e.message, 'err'); }
      }, { variant: 'primary' }))));
  }

  private pieceControls() {
    const o = this.pieceOpts;
    return h('div', { class: 'stack' },
      Seg([{ value: 'split', label: 'Split into pieces' }, { value: 'one', label: 'One shape' }], () => (o.split ? 'split' : 'one'), (v) => { o.split = v === 'split'; refreshAll(); }),
      Slider({ label: 'Cascade (s per piece)', min: 0, max: 0.3, step: 0.01, get: () => o.stagger, set: (v) => { o.stagger = v; } }),
      h('div', { class: 'hint' }, 'Split: the shape breaks into one blob per letter / part (put it in a merge group for a gooey split). One shape: a single outline flows into the whole word.'));
  }

  /** The selected shape morphs into traced pieces, centred on its current position. */
  private morphIntoPieces(ps: Piece[], label: string) {
    const it = this.sel();
    if (!it) return;
    if (it.keys.length === 1 && Math.abs(it.keys[0].t - clock.t) < 1e-3) clock.seek(Math.min(S().comp.duration, clock.t + 1));
    const t = clock.t, o = this.pieceOpts;
    const ks = keyState(it, t)!;
    const one = !o.split || ps.length === 1;
    const own: Piece = one
      ? { poly: ps.length > 1 ? chain(ps.map((p) => p.poly)) : ps[0].poly, cx: 0, cy: 0, area: 0 }
      : ps.reduce((a, b) => (b.area > a.area ? b : a));
    const order = [...ps].sort((a, b) => a.cx - b.cx);
    store.set((s) => {
      const x = s.shapes.items.find((q) => q.id === it.id)!;
      if (x.keys.length === 1 && Math.abs(x.keys[0].t - t) > 1e-3) { x.keys.push({ ...structuredClone(x.keys[0]), id: uid('k'), t }); x.keys.sort((a, b) => a.t - b.t); }
      const base = structuredClone(x);
      const setKey = (item: ShapeItem, p: Piece, at: number) => {
        // keys after the morph point belong to the old animation
        const prevKeys = item.keys.filter((k) => k.t < at - 1e-3);
        const prev = prevKeys[prevKeys.length - 1];
        item.keys = prevKeys;
        item.keys.push({ id: uid('k'), t: at, path: polyPath(p.poly, p.cx, p.cy), x: ks.x + p.cx, y: ks.y + p.cy, rot: 0, sx: 1, sy: 1, ease: prev ? ([...prev.ease] as any) : [0.5, 0, 0.2, 1] });
        item.points = Math.max(item.points, Math.min(720, Math.round(p.poly.length * 1.3)));
      };
      setKey(x, own, t + (one ? 0 : order.indexOf(own)) * o.stagger);
      if (!one) {
        let n = 0;
        for (const p of order) {
          if (p === own) continue;
          const c: ShapeItem = structuredClone(base);
          c.id = uid('it');
          c.name = `${x.name} · ${label} ${++n}`;
          c.keys.forEach((k) => { k.id = uid('k'); });
          setKey(c, p, t + order.indexOf(p) * o.stagger);
          s.shapes.items.push(c);
        }
      }
      s.shapes.selKey = null;
    });
    toast(one ? `Morphs into “${label}”` : `Splits into ${ps.length} pieces of “${label}”` + (it.group ? '' : ' — put them in a merge group for a gooey split'));
    this.sig = '';
    this.onState();
  }

  private behaviorsSection() {
    const it = this.sel()!;
    const types = Object.keys(BEHAVIORS) as BehaviorType[];
    const add = h('div', { class: 'chips' }, ...types.map((t) => h('button', { class: 'chip', onclick: () => this.editItem((x) => { x.behaviors.push(behavior(t, t === 'melt' ? { start: Math.round(clock.t * 10) / 10 } : {})); if (t === 'melt') x.points = Math.max(x.points, 200); }) }, '+ ' + BEHAVIORS[t].label)));
    const cards = it.behaviors.map((b) => {
      const bid = b.id;
      const B = () => this.sel()?.behaviors.find((x) => x.id === bid) ?? b;
      const set = (fn: (x: typeof b) => void, f = true) => this.editItem((x) => { const q = x.behaviors.find((y) => y.id === bid); if (q) fn(q); }, f);
      const def = BEHAVIORS[b.type];
      return h('div', { class: 'stack', style: { padding: '10px', borderRadius: '12px', background: 'var(--glass)' } },
        h('div', { class: 'hstack' },
          h('b', { class: 'grow' }, def.label),
          Toggle('', () => B().on, (v) => set((x) => { x.on = v; })),
          Btn('', () => this.editItem((x) => { x.behaviors = x.behaviors.filter((y) => y.id !== bid); }), { icon: 'x', size: 'sm' })),
        ...Object.entries(def.params).map(([k, [, min, max, step, label]]) =>
          Slider({ label, min, max, step, get: () => B().p[k] ?? 0, set: (v, f) => set((x) => { x.p[k] = v; }, f), begin: () => store.begin() })),
      );
    });
    return Section('Auto animation', [
      ...cards,
      cards.length ? null : h('div', { class: 'hint' }, 'Stack behaviors to animate automatically — no keyframes needed.'),
      add,
    ], { color: 'var(--violet)' });
  }

  // ───────── canvas interaction ─────────
  private hitItem(p: Vec): ShapeItem | null {
    const sc = this.lastScene ?? this.engine.scene(clock.t);
    const items = SH().items;
    for (let i = items.length - 1; i >= 0; i--) {
      const poly = sc.items.get(items[i].id);
      if (poly && pointInPoly(p, poly)) return items[i];
    }
    return null;
  }

  private handles(it: ShapeItem) {
    const ks = keyState(it, clock.t);
    if (!ks) return null;
    const b = bbox(ks.poly);
    const hw = Math.max(Math.abs(b.x0), Math.abs(b.x1)), hh = Math.max(Math.abs(b.y0), Math.abs(b.y1));
    const r = (ks.rot * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    const T = (lx: number, ly: number): Vec => { const x = lx * ks.sx, y = ly * ks.sy; return [ks.x + x * cs - y * sn, ks.y + x * sn + y * cs]; };
    const corners: Vec[] = [T(-hw, -hh), T(hw, -hh), T(hw, hh), T(-hw, hh)];
    const rotH = T(0, -hh - this.vp.px(28) / Math.max(0.05, Math.abs(ks.sy)));
    return { ks, hw, hh, corners, rotH, T };
  }

  private onDown(p: Vec, e: PointerEvent) {
    clock.pause();
    if (this.tool === 'pen') { this.penDown(p); return; }
    if (this.tool === 'draw') { this.drag = { kind: 'draw', pts: [p] }; return; }
    if (this.tool !== 'select') { this.drag = { kind: 'create', tool: this.tool, a: p, b: p }; return; }
    const sel = this.sel();
    if (sel) {
      const hd = this.handles(sel);
      if (hd) {
        const tol = this.vp.px(9);
        if (vdist(p, hd.rotH) < tol) {
          store.begin();
          this.drag = { kind: 'rotate', id: sel.id, rot0: hd.ks.rot, a0: Math.atan2(p[1] - hd.ks.y, p[0] - hd.ks.x) };
          return;
        }
        for (const c of hd.corners) {
          if (vdist(p, c) < tol) {
            store.begin();
            this.drag = { kind: 'scale', id: sel.id, corner: c, sx0: hd.ks.sx, sy0: hd.ks.sy, hw: hd.hw, hh: hd.hh };
            return;
          }
        }
      }
    }
    const hit = this.hitItem(p);
    if (!hit) { store.set((s) => { s.shapes.sel = null; s.shapes.selKey = null; }); return; }
    if (hit.id !== SH().sel) store.silent((s) => { s.shapes.sel = hit.id; s.shapes.selKey = null; });
    const ks = keyState(hit, clock.t)!;
    store.begin();
    this.drag = { kind: 'move', id: hit.id, start: p, x0: ks.x, y0: ks.y };
    void e;
  }

  private onMove(p: Vec, e: PointerEvent) {
    const d = this.drag;
    if (this.pen?.dragging) {
      const pen = this.pen;
      const i = pen.pts.length - 1;
      const a = pen.pts[i];
      pen.outs[i] = [p[0] - a[0], p[1] - a[1]];
      pen.ins[i] = [a[0] - p[0], a[1] - p[1]];
      return;
    }
    if (!d) return;
    switch (d.kind) {
      case 'create': d.b = p; break;
      case 'draw': if (vdist(p, d.pts[d.pts.length - 1]) > this.vp.px(3)) d.pts.push(p); break;
      case 'move': {
        let dx = p[0] - d.start[0], dy = p[1] - d.start[1];
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        this.editItem((x) => { const k = this.ensureKey(x); k.x = d.x0 + dx; k.y = d.y0 + dy; }, false);
        break;
      }
      case 'scale': {
        this.editItem((x) => {
          const k = this.ensureKey(x);
          const r = (-k.rot * Math.PI) / 180;
          const lx = (p[0] - k.x) * Math.cos(r) - (p[1] - k.y) * Math.sin(r);
          const ly = (p[0] - k.x) * Math.sin(r) + (p[1] - k.y) * Math.cos(r);
          let sx = Math.max(0.02, Math.abs(lx) / Math.max(1, d.hw)), sy = Math.max(0.02, Math.abs(ly) / Math.max(1, d.hh));
          if (e.shiftKey) { const m = Math.max(sx / d.sx0, sy / d.sy0); sx = d.sx0 * m; sy = d.sy0 * m; }
          k.sx = +sx.toFixed(4); k.sy = +sy.toFixed(4);
        }, false);
        break;
      }
      case 'rotate': {
        this.editItem((x) => {
          const k = this.ensureKey(x);
          const a = Math.atan2(p[1] - k.y, p[0] - k.x);
          let rot = d.rot0 + ((a - d.a0) * 180) / Math.PI;
          if (e.shiftKey) rot = Math.round(rot / 15) * 15;
          k.rot = +rot.toFixed(2);
        }, false);
        break;
      }
    }
  }

  private onUp(p: Vec) {
    const d = this.drag;
    this.drag = null;
    if (this.pen?.dragging) { this.pen.dragging = false; return; }
    if (!d) return;
    if (d.kind === 'create') this.createFromBox(d.tool, d.a, p);
    else if (d.kind === 'draw') this.createFromStroke(d.pts);
    else { store.commit(); store.emit('drag-end'); }
  }

  private createFromBox(tool: Tool, a: Vec, b: Vec) {
    let w = Math.abs(b[0] - a[0]), hgt = Math.abs(b[1] - a[1]);
    const ev = window.event as PointerEvent | undefined;
    if (ev?.shiftKey) w = hgt = Math.max(w, hgt);
    if (w < 6 && hgt < 6) { w = hgt = 200; }
    const cx = Math.min(a[0], b[0]) + w / 2, cy = Math.min(a[1], b[1]) + hgt / 2;
    const map: Record<string, FormId> = { rect: 'square', rrect: 'rounded', ellipse: 'circle', polygon: 'pentagon', star: 'star' };
    const f = map[tool];
    const path = tool === 'rect' || tool === 'rrect' || tool === 'ellipse' ? formPath(f, w, hgt) : scalePath(formPath(f, 200, 200), w / 200, hgt / 200);
    const n = SH().items.length;
    this.addItem(makeItem(FORMS.find((x) => x.id === f)!.label + ' ' + (n + 1), PALETTE[n % 7], path, cx, cy));
    this.setTool('select');
  }

  private createFromStroke(pts: Vec[]) {
    if (pts.length < 4) return;
    const simp = rdp(pts, this.vp.px(2.5));
    const path = smoothPath(simp.length > 3 ? simp : pts, true);
    const { path: centred, cx, cy } = centrePath(path);
    const n = SH().items.length;
    this.addItem(makeItem('Drawing ' + (n + 1), PALETTE[n % 7], centred, cx, cy));
  }

  private penDown(p: Vec) {
    if (!this.pen) this.pen = { pts: [], ins: [], outs: [], dragging: false };
    const pen = this.pen;
    if (pen.pts.length > 2 && vdist(p, pen.pts[0]) < this.vp.px(10)) { this.finishPen(); return; }
    pen.pts.push(p);
    pen.ins.push([0, 0]);
    pen.outs.push([0, 0]);
    pen.dragging = true;
  }

  private finishPen() {
    const pen = this.pen;
    this.pen = null;
    if (!pen || pen.pts.length < 3) { this.vp.request(); return; }
    const path: PathData = { v: pen.pts.map((q) => [...q] as Vec), i: pen.ins, o: pen.outs, closed: true };
    const { path: centred, cx, cy } = centrePath(path);
    const n = SH().items.length;
    this.addItem(makeItem('Path ' + (n + 1), PALETTE[n % 7], centred, cx, cy));
  }

  onKey(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 'd') { this.duplicate(); return true; }
      return false;
    }
    if (this.pen && (e.key === 'Enter')) { this.finishPen(); return true; }
    if (e.key === 'Escape') { this.pen = null; this.setTool('select'); return true; }
    if (k === 'k') { this.addKey(); return true; }
    if (k === 'v') { this.setTool('select'); return true; }
    if (k === 'm') { this.setTool('rect'); return true; }
    if (k === 'e') { this.setTool('ellipse'); return true; }
    if (k === 'p') { this.setTool('pen'); return true; }
    if (k === 'b') { this.setTool('draw'); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const it = this.sel();
      const kk = it?.keys.find((q) => q.id === SH().selKey);
      if (it && kk && it.keys.length > 1) { this.editItem((x) => { x.keys = x.keys.filter((q) => q.id !== kk.id); }); store.silent((s) => { s.shapes.selKey = null; }); }
      else this.remove();
      return true;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.shiftKey) {
      const ts = this.marks().map((m) => m.t);
      const nxt = e.key === 'ArrowRight' ? ts.find((t) => t > clock.t + 1e-4) : [...ts].reverse().find((t) => t < clock.t - 1e-4);
      clock.pause();
      if (nxt != null) clock.seek(nxt);
      return true;
    }
    return false;
  }

  // ───────── drawing ─────────
  private draw(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const px = (n: number) => vp.px(n);
    const sc = this.engine.scene(clock.t);
    this.lastScene = sc;
    const items = SH().items;
    const sel = this.sel();
    const fillPoly = (poly: Poly) => { ctx.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]); ctx.closePath(); };

    // merged groups (drawn at the position of their first member)
    const drawnGroups = new Set<string>();
    for (const it of items) {
      if (!it.visible) continue;
      if (it.group && SH().groups.some((g) => g.id === it.group)) {
        if (drawnGroups.has(it.group)) continue;
        drawnGroups.add(it.group);
        const g = SH().groups.find((x) => x.id === it.group)!;
        const loops = sc.groups.get(g.id) ?? [];
        if (!loops.length) continue;
        ctx.save();
        ctx.fillStyle = g.color;
        ctx.shadowColor = g.color + '66';
        ctx.shadowBlur = px(30);
        ctx.beginPath();
        loops.forEach(fillPoly);
        ctx.fill('nonzero');
        ctx.restore();
        continue;
      }
      const poly = sc.items.get(it.id);
      if (!poly) continue;
      ctx.save();
      ctx.globalAlpha = it.opacity / 100;
      ctx.beginPath();
      const trail = sc.trails.get(it.id);
      if (trail?.length) trail.forEach(fillPoly); else fillPoly(poly);
      ctx.fillStyle = it.color;
      ctx.fill('nonzero');
      if (it.strokeW > 0) { ctx.strokeStyle = it.stroke; ctx.lineWidth = it.strokeW; ctx.lineJoin = 'round'; ctx.stroke(); }
      ctx.restore();
    }
    // member ghosts
    if (this.showMembers) {
      ctx.setLineDash([px(4), px(4)]);
      ctx.lineWidth = px(1);
      for (const it of items) {
        if (!it.visible || !it.group) continue;
        const poly = sc.items.get(it.id);
        if (!poly) continue;
        ctx.strokeStyle = it.id === sel?.id ? 'rgba(209,254,23,.9)' : 'rgba(255,255,255,.28)';
        ctx.beginPath(); fillPoly(poly); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // selection
    if (sel && sel.visible) {
      const poly = sc.items.get(sel.id);
      if (poly) {
        ctx.strokeStyle = '#d1fe17';
        ctx.lineWidth = px(1.5);
        ctx.beginPath(); fillPoly(poly); ctx.stroke();
      }
      // motion path through keys
      if (sel.keys.length > 1) {
        ctx.strokeStyle = 'rgba(209,254,23,.35)';
        ctx.setLineDash([px(2), px(4)]);
        ctx.beginPath();
        const D = S().comp.duration;
        for (let i = 0; i <= 120; i++) {
          const ks = keyState(sel, (i / 120) * D)!;
          if (i === 0) ctx.moveTo(ks.x, ks.y); else ctx.lineTo(ks.x, ks.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        for (const k of sel.keys) {
          ctx.save();
          ctx.translate(k.x, k.y);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = k.id === SH().selKey ? '#d1fe17' : '#fff';
          const s = px(4);
          ctx.fillRect(-s, -s, s * 2, s * 2);
          ctx.restore();
        }
      }
      const hd = this.handles(sel);
      if (hd && this.tool === 'select') {
        ctx.strokeStyle = 'rgba(255,255,255,.5)';
        ctx.lineWidth = px(1);
        ctx.beginPath();
        hd.corners.forEach((c, i) => (i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1])));
        ctx.closePath();
        ctx.stroke();
        const top = hd.T(0, -hd.hh);
        ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(hd.rotH[0], hd.rotH[1]); ctx.stroke();
        for (const c of hd.corners) { ctx.fillStyle = '#fff'; ctx.fillRect(c[0] - px(4), c[1] - px(4), px(8), px(8)); }
        ctx.fillStyle = '#d1fe17';
        ctx.beginPath(); ctx.arc(hd.rotH[0], hd.rotH[1], px(5), 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(hd.ks.x, hd.ks.y, px(3), 0, 7); ctx.fill();
      }
    }

    // tool previews
    const d = this.drag;
    ctx.strokeStyle = '#d1fe17';
    ctx.lineWidth = px(1.5);
    if (d?.kind === 'create') {
      ctx.setLineDash([px(4), px(3)]);
      ctx.strokeRect(Math.min(d.a[0], d.b[0]), Math.min(d.a[1], d.b[1]), Math.abs(d.b[0] - d.a[0]), Math.abs(d.b[1] - d.a[1]));
      ctx.setLineDash([]);
    }
    if (d?.kind === 'draw') {
      ctx.beginPath();
      d.pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      ctx.stroke();
    }
    if (this.pen) {
      const pen = this.pen;
      ctx.beginPath();
      pen.pts.forEach((q, i) => {
        if (!i) { ctx.moveTo(q[0], q[1]); return; }
        const a = pen.pts[i - 1];
        ctx.bezierCurveTo(a[0] + pen.outs[i - 1][0], a[1] + pen.outs[i - 1][1], q[0] + pen.ins[i][0], q[1] + pen.ins[i][1], q[0], q[1]);
      });
      const hov = vp.hoverWorld;
      if (hov && pen.pts.length) ctx.lineTo(hov[0], hov[1]);
      ctx.stroke();
      pen.pts.forEach((q, i) => {
        ctx.fillStyle = i === 0 ? '#d1fe17' : '#fff';
        ctx.fillRect(q[0] - px(3.5), q[1] - px(3.5), px(7), px(7));
      });
    }
  }
}

function scalePath(p: PathData, sx: number, sy: number): PathData {
  const S2 = (v: Vec): Vec => [v[0] * sx, v[1] * sy];
  return { v: p.v.map(S2), i: p.i.map(S2), o: p.o.map(S2), closed: p.closed };
}
