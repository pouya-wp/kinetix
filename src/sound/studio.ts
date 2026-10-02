import { h, Section, Slider, Seg, Btn, Toggle, toast, refreshAll, clear, Chips } from '../ui/kit';
import { Page, Group } from '../core/page';
import { call, inAE, nodeRequire } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { render, toWav, presetBank, drawWave, CATEGORIES, GENERATORS, isPitched, type SoundParams, type Preset } from './synth';
import { analyze, PACKS, sizePitch, tunedPitches, thin, type SampleSet, type SfxEvent, type Pack, type Kind } from './analyze';
import { rng } from '../core/math';
import type { Studio } from '../main';

const LS = 'kinetix.sound';
const KIND_LABEL: Record<Kind, string> = { appear: 'appear', vanish: 'disappear', pop: 'scale pop', shrink: 'shrink', move: 'move', land: 'landing', bounce: 'bounce', spin: 'spin', type: 'typing', morph: 'morph', hit: 'hit', contact: 'contact', cam: 'camera', in: 'cut in', out: 'cut out' };

export class SoundStudio implements Studio {
  id = 'sound';
  el: HTMLElement;
  private bank = presetBank();
  private cat = 'Pops & Bloops';
  private q = '';
  private sel: Preset = this.bank[0];
  private p: SoundParams = { ...this.bank[0].p };
  private grid: HTMLElement;
  private wave: HTMLCanvasElement;
  private ac: AudioContext | null = null;
  private a = { pack: 'tickle', tuned: true, density: 'normal' as 'sparse' | 'normal' | 'rich', motion: true, text: true, morph: true, markers: true, cuts: true, volume: 0, scope: 'all' as 'all' | 'selected', workArea: false };
  private found: SfxEvent[] = [];
  private foundBox: HTMLElement;
  private favs = new Set<string>(JSON.parse(localStorage.getItem('kinetix.sfx.favs') || '[]'));
  private renderCache = new Map<string, AudioBuffer>();

  constructor() {
    try { Object.assign(this.a, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { /* */ }
    const a = this.a;
    const save = () => { try { localStorage.setItem(LS, JSON.stringify(a)); } catch { /* */ } };
    this.grid = h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } });
    this.wave = h('canvas', { style: { width: '100%', height: '90px', display: 'block', borderRadius: '12px', background: 'var(--bg-deep)' } });
    this.foundBox = h('div', { class: 'stack' });
    const search = h('input', { class: 'input', placeholder: `Search ${this.bank.length} sounds…`, style: { fontFamily: 'var(--font-ui)' } }) as HTMLInputElement;
    search.addEventListener('keydown', (e) => e.stopPropagation());
    search.addEventListener('input', () => { this.q = search.value.toLowerCase(); this.renderGrid(); });
    const sp = (k: keyof SoundParams, label: string, min: number, max: number, step: number) => Slider({ label, min, max, step, get: () => this.p[k] as number, set: (v, f) => { (this.p as any)[k] = v; if (f) this.play(); } });

    // ── style explorer
    const styles = h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' } });
    const drawStyles = () => {
      clear(styles);
      for (const pk of PACKS) {
        const t = h('div', { class: 'tile' + (pk.id === a.pack ? ' on' : '') },
          h('div', { class: 'tile-label', style: { fontSize: '14px' } }, pk.label),
          h('div', { class: 'tile-sub' }, pk.sub),
          h('div', { class: 'row', style: { marginTop: '4px' } },
            Btn('▶ Listen', (e) => { e.stopPropagation(); this.demo(pk); }, { size: 'sm', variant: 'soft' }),
            Btn(pk.id === a.pack ? '✓ Using' : 'Use', (e) => { e.stopPropagation(); a.pack = pk.id; a.tuned = pk.tuned; save(); drawStyles(); refreshAll(); }, { size: 'sm' })));
        t.addEventListener('click', () => this.demo(pk));
        styles.appendChild(t);
      }
    };
    drawStyles();

