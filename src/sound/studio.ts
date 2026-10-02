import { h, Slider, Seg, Btn, Toggle, toast, refreshAll, clear, Select, onRefresh } from '../ui/kit';
import { Flow, Step, More, Tabs, Picks } from '../ui/flow';
import { call, inAE, nodeRequire } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { render, toWav, presetBank, drawWave, type SoundParams, type Preset } from './synth';
import { analyzeScan, ROLE_LABEL, type Scan, type Ev, type Role } from './gestures';
import { PACKS, FAMILIES, blendPacks, planVoices, renderMix, type MixOpts, type Pack } from './mixer';
import { loadIndex, loadSound, LIB_CATS, type LibSound } from './library';
import type { Studio } from '../main';

const LS = 'kinetix.sound4';
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROLE_COLOR: Partial<Record<Role, string>> = { whoosh: 'rgba(76,201,240,.55)', spin: 'rgba(76,201,240,.55)', cam: 'rgba(76,201,240,.55)', morph: 'rgba(179,136,255,.6)', type: 'rgba(255,255,255,.45)', nudge: 'rgba(255,255,255,.3)' };

type Item = { kind: 'lib'; s: LibSound } | { kind: 'synth'; p: Preset };

export class SoundStudio implements Studio {
  id = 'sound';
  el: HTMLElement;
  private mode: 'auto' | 'lib' = 'auto';
  private bank = presetBank();
  private lib: LibSound[] = [];
  private cat = 'pop';
  private q = '';
  private sel: Item | null = null;
  private edit = { pitch: 0, volume: 0 };
  private synthP: SoundParams = { ...this.bank[0].p };
  private grid: HTMLElement;
  private wave: HTMLCanvasElement;
  private ac: AudioContext | null = null;
  private a = {
    packs: ['tickle'] as string[], map: {} as Record<string, string[]>,
    tuned: false, scale: 'pentatonic' as MixOpts['scale'], key: 0, density: 'normal' as 'sparse' | 'normal' | 'rich',
    motion: true, text: true, morph: true, markers: true, cuts: true, precomps: true,
    volume: 0, room: -1, width: 0.8, scope: 'all' as 'all' | 'selected', workArea: false, stems: false, replace: true, seed: 1,
  };
  private scan: Scan | null = null;
  private found: Ev[] = [];
  private foundBox: HTMLElement;
  private favs = new Set<string>(JSON.parse(localStorage.getItem('kinetix.sfx.favs3') || '[]'));
  private playing: AudioBufferSourceNode[] = [];
  private autoBody: HTMLElement;
  private libBody: HTMLElement;

