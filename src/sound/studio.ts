import { h, Section, Slider, Seg, Btn, Toggle, toast, refreshAll, clear, Chips, Select, onRefresh } from '../ui/kit';
import { Page, Group } from '../core/page';
import { call, inAE, nodeRequire } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { render, toWav, presetBank, drawWave, type SoundParams, type Preset } from './synth';
import { analyzeScan, ROLE_LABEL, type Scan, type Ev, type Role } from './gestures';
import { PACKS, planVoices, renderMix, type MixOpts, type Pack } from './mixer';
import { loadIndex, loadSound, LIB_CATS, type LibSound } from './library';
import type { Studio } from '../main';

const LS = 'kinetix.sound3';
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROLE_COLOR: Partial<Record<Role, string>> = { whoosh: 'rgba(76,201,240,.55)', spin: 'rgba(76,201,240,.55)', cam: 'rgba(76,201,240,.55)', morph: 'rgba(179,136,255,.6)', type: 'rgba(255,255,255,.45)', nudge: 'rgba(255,255,255,.3)' };

type Item = { kind: 'lib'; s: LibSound } | { kind: 'synth'; p: Preset };

export class SoundStudio implements Studio {
  id = 'sound';
  el: HTMLElement;
  private bank = presetBank();
  private lib: LibSound[] = [];
  private cat = 'pop';
  private q = '';
  private sel: Item | null = null;
  private edit = { pitch: 0, volume: 0 };
  private synthP: SoundParams = { ...this.bank[0].p };
  private grid: HTMLElement;
  private wave: HTMLCanvasElement;
  private editor: HTMLElement;
  private ac: AudioContext | null = null;
  private a = {
    pack: 'tickle', tuned: false, scale: 'pentatonic' as MixOpts['scale'], key: 0, density: 'normal' as 'sparse' | 'normal' | 'rich',
    motion: true, text: true, morph: true, markers: true, cuts: true, precomps: true,
    volume: 0, room: 0.15, width: 0.8, scope: 'all' as 'all' | 'selected', workArea: false, stems: false, replace: true, seed: 1,
  };
  private scan: Scan | null = null;
  private found: Ev[] = [];
  private foundBox: HTMLElement;
  private favs = new Set<string>(JSON.parse(localStorage.getItem('kinetix.sfx.favs3') || '[]'));
  private playing: AudioBufferSourceNode[] = [];

  constructor() {
    try { Object.assign(this.a, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { /* first run */ }
    const a = this.a;
    const save = () => { try { localStorage.setItem(LS, JSON.stringify(a)); } catch { /* storage blocked */ } };
    this.grid = h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } });
    this.wave = h('canvas', { style: { width: '100%', height: '90px', display: 'block', borderRadius: '12px', background: 'var(--bg-deep)' } });
    this.editor = h('div', { class: 'stack' });
    this.foundBox = h('div', { class: 'stack' });
    const search = h('input', { class: 'input', placeholder: 'Search sounds…', style: { fontFamily: 'var(--font-ui)' } }) as HTMLInputElement;
    search.addEventListener('keydown', (e) => e.stopPropagation());
    search.addEventListener('input', () => { this.q = search.value.toLowerCase(); this.renderGrid(); });

    // ── style explorer
    const styles = h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' } });
    const drawStyles = () => {
      clear(styles);
      for (const pk of PACKS) {
        const t = h('div', { class: 'tile' + (pk.id === a.pack ? ' on' : '') },
          h('div', { class: 'tile-label', style: { fontSize: '14px' } }, pk.label),
          h('div', { class: 'tile-sub' }, pk.sub),
          h('div', { class: 'row', style: { marginTop: '4px' } },
            Btn('▶ Listen', (e) => { e.stopPropagation(); this.demo(pk); }, { size: 'sm', variant: 'soft' }),
            Btn(pk.id === a.pack ? '✓ Using' : 'Use', (e) => { e.stopPropagation(); a.pack = pk.id; a.tuned = pk.tuned; a.room = pk.room; save(); drawStyles(); refreshAll(); }, { size: 'sm' })));
        t.addEventListener('click', () => this.demo(pk));
        styles.appendChild(t);
      }
    };
    drawStyles();