    const side = [
      Section('Library', [
        search,
        Chips(['All', 'Favorites', ...CATEGORIES].map((c) => ({ value: c, label: c })), () => this.cat, (v) => { this.cat = v; this.renderGrid(); refreshAll(); }),
        h('div', { class: 'hint' }, 'Every sound is synthesised by Kinetix (royalty-free). Randomize gives endless new takes.'),
      ], { color: 'var(--lime)' }),
    ];
    const main = [
      Group('Style explorer — listen and pick your sound', [styles]),
      Group('Auto-SFX', [h('div', { class: 'panel-card' },
        h('div', { class: 'hint' }, 'Analyses every animated layer frame by frame — moves, landings, bounces, pops, fades, spins, typing, shape morphs, cuts and Kinetix events — and scores it with the chosen style. Small things sound higher, sounds pan to where they happen.'),
        h('div', { class: 'row3' },
          Toggle('Motion', () => a.motion, (v) => { a.motion = v; save(); refreshAll(); }),
          Toggle('Typing', () => a.text, (v) => { a.text = v; save(); refreshAll(); }),
          Toggle('Shape morphs', () => a.morph, (v) => { a.morph = v; save(); refreshAll(); })),
        h('div', { class: 'row3' },
          Toggle('Kinetix events', () => a.markers, (v) => { a.markers = v; save(); refreshAll(); }),
          Toggle('Layer cuts', () => a.cuts, (v) => { a.cuts = v; save(); refreshAll(); }),
          Toggle('Melodic (tuned)', () => a.tuned, (v) => { a.tuned = v; save(); refreshAll(); })),
        h('div', { class: 'row' },
          Seg([{ value: 'sparse', label: 'Sparse' }, { value: 'normal', label: 'Normal' }, { value: 'rich', label: 'Rich' }], () => a.density, (v) => { a.density = v; save(); refreshAll(); }),
          Seg([{ value: 'all', label: 'Whole comp' }, { value: 'selected', label: 'Selected' }], () => a.scope, (v) => { a.scope = v; save(); refreshAll(); })),
        h('div', { class: 'row' },
          Slider({ label: 'Mix level (dB)', min: -24, max: 6, get: () => a.volume, set: (v) => { a.volume = v; save(); } }),
          Toggle('Work area only', () => a.workArea, (v) => { a.workArea = v; save(); refreshAll(); })),
        h('div', { class: 'row' },
          Btn('Analyze', () => this.scan(), { icon: 'search' }),
          Btn('Analyze & place sounds', () => this.autoSfx(), { variant: 'primary', icon: 'sound' })),
        this.foundBox)]),
      Group('Sounds', [this.grid]),
    ];
    const right = [
      Section('Sound editor', [
        this.wave,
        (() => { const n = h('b'); setInterval(() => { n.textContent = this.sel.name; }, 300); return n; })(),
        h('div', { class: 'row' }, Btn('Play', () => this.play(), { icon: 'play', variant: 'soft' }), Btn('Randomize', () => { this.p.seed = Math.floor(Math.random() * 99999); this.play(); refreshAll(); }, { icon: 'dice' })),
        sp('length', 'Length (s)', 0.02, 4, 0.005), sp('pitch', 'Pitch (st)', -24, 24, 1), sp('bright', 'Tone (dark → bright)', 0, 1, 0.01),
        sp('reverb', 'Room', 0, 1, 0.01), sp('width', 'Stereo width', 0, 1, 0.01), sp('drive', 'Juice (saturation)', 0, 1, 0.01), sp('volume', 'Volume (dB)', -30, 0, 0.5),
        h('div', { class: 'row' }, Btn('Add at playhead', () => this.place(), { variant: 'primary', icon: 'send' }), Btn('★', () => { this.favs.has(this.sel.id) ? this.favs.delete(this.sel.id) : this.favs.add(this.sel.id); localStorage.setItem('kinetix.sfx.favs', JSON.stringify([...this.favs])); toast(this.favs.has(this.sel.id) ? 'Saved to favorites' : 'Removed'); }, { title: 'Favorite' })),
      ], { color: 'var(--lime)' }),
    ];
    this.el = Page({ title: 'Sound Lab', sub: 'Hand-crafted synthesised sound design — satisfying pops, water, mallets, UI and more — plus Auto-SFX that scores your whole animation.', side, main, right }).el;
    this.renderGrid();
    registerCommands([
      { id: 'sfx.auto', label: 'Sound: Auto-SFX (analyze & place)', group: 'Sound', run: () => this.autoSfx() },
      ...PACKS.map((pk) => ({ id: 'sfx.style.' + pk.id, label: 'Sound style: listen to ' + pk.label, group: 'Sound', run: () => this.demo(pk) })),
    ]);
  }

  activate() {}
  deactivate() {}

  private renderGrid() {
    clear(this.grid);
    const list = this.bank.filter((b) => (this.cat === 'All' || (this.cat === 'Favorites' ? this.favs.has(b.id) : b.cat === this.cat)) && (!this.q || b.name.toLowerCase().includes(this.q))).slice(0, 240);
    for (const b of list) {
      const t = h('div', { class: 'tile' + (b.id === this.sel.id ? ' on' : '') }, h('div', { class: 'tile-label' }, b.name), h('div', { class: 'tile-sub' }, `${b.cat} · ${b.p.length.toFixed(2)}s`));
      t.addEventListener('click', () => { this.pick(b); this.grid.querySelectorAll('.tile').forEach((x) => x.classList.remove('on')); t.classList.add('on'); });
      this.grid.appendChild(t);
    }
    if (!list.length) this.grid.appendChild(h('div', { class: 'empty' }, 'No sounds match'));
  }

  private pick(b: Preset) { this.sel = b; this.p = { ...b.p }; refreshAll(); this.play(); }

  private async renderCached(p: SoundParams) {
    const key = JSON.stringify(p);
    let b = this.renderCache.get(key);
    if (!b) { b = await render(p); if (this.renderCache.size > 300) this.renderCache.clear(); this.renderCache.set(key, b); }
    return b;
  }
  private audio() { this.ac ??= new AudioContext(); return this.ac; }
  private async play() {
    try {
      const buf = await this.renderCached(this.p);
      drawWave(buf, this.wave);
      const ac = this.audio(), s = ac.createBufferSource();
      s.buffer = buf; s.connect(ac.destination); s.start();
    } catch (e: any) { toast('Audio: ' + e.message, 'err'); }
  }

  /** Base params for a generator in a style pack. */
  private paramsFor(pk: Pack, gen: string, seed: number, extraPitch = 0, len?: number): SoundParams {
    const G = GENERATORS[gen];
    const r = rng(seed);
    return { gen, length: len ?? +(G.len[0] + (G.len[1] - G.len[0]) * (0.35 + r() * 0.3)).toFixed(3), pitch: extraPitch, bright: pk.bright + (r() - 0.5) * 0.1, reverb: pk.reverb, width: 0.6, drive: 0.15, seed, volume: -3 };
  }

  /** A little phrase that shows off a style. */
  private async demo(pk: Pack) {
    const seq: [Kind, number][] = [['appear', 0], ['appear', 0.16], ['appear', 0.32], ['move', 0.55], ['land', 0.95], ['bounce', 1.25], ['pop', 1.55], ['type', 1.85], ['type', 1.93], ['type', 2.01], ['morph', 2.25], ['vanish', 2.75]];
    const ac = this.audio();
    const t0 = ac.currentTime + 0.08;
    const tuned = tunedPitches(seq.map(([k, t]) => ({ t, kind: k } as SfxEvent)));
    let i = 0;
    for (const [kind, at] of seq) {
      const gens = pk.map[kind] ?? ['pop'];
      const gen = gens[i % gens.length];
      const pitch = pk.tuned && isPitched(gen) ? tuned[i] : 0;
      const buf = await this.renderCached(this.paramsFor(pk, gen, 1000 + i * 37, pitch, kind === 'move' ? 0.35 : undefined));
      const s = ac.createBufferSource(), g = ac.createGain();
      g.gain.value = kind === 'move' ? 0.6 : 0.9;
      s.buffer = buf; s.connect(g).connect(ac.destination);
      s.start(t0 + at);
      i++;
    }
    toast(`▶ ${pk.label}`, 'info', 2200);
  }

  private async writeWav(buf: AudioBuffer, name: string): Promise<string | null> {
    const req = nodeRequire();
    if (!req) return null;
    const fs = req('fs'), path = req('path'), os = req('os');
    let dir: string | null = null;
    try { dir = await call<string | null>('sfxFolder'); } catch { /* */ }
    dir ??= path.join(os.homedir(), 'Documents', 'Kinetix SFX');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name.replace(/[^a-z0-9 _-]+/gi, '').replace(/\s+/g, '_')}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}.wav`);
    fs.writeFileSync(file, Buffer.from(toWav(buf)));
    return file;
  }

  private async place() {
    if (!inAE) { toast('Preview mode: in After Effects this saves a WAV and drops it at the playhead', 'info'); return; }
    try {
      const f = await this.writeWav(await this.renderCached(this.p), this.sel.name);
      if (!f) throw new Error('Node.js is not available in this panel');
      await call('sfxPlace', { files: [{ path: f, t: null, name: this.sel.name, db: 0, pan: 0 }] });
      toast('Sound added at the playhead');
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }

  // ───────── Auto-SFX ─────────
  private async scan(): Promise<SfxEvent[]> {
    const a = this.a;
    let S: SampleSet;
    try { S = await call<SampleSet>('sfxSample', { scope: a.scope, workArea: a.workArea }); }
    catch (e: any) { toast(e.message, 'err', 6000); return []; }
    const raw = analyze(S, { motion: a.motion, text: a.text, morph: a.morph, markers: a.markers, cuts: a.cuts });
    this.found = thin(raw, a.density === 'sparse' ? 0.5 : a.density === 'rich' ? 1.8 : 1);
    if (a.density === 'sparse') this.found = this.found.filter((e) => !['type', 'spin', 'out'].includes(e.kind));
    this.showFound(S.layers.length);
    return this.found;
  }

  private showFound(nLayers: number) {
    clear(this.foundBox);
    const counts: Record<string, number> = {};
    this.found.forEach((e) => (counts[e.kind] = (counts[e.kind] ?? 0) + 1));
    const end = Math.max(1, ...this.found.map((e) => e.t + e.dur));
    const bar = h('div', { class: 'keybar', style: { height: '36px' } });
    for (const e of this.found) bar.appendChild(h('div', { title: `${KIND_LABEL[e.kind]} · ${e.layer} · ${e.t.toFixed(2)}s`, style: { position: 'absolute', left: (e.t / end) * 100 + '%', top: '8px', width: e.dur > 0 ? Math.max(4, (e.dur / end) * 100) + '%' : '4px', height: '20px', borderRadius: '4px', background: e.dur > 0 ? 'rgba(76,201,240,.5)' : 'var(--lime)' } }));
    this.foundBox.append(
      h('div', { class: 'hint' }, `${this.found.length} sound events in ${nLayers} layer(s)`),
      h('div', { class: 'chips' }, ...Object.entries(counts).map(([k, n]) => h('span', { class: 'chip on', style: { cursor: 'default' } }, `${n} ${KIND_LABEL[k as Kind]}`))),
      bar,
    );
  }

  private async autoSfx() {
    const events = await this.scan();
    if (!events.length) { toast('No animation found to score', 'info'); return; }
    if (!inAE) { toast(`Preview mode: would place ${events.length} sounds`, 'info', 4000); return; }
    const a = this.a, pk = PACKS.find((p) => p.id === a.pack) ?? PACKS[0];
    const tuned = tunedPitches(events);
    const kindDb: Partial<Record<Kind, number>> = { move: -5, cam: -3, type: -6, spin: -5, out: -4, vanish: -3 };
    toast(`Designing ${events.length} sounds…`, 'info', 2500);
    const files: { path: string; t: number; name: string; db: number; pan: number }[] = [];
    let i = 0;
    for (const e of events) {
      const gens = pk.map[e.kind] ?? ['pop'];
      const gen = gens[i % gens.length];
      const G = GENERATORS[gen];
      const longKind = ['move', 'cam', 'spin', 'morph'].includes(e.kind);
      const len = longKind && e.dur > 0.05 ? Math.min(G.len[1] * 1.6, Math.max(G.len[0], e.dur)) : undefined;
      const pitch = (isPitched(gen) ? sizePitch(e.size) : 0) + (pk.tuned && a.tuned && isPitched(gen) ? tuned[i] : Math.round((Math.random() - 0.5) * 2));
      const p = this.paramsFor(pk, gen, 7000 + i * 131, pitch, len);
      const buf = await this.renderCached(p);
      const path = await this.writeWav(buf, `KX ${G.label}`);
      if (!path) break;
      const start = longKind ? Math.max(0, e.t - 0.04) : e.t;
      files.push({ path, t: start, name: `KX SFX · ${G.label} · ${KIND_LABEL[e.kind]}`, db: a.volume - 13 + e.strength * 10 + (kindDb[e.kind] ?? 0), pan: (e.x - 0.5) * 1.6 });
      i++;
    }
    try { const r = await call<{ layers: number }>('sfxPlace', { files }); toast(`Auto-SFX: ${r.layers} sounds placed with “${pk.label}”`); }
    catch (e: any) { toast(e.message, 'err', 6000); }
  }
}