  constructor() {
    try { Object.assign(this.a, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { /* first run */ }
    const a = this.a;
    const save = () => { try { localStorage.setItem(LS, JSON.stringify(a)); } catch { /* storage blocked */ } };
    this.grid = h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' } });
    this.wave = h('canvas', { style: { width: '100%', height: '56px', display: 'block', borderRadius: '12px', background: 'var(--bg-deep)' } });
    this.foundBox = h('div', { class: 'stack' });

    // ── Auto sound ──
    const styles = Picks(PACKS.map((p) => ({ id: p.id, label: p.label, sub: p.sub })), {
      isOn: (t) => a.packs.includes(t.id),
      onPick: (t) => {
        a.packs = a.packs.includes(t.id) ? a.packs.filter((x) => x !== t.id) : [...a.packs, t.id];
        if (!a.packs.length) a.packs = [t.id];
        save(); this.drawMix();
      },
      extra: (t) => Btn('▶ Listen', (e) => { e.stopPropagation(); this.demo(PACKS.find((p) => p.id === t.id)!); }, { size: 'sm', variant: 'soft' }),
      min: 170,
    });
    this.mixLine = h('div', { class: 'hint' });
    const famRows = h('div', { class: 'stack' });
    this.drawFamilies = () => {
      clear(famRows);
      for (const f of FAMILIES) {
        const cur = a.map[f.id] ?? [];
        const chips = h('div', { class: 'chips' },
          ...[{ id: '', label: 'From style' }, ...LIB_CATS.map((c) => ({ id: c.id, label: c.label }))].map((c) => {
            const on = c.id === '' ? !cur.length : cur.includes(c.id);
            const b = h('button', { class: 'chip' + (on ? ' on' : '') }, c.label);
            b.addEventListener('click', () => {
              if (c.id === '') delete a.map[f.id];
              else { const s = new Set(cur); s.has(c.id) ? s.delete(c.id) : s.add(c.id); a.map[f.id] = [...s]; if (!a.map[f.id].length) delete a.map[f.id]; }
              save(); this.drawFamilies();
            });
            return b;
          }));
        famRows.append(h('div', { class: 'stack', style: { gap: '6px' } }, h('b', { style: { fontSize: '12.5px' } }, f.label), chips));
      }
    };
    this.drawFamilies();

    this.autoBody = h('div', { class: 'stack', style: { gap: '16px' } },
      Step(1, 'Pick your sound', [styles.el, this.mixLine], 'pick one or mix several'),
      Step(2, 'How much sound?', [
        Seg([{ value: 'sparse', label: 'Light' }, { value: 'normal', label: 'Normal' }, { value: 'rich', label: 'Rich' }], () => a.density, (v) => { a.density = v; save(); refreshAll(); if (this.scan) this.reanalyze(); }),
        Slider({ label: 'Volume', min: -18, max: 6, step: 0.5, unit: ' dB', get: () => a.volume, set: (v) => { a.volume = v; save(); } }),
        this.foundBox,
      ]),
      More('sound-map', [
        h('div', { class: 'hint' }, 'Choose exactly which sounds each kind of motion uses. “From style” follows the styles picked above.'),
        famRows,
      ], 'Sound for each kind of motion'),
      More('sound-adv', [
        h('div', { class: 'row wrap' },
          Seg([{ value: 'all', label: 'All layers' }, { value: 'selected', label: 'Selected layers' }], () => a.scope, (v) => { a.scope = v; save(); refreshAll(); }),
          Toggle('Work area only', () => a.workArea, (v) => { a.workArea = v; save(); refreshAll(); })),
        h('div', { class: 'row wrap' },
          Toggle('Movement', () => a.motion, (v) => { a.motion = v; save(); refreshAll(); }),
          Toggle('Typing', () => a.text, (v) => { a.text = v; save(); refreshAll(); }),
          Toggle('Shape morphs', () => a.morph, (v) => { a.morph = v; save(); refreshAll(); }),
          Toggle('Kinetix hits', () => a.markers, (v) => { a.markers = v; save(); refreshAll(); }),
          Toggle('Layer cut-ins', () => a.cuts, (v) => { a.cuts = v; save(); refreshAll(); }),
          Toggle('Inside precomps', () => a.precomps, (v) => { a.precomps = v; save(); refreshAll(); })),
        Slider({ label: 'Shared room (glue)', min: 0, max: 0.6, step: 0.01, get: () => (a.room < 0 ? this.pack().room : a.room), set: (v) => { a.room = v; save(); } }),
        Slider({ label: 'Stereo width', min: 0, max: 1, step: 0.01, get: () => a.width, set: (v) => { a.width = v; save(); } }),
        Toggle('Melodic — tune sounds to a scale', () => a.tuned, (v) => { a.tuned = v; save(); refreshAll(); }),
        h('div', { class: 'row' },
          Select([{ value: 'pentatonic', label: 'Pentatonic' }, { value: 'major', label: 'Major' }, { value: 'dreamy', label: 'Dreamy' }], () => a.scale, (v) => { a.scale = v; save(); }),
          Select(KEYS.map((k, i) => ({ value: String(i), label: 'Key ' + k })), () => String(a.key), (v) => { a.key = +v; save(); })),
        h('div', { class: 'row wrap' },
          Seg([{ value: 'mix', label: 'One track' }, { value: 'stems', label: '3 stems' }], () => (a.stems ? 'stems' : 'mix'), (v) => { a.stems = v === 'stems'; save(); refreshAll(); }),
          Toggle('Replace previous', () => a.replace, (v) => { a.replace = v; save(); refreshAll(); })),
      ]),
    );

    // ── Library ──
    const search = h('input', { class: 'input', placeholder: 'Search sounds…' }) as HTMLInputElement;
    search.addEventListener('keydown', (e) => e.stopPropagation());
    search.addEventListener('input', () => { this.q = search.value.toLowerCase(); this.renderGrid(); });
    const cats = h('div', { class: 'chips' });
    onRefresh(cats, () => {
      clear(cats);
      for (const x of [...LIB_CATS.map((q) => ({ id: q.id, label: q.label })), { id: 'synth', label: 'Kinetix Synth' }, { id: 'fav', label: '★ Favorites' }]) {
        const b = h('button', { class: 'chip' + (this.cat === x.id ? ' on' : '') }, x.label);
        b.addEventListener('click', () => { this.cat = x.id; this.renderGrid(); refreshAll(); });
        cats.appendChild(b);
      }
    });
    this.editor = h('div', { class: 'stack' });
    this.libBody = h('div', { class: 'stack', style: { gap: '16px' } },
      Step(null, 'Sounds', [search, cats, this.grid], 'click to listen'),
      Step(null, 'Selected sound', [this.wave, this.editor]));

    const tabs = Tabs([{ id: 'auto', label: 'Auto sound' }, { id: 'lib', label: 'Library' }], () => this.mode, (v) => { this.mode = v; this.showMode(); });
    const page = Flow({
      title: 'Sound', sub: 'Pick a sound style and Kinetix listens to your whole animation, then adds one clean sound track. Or browse the library and drop single sounds.',
      tabs, body: [this.autoBody, this.libBody],
      action: {
        label: 'Add sound to my animation', icon: 'sound', need: () => (this.mode === 'auto' ? 'comp' : 'comp'),
        run: () => (this.mode === 'auto' ? this.place() : this.placeOne()),
        secondary: [Btn('▶ Preview', () => (this.mode === 'auto' ? this.previewMix() : this.playSel()), { variant: 'soft' }), Btn('🎲', () => { a.seed++; save(); toast('New variation — preview or add again', 'info'); }, { title: 'Different sound picks', variant: 'ghost' })],
      },
    });
    this.el = page.el;
    this.actionBtn = this.el.querySelector('.action-main') as HTMLElement;
    this.showMode();
    this.drawMix();
    loadIndex().then((l) => { this.lib = l; this.renderGrid(); }).catch((e) => toast('Sound library: ' + e.message, 'err', 6000));
    this.renderEditor();
    registerCommands([
      { id: 'sfx.auto', label: 'Sound: Add sound to my animation', group: 'Sound', run: () => this.place() },
      { id: 'sfx.preview', label: 'Sound: Preview auto sound', group: 'Sound', run: () => this.previewMix() },
      ...PACKS.map((pk) => ({ id: 'sfx.style.' + pk.id, label: 'Sound style: listen to ' + pk.label, group: 'Sound', run: () => this.demo(pk) })),
    ]);
  }
  private mixLine!: HTMLElement;
  private editor!: HTMLElement;
  private actionBtn!: HTMLElement;
  private drawFamilies!: () => void;

  activate() {}
  deactivate() { this.stop(); }

  private showMode() {
    this.autoBody.style.display = this.mode === 'auto' ? '' : 'none';
    this.libBody.style.display = this.mode === 'lib' ? '' : 'none';
    const t = this.actionBtn?.lastChild;
    if (t && t.nodeType === Node.TEXT_NODE) t.nodeValue = this.mode === 'auto' ? 'Add sound to my animation' : 'Add at playhead';
  }
  private pack(): Pack { return blendPacks(this.a.packs, this.a.map); }
  private drawMix() {
    const names = this.a.packs.map((id) => PACKS.find((p) => p.id === id)?.label).filter(Boolean);
    this.mixLine.textContent = names.length > 1 ? `Mixing ${names.join(' + ')} — sounds are taken from all of them.` : `Using ${names[0]}. Tap more styles to mix them.`;
  }

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
      const sub = it.kind === 'lib' ? `${it.s.dur.toFixed(2)}s` : 'synth';
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
    if (!it) { this.editor.appendChild(h('div', { class: 'hint' }, 'Click a sound above to hear it. Then press “Add at playhead”.')); return; }
    const name = it.kind === 'lib' ? it.s.name : it.p.name;
    const fav = () => {
      const id = this.itemId(it);
      this.favs.has(id) ? this.favs.delete(id) : this.favs.add(id);
      try { localStorage.setItem('kinetix.sfx.favs3', JSON.stringify([...this.favs])); } catch { /* storage blocked */ }
      toast(this.favs.has(id) ? 'Saved to favorites' : 'Removed'); this.renderGrid();
    };
    this.editor.append(h('div', { class: 'hstack' }, h('b', { class: 'grow' }, name), Btn('★', fav, { size: 'sm', title: 'Favorite' })));
    if (it.kind === 'lib') {
      this.editor.append(h('div', { class: 'row' },
        Slider({ label: 'Pitch', min: -12, max: 12, step: 1, unit: ' st', get: () => this.edit.pitch, set: (v, f) => { this.edit.pitch = v; if (f) this.playSel(); } }),
        Slider({ label: 'Volume', min: -24, max: 6, step: 0.5, unit: ' dB', get: () => this.edit.volume, set: (v) => { this.edit.volume = v; } })));
    } else {
      const sp = (k: keyof SoundParams, label: string, min: number, max: number, step: number) => Slider({ label, min, max, step, get: () => this.synthP[k] as number, set: (v, f) => { (this.synthP as any)[k] = v; if (f) this.playSel(); } });
      this.editor.append(h('div', { class: 'row' }, sp('pitch', 'Pitch', -24, 24, 1), sp('length', 'Length (s)', 0.02, 4, 0.005)),
        More('synth-edit', [sp('bright', 'Tone (dark → bright)', 0, 1, 0.01), sp('reverb', 'Room', 0, 1, 0.01), sp('width', 'Stereo width', 0, 1, 0.01), sp('drive', 'Juice', 0, 1, 0.01), sp('volume', 'Volume (dB)', -30, 0, 0.5),
          Btn('Randomize', () => { this.synthP.seed = Math.floor(Math.random() * 99999); this.playSel(); }, { icon: 'dice', size: 'sm' })], 'Shape the synth'));
    }
    refreshAll();
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
  private playBuf(buf: AudioBuffer) {
    const ac = this.audio(), s = ac.createBufferSource();
    s.buffer = buf; s.connect(ac.destination); s.start();
    this.playing.push(s);
    s.onended = () => { this.playing = this.playing.filter((x) => x !== s); };
  }
  private async playSel() {
    try {
      const buf = await this.selBuffer();
      if (!buf) { toast('Pick a sound first', 'info'); return; }
      drawWave(buf, this.wave);
      this.stop(); this.playBuf(buf);
    } catch (e: any) { toast('Audio: ' + e.message, 'err'); }
  }

  // ───────── auto sound ─────────
  private mixOpts(pk?: Pack): MixOpts {
    const a = this.a;
    const pack = pk ?? this.pack();
    return { pack, tuned: pk ? pk.tuned : a.tuned, scale: a.scale, key: a.key, volume: a.volume, width: a.width, room: pk ? pk.room : a.room < 0 ? pack.room : a.room, stems: a.stems, seed: a.seed };
  }
  /** A little phrase that shows off a style. */
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
      const mix = await renderMix(await planVoices(ev, o), { ...o, stems: false }, 4, 0);
      this.stop(); this.playBuf(mix.mix);
    } catch (e: any) { toast('Audio: ' + e.message, 'err'); }
  }

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
    const bar = h('div', { class: 'keybar', style: { height: '40px' } });
    for (const e of this.found) {
      const long = ['whoosh', 'spin', 'cam', 'morph'].includes(e.role) && e.dur > 0;
      bar.appendChild(h('div', {
        title: `${ROLE_LABEL[e.role]} · ${e.layer} · ${e.t.toFixed(2)} s`,
        style: { position: 'absolute', left: ((e.t - S.t0) / span) * 100 + '%', top: e.accent ? '24px' : '8px', width: long ? Math.max(0.6, (e.dur / span) * 100) + '%' : '3px', height: e.accent ? '9px' : '14px', borderRadius: '3px', background: ROLE_COLOR[e.role] ?? 'var(--lime)', opacity: String(0.45 + 0.55 * e.strength) },
      }));
    }
    this.foundBox.append(
      h('div', { class: 'hint' }, `Found ${this.found.length} moments to sound: ` + Object.entries(counts).map(([k, n]) => `${n} ${ROLE_LABEL[k as Role].toLowerCase()}`).join(' · ')),
      bar);
  }
  private async buildMix() {
    const events = await this.analyze();
    if (!events.length) { toast('No animation found to add sound to', 'info'); return null; }
    const S = this.scan!;
    const o = this.mixOpts();
    const voices = await planVoices(events, o);
    const stems = await renderMix(voices, o, Math.max(0.5, S.end - S.t0), S.t0);
    return { stems, t0: S.t0, n: voices.length };
  }
  private async previewMix() {
    try {
      const m = await this.buildMix();
      if (!m) return;
      this.stop();
      for (const b of Object.values(m.stems)) this.playBuf(b);
      toast(`▶ ${m.n} sounds`, 'info', 2000);
    } catch (e: any) { toast('Mix: ' + e.message, 'err', 6000); }
  }
  private async place() {
    try {
      const m = await this.buildMix();
      if (!m) return;
      if (!inAE) { toast(`Preview mode: would add ${Object.keys(m.stems).length} track(s) with ${m.n} sounds`, 'info', 4000); return; }
      const pk = this.mixOpts().pack;
      const files: { path: string; t: number; name: string }[] = [];
      for (const [k, b] of Object.entries(m.stems)) {
        const path = await this.writeWav(b, `KX Sound ${k}`);
        if (!path) throw new Error('Node.js is not available in this panel');
        files.push({ path, t: m.t0, name: k === 'mix' ? `KX Sound · ${pk.label}` : `KX Sound · ${k}` });
      }
      const r = await call<{ layers: number }>('sfxPlaceMix', { files, replace: this.a.replace });
      toast(`Added ${m.n} sounds as ${r.layers} track${r.layers > 1 ? 's' : ''}`);
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
    if (!this.sel) { toast('Pick a sound in the library first', 'info'); return; }
    if (!inAE) { toast('Preview mode: in After Effects this drops the sound at the playhead', 'info'); return; }
    try {
      const b = await this.selBuffer();
      if (!b) return;
      const name = this.sel.kind === 'lib' ? this.sel.s.name : this.sel.p.name;
      const f = await this.writeWav(b, name);
      if (!f) throw new Error('Node.js is not available in this panel');
      await call('sfxPlace', { files: [{ path: f, t: null, name: 'KX SFX · ' + name, db: 0, pan: 0 }] });
      toast('Sound added at the playhead');
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }
}