    const side = [
      Section('Mix', [
        Slider({ label: 'Volume (dB)', min: -18, max: 6, step: 0.5, get: () => a.volume, set: (v) => { a.volume = v; save(); } }),
        Slider({ label: 'Shared room', min: 0, max: 0.6, step: 0.01, get: () => a.room, set: (v) => { a.room = v; save(); }, title: 'One common space for every sound — the glue that makes them blend' }),
        Slider({ label: 'Stereo width', min: 0, max: 1, step: 0.01, get: () => a.width, set: (v) => { a.width = v; save(); }, title: 'Pan sounds with the on-screen position' }),
        Seg([{ value: 'sparse', label: 'Sparse' }, { value: 'normal', label: 'Normal' }, { value: 'rich', label: 'Rich' }], () => a.density, (v) => { a.density = v; save(); refreshAll(); if (this.scan) this.reanalyze(); }),
        Toggle('Melodic (tune to a scale)', () => a.tuned, (v) => { a.tuned = v; save(); refreshAll(); }),
        h('div', { class: 'row' },
          Select([{ value: 'pentatonic', label: 'Pentatonic' }, { value: 'major', label: 'Major' }, { value: 'dreamy', label: 'Dreamy' }], () => a.scale, (v) => { a.scale = v; save(); }),
          Select(KEYS.map((k, i) => ({ value: String(i), label: 'Key ' + k })), () => String(a.key), (v) => { a.key = +v; save(); })),
        h('div', { class: 'hint' }, 'Sizes set the pitch (small = higher). Several things popping in a row climb up like a little melody.'),
      ], { color: 'var(--lime)' }),
    ];

    const main = [
      Group('1 · Pick a sound style', [styles]),
      Group('2 · Auto-SFX — score the whole animation', [h('div', { class: 'card stack' },
        h('div', { class: 'row wrap' },
          Seg([{ value: 'all', label: 'All layers' }, { value: 'selected', label: 'Selected' }], () => a.scope, (v) => { a.scope = v; save(); refreshAll(); }),
          Toggle('Work area only', () => a.workArea, (v) => { a.workArea = v; save(); refreshAll(); })),
        h('div', { class: 'row wrap' },
          Toggle('Motion', () => a.motion, (v) => { a.motion = v; save(); refreshAll(); }),
          Toggle('Typing', () => a.text, (v) => { a.text = v; save(); refreshAll(); }),
          Toggle('Shape morphs', () => a.morph, (v) => { a.morph = v; save(); refreshAll(); }),
          Toggle('Kinetix hits', () => a.markers, (v) => { a.markers = v; save(); refreshAll(); }),
          Toggle('Cut-ins', () => a.cuts, (v) => { a.cuts = v; save(); refreshAll(); }),
          Toggle('Inside precomps', () => a.precomps, (v) => { a.precomps = v; save(); refreshAll(); })),
        h('div', { class: 'row wrap' },
          Btn('Analyze', () => this.analyze(), { icon: 'search' }),
          Btn('▶ Preview mix', () => this.previewMix(), { variant: 'soft' }),
          Btn('Place in AE', () => this.place(), { variant: 'primary', icon: 'sound' })),
        h('div', { class: 'row wrap' },
          Seg([{ value: 'mix', label: 'One mixed track' }, { value: 'stems', label: '3 stems' }], () => (a.stems ? 'stems' : 'mix'), (v) => { a.stems = v === 'stems'; save(); refreshAll(); }),
          Toggle('Replace previous', () => a.replace, (v) => { a.replace = v; save(); refreshAll(); }),
          Btn('🎲 Vary', () => { a.seed++; save(); toast('New variation — preview or place again', 'info'); }, { size: 'sm', title: 'Different picks from the same style' })),
        h('div', { class: 'hint' }, 'Reads every layer on screen frame by frame — parents, 3D camera, scale, precomp contents, Kinetix In/Out & Type — groups motion into gestures and gives each one a single sound with matching accents.'),
        this.foundBox)]),
      Group('3 · Library', [
        h('div', { class: 'row wrap' }, search),
        (() => {
          const c = h('div', { class: 'chips' });
          onRefresh(c, () => {
            clear(c);
            for (const x of [...LIB_CATS.map((q) => ({ id: q.id, label: q.label })), { id: 'synth', label: 'Kinetix Synth' }, { id: 'fav', label: '★ Favorites' }]) {
              const b = h('button', { class: 'chip' + (this.cat === x.id ? ' on' : '') }, x.label);
              b.addEventListener('click', () => { this.cat = x.id; this.renderGrid(); refreshAll(); });
              c.appendChild(b);
            }
          });
          return c;
        })(),
        this.grid,
        h('div', { class: 'hint' }, 'Recorded sounds are CC0 (Freesound.org & Kenney.nl), cleaned and loudness-matched.'),
      ]),
    ];

    const right = [
      Section('Sound', [this.wave, this.editor], { color: 'var(--lime)' }),
    ];
    this.el = Page({ title: 'Sound Lab', sub: 'Real recorded pops, drops and whooshes + Auto-SFX that reads your animation like a sound designer and mixes one clean track.', side, main, right }).el;
    loadIndex().then((l) => { this.lib = l; this.renderGrid(); }).catch((e) => toast('Sound library: ' + e.message, 'err', 6000));
    this.renderEditor();
    registerCommands([
      { id: 'sfx.auto', label: 'Sound: Auto-SFX (analyze & place)', group: 'Sound', run: () => this.place() },
      { id: 'sfx.preview', label: 'Sound: Preview Auto-SFX mix', group: 'Sound', run: () => this.previewMix() },
      ...PACKS.map((pk) => ({ id: 'sfx.style.' + pk.id, label: 'Sound style: listen to ' + pk.label, group: 'Sound', run: () => this.demo(pk) })),
    ]);
  }

  activate() {}
  deactivate() { this.stop(); }

  // ───────── library ─────────
  private items(): Item[] {
    const q = this.q;
    const lib = this.lib.filter((s) => (this.cat === 'fav' ? this.favs.has(s.id) : this.cat === s.cat || (q && this.cat !== 'synth')) && (!q || s.name.toLowerCase().includes(q) || s.cat.includes(q)));
    const syn = this.cat === 'synth' || this.cat === 'fav' ? this.bank.filter((b) => (this.cat === 'fav' ? this.favs.has('synth:' + b.id) : true) && (!q || b.name.toLowerCase().includes(q))) : [];
    return [...lib.map((s) => ({ kind: 'lib', s }) as Item), ...syn.slice(0, 200).map((p) => ({ kind: 'synth', p }) as Item)];
  }
  private itemId(it: Item) { return it.kind === 'lib' ? it.s.id : 'synth:' + it.p.id; }
  private renderGrid() {
    clear(this.grid);
    const list = this.items();
    for (const it of list) {
      const name = it.kind === 'lib' ? it.s.name : it.p.name;
      const sub = it.kind === 'lib' ? `${it.s.cat} · ${it.s.dur.toFixed(2)}s${it.s.tonal ? ' · tonal' : ''}` : `${it.p.cat} · synth`;
      const t = h('div', { class: 'tile' + (this.sel && this.itemId(this.sel) === this.itemId(it) ? ' on' : '') }, h('div', { class: 'tile-label' }, (this.favs.has(this.itemId(it)) ? '★ ' : '') + name), h('div', { class: 'tile-sub' }, sub));
      t.addEventListener('click', () => { this.pick(it); this.grid.querySelectorAll('.tile').forEach((x) => x.classList.remove('on')); t.classList.add('on'); });
      this.grid.appendChild(t);
    }
    if (!list.length) this.grid.appendChild(h('div', { class: 'empty' }, this.lib.length || this.cat === 'synth' ? 'No sounds match' : 'Loading library…'));
  }
  private pick(it: Item) {
    this.sel = it;
    this.edit = { pitch: 0, volume: 0 };
    if (it.kind === 'synth') this.synthP = { ...it.p.p };
    this.renderEditor();
    this.playSel();
  }
  private renderEditor() {
    clear(this.editor);
    const it = this.sel;
    if (!it) { this.editor.appendChild(h('div', { class: 'hint' }, 'Click a sound in the library to hear it.')); return; }
    const name = it.kind === 'lib' ? it.s.name : it.p.name;
    this.editor.appendChild(h('b', null, name));
    if (it.kind === 'lib') {
      this.editor.append(
        h('div', { class: 'hint' }, `${it.s.cat} · ${it.s.dur.toFixed(2)} s · ${it.s.license} · `, h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); this.openUrl(it.s.src); } }, 'source')),
        Slider({ label: 'Pitch (st)', min: -12, max: 12, step: 1, get: () => this.edit.pitch, set: (v, f) => { this.edit.pitch = v; if (f) this.playSel(); } }),
        Slider({ label: 'Volume (dB)', min: -24, max: 6, step: 0.5, get: () => this.edit.volume, set: (v) => { this.edit.volume = v; } }),
      );
    } else {
      const sp = (k: keyof SoundParams, label: string, min: number, max: number, step: number) => Slider({ label, min, max, step, get: () => this.synthP[k] as number, set: (v, f) => { (this.synthP as any)[k] = v; if (f) this.playSel(); } });
      this.editor.append(sp('length', 'Length (s)', 0.02, 4, 0.005), sp('pitch', 'Pitch (st)', -24, 24, 1), sp('bright', 'Tone (dark → bright)', 0, 1, 0.01),
        sp('reverb', 'Room', 0, 1, 0.01), sp('width', 'Stereo width', 0, 1, 0.01), sp('drive', 'Juice', 0, 1, 0.01), sp('volume', 'Volume (dB)', -30, 0, 0.5),
        Btn('Randomize', () => { this.synthP.seed = Math.floor(Math.random() * 99999); this.playSel(); }, { icon: 'dice', size: 'sm' }));
    }
    this.editor.appendChild(h('div', { class: 'row' },
      Btn('Play', () => this.playSel(), { icon: 'play', variant: 'soft' }),
      Btn('Add at playhead', () => this.placeOne(), { variant: 'primary', icon: 'send' }),
      Btn('★', () => {
        const id = this.itemId(it);
        this.favs.has(id) ? this.favs.delete(id) : this.favs.add(id);
        try { localStorage.setItem('kinetix.sfx.favs3', JSON.stringify([...this.favs])); } catch { /* storage blocked */ }
        toast(this.favs.has(id) ? 'Saved to favorites' : 'Removed'); this.renderGrid();
      }, { title: 'Favorite' })));
    refreshAll();
  }
  private openUrl(u: string) {
    try { (window as any).cep?.util?.openURLInDefaultBrowser?.(u) ?? window.open(u, '_blank'); } catch { window.open(u, '_blank'); }
  }

  /** The selected sound with its pitch / volume edits applied. */
  private async selBuffer(): Promise<AudioBuffer | null> {
    const it = this.sel;
    if (!it) return null;
    if (it.kind === 'synth') return render(this.synthP);
    const src = await loadSound(it.s);
    const rate = Math.pow(2, this.edit.pitch / 12);
    const ctx = new OfflineAudioContext(2, Math.ceil(src.duration / rate * 48000) + 64, 48000);
    const s = ctx.createBufferSource(); s.buffer = src; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = Math.pow(10, this.edit.volume / 20);
    s.connect(g).connect(ctx.destination); s.start();
    return ctx.startRendering();
  }
  private audio() { this.ac ??= new AudioContext(); return this.ac; }
  private stop() { this.playing.forEach((s) => { try { s.stop(); } catch { /* already ended */ } }); this.playing = []; }
  private playBuf(buf: AudioBuffer, at = 0) {
    const ac = this.audio(), s = ac.createBufferSource();
    s.buffer = buf; s.connect(ac.destination); s.start(ac.currentTime + at);
    this.playing.push(s);
    s.onended = () => { this.playing = this.playing.filter((x) => x !== s); };
  }
  private async playSel() {
    try {
      const buf = await this.selBuffer();
      if (!buf) return;
      drawWave(buf, this.wave);
      this.stop(); this.playBuf(buf);
    } catch (e: any) { toast('Audio: ' + e.message, 'err'); }
  }

  // ───────── styles ─────────
  private mixOpts(pk?: Pack): MixOpts {
    const a = this.a;
    const pack = pk ?? PACKS.find((p) => p.id === a.pack) ?? PACKS[0];
    return { pack, tuned: pk ? pk.tuned : a.tuned, scale: a.scale, key: a.key, volume: a.volume, width: a.width, room: pk ? pk.room : a.room, stems: a.stems, seed: a.seed };
  }
  /** A little phrase that shows off a style: three cards pop in, a slide, a bounce, typing, a morph, an exit. */
  private async demo(pk: Pack) {
    const E = (t: number, role: Role, x = 0.5, extra: Partial<Ev> = {}): Ev => ({ t, dur: 0, role, strength: 0.8, x, size: 0.25, layer: 'demo' + t, accent: 0, ...extra });
    const ev: Ev[] = [
      E(0.0, 'enter', 0.3, { group: 1, step: 0, size: 0.2 }), E(0.14, 'enter', 0.5, { group: 1, step: 1, size: 0.2 }), E(0.28, 'enter', 0.7, { group: 1, step: 2, size: 0.2 }),
      E(0.55, 'whoosh', 0.4, { dur: 0.4, peak: 0.75, strength: 0.7 }), E(0.95, 'land', 0.7, { size: 0.35 }),
      E(1.25, 'bounce', 0.6, { strength: 0.6, accent: 1 }), E(1.45, 'bounce', 0.55, { strength: 0.4, accent: 2 }),
      E(1.75, 'pop', 0.5, { size: 0.15 }), E(2.0, 'type', 0.4), E(2.07, 'type', 0.45), E(2.14, 'type', 0.5), E(2.21, 'type', 0.55),
      E(2.45, 'morph', 0.5, { dur: 0.5 }), E(3.05, 'exit', 0.5, { strength: 0.6 }),
    ];
    try {
      toast(`▶ ${pk.label}`, 'info', 2200);
      const o = this.mixOpts(pk);
      const v = await planVoices(ev, o);
      const mix = await renderMix(v, { ...o, stems: false }, 4, 0);
      this.stop(); this.playBuf(mix.mix);
      drawWave(mix.mix, this.wave);
    } catch (e: any) { toast('Audio: ' + e.message, 'err'); }
  }

  // ───────── Auto-SFX ─────────
  private async analyze(): Promise<Ev[]> {
    const a = this.a;
    try { this.scan = await call<Scan>('sfxSample3', { scope: a.scope, workArea: a.workArea, precomps: a.precomps }); }
    catch (e: any) { toast(e.message, 'err', 6000); return []; }
    return this.reanalyze();
  }
  private reanalyze(): Ev[] {
    const a = this.a;
    if (!this.scan) return [];
    this.found = analyzeScan(this.scan, { motion: a.motion, text: a.text, morph: a.morph, markers: a.markers, cuts: a.cuts, density: a.density });
    this.showFound();
    return this.found;
  }
  private showFound() {
    clear(this.foundBox);
    const S = this.scan!;
    const counts: Partial<Record<Role, number>> = {};
    this.found.forEach((e) => (counts[e.role] = (counts[e.role] ?? 0) + 1));
    const span = Math.max(0.5, S.end - S.t0);
    const bar = h('div', { class: 'keybar', style: { height: '44px' } });
    for (const e of this.found) {
      const left = ((e.t - S.t0) / span) * 100;
      const long = ['whoosh', 'spin', 'cam', 'morph'].includes(e.role) && e.dur > 0;
      bar.appendChild(h('div', {
        title: `${ROLE_LABEL[e.role]} · ${e.layer} · ${e.t.toFixed(2)} s`,
        style: { position: 'absolute', left: left + '%', top: e.accent ? '26px' : '8px', width: long ? Math.max(0.6, (e.dur / span) * 100) + '%' : '3px', height: e.accent ? '10px' : '16px', borderRadius: '3px', background: ROLE_COLOR[e.role] ?? 'var(--lime)', opacity: String(0.45 + 0.55 * e.strength) },
      }));
    }
    this.foundBox.append(
      h('div', { class: 'hint' }, `${this.found.length} sounds from ${S.layers.length} layer(s) · ${span.toFixed(1)} s`),
      h('div', { class: 'chips' }, ...Object.entries(counts).map(([k, n]) => h('span', { class: 'chip on', style: { cursor: 'default' } }, `${n} ${ROLE_LABEL[k as Role]}`))),
      bar,
    );
  }
  private async buildMix() {
    const events = this.scan ? this.found : await this.analyze();
    if (!events.length) { toast('No animation found to score', 'info'); return null; }
    const S = this.scan!;
    const o = this.mixOpts();
    const voices = await planVoices(events, o);
    const len = Math.max(0.5, S.end - S.t0);
    const stems = await renderMix(voices, o, len, S.t0);
    return { stems, t0: S.t0, n: voices.length };
  }
  private async previewMix() {
    try {
      if (!this.scan) await this.analyze();
      const m = await this.buildMix();
      if (!m) return;
      this.stop();
      const parts = Object.values(m.stems);
      // audition stems summed
      for (const b of parts) this.playBuf(b);
      drawWave(parts[0], this.wave);
      toast(`▶ ${m.n} sounds`, 'info', 2000);
    } catch (e: any) { toast('Mix: ' + e.message, 'err', 6000); }
  }
  private async place() {
    try {
      await this.analyze();
      const m = await this.buildMix();
      if (!m) return;
      if (!inAE) { toast(`Preview mode: would place ${Object.keys(m.stems).length} track(s) with ${m.n} sounds`, 'info', 4000); return; }
      const pk = this.mixOpts().pack;
      const files: { path: string; t: number; name: string }[] = [];
      for (const [k, b] of Object.entries(m.stems)) {
        const path = await this.writeWav(b, `KX AutoSFX ${pk.label} ${k}`);
        if (!path) throw new Error('Node.js is not available in this panel');
        files.push({ path, t: m.t0, name: k === 'mix' ? `KX Auto-SFX · ${pk.label}` : `KX Auto-SFX · ${k}` });
      }
      const r = await call<{ layers: number }>('sfxPlaceMix', { files, replace: this.a.replace });
      toast(`Auto-SFX: ${m.n} sounds mixed into ${r.layers} track${r.layers > 1 ? 's' : ''}`);
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }

  private async writeWav(buf: AudioBuffer, name: string): Promise<string | null> {
    const req = nodeRequire();
    if (!req) return null;
    const fs = req('fs'), path = req('path'), os = req('os');
    let dir: string | null = null;
    try { dir = await call<string | null>('sfxFolder'); } catch { /* unsaved project → Documents */ }
    dir ??= path.join(os.homedir(), 'Documents', 'Kinetix SFX');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name.replace(/[^a-z0-9 _-]+/gi, '').replace(/\s+/g, '_')}_${Date.now().toString(36)}.wav`);
    fs.writeFileSync(file, Buffer.from(toWav(buf)));
    return file;
  }

  private async placeOne() {
    if (!inAE) { toast('Preview mode: in After Effects this saves a WAV and drops it at the playhead', 'info'); return; }
    try {
      const b = await this.selBuffer();
      if (!b) return;
      const name = this.sel!.kind === 'lib' ? this.sel!.s.name : this.sel!.p.name;
      const f = await this.writeWav(b, name);
      if (!f) throw new Error('Node.js is not available in this panel');
      await call('sfxPlace', { files: [{ path: f, t: null, name: 'KX SFX · ' + name, db: 0, pan: 0 }] });
      toast('Sound added at the playhead');
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }
}
