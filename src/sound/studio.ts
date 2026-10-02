import { h, Section, Slider, Seg, Btn, Toggle, toast, refreshAll, clear, Chips } from '../ui/kit';
import { Page, Group } from '../core/page';
import { call, inAE, nodeRequire } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { render, toWav, presetBank, drawWave, CATEGORIES, GENERATORS, type SoundParams, type Preset } from './synth';
import type { Studio } from '../main';

type Pack = 'clean' | 'cinematic' | 'cartoon';
const PACKS: Record<Pack, Record<string, string>> = {
  clean: { hit: 'click', contact: 'pop', cam: 'whoosh', move: 'swish', pop: 'pop', in: 'ui', out: 'swish', appear: 'tick', morph: 'swoosh' },
  cinematic: { hit: 'impact', contact: 'hit', cam: 'whoosh', move: 'whoosh', pop: 'hit', in: 'swoosh', out: 'swish', appear: 'sparkle', morph: 'sweep' },
  cartoon: { hit: 'bubble', contact: 'pop', cam: 'swoosh', move: 'swish', pop: 'pop', in: 'bubble', out: 'laser', appear: 'sparkle', morph: 'magic' },
};
interface SfxEvent { t: number; dur: number; kind: string; strength: number; x: number; layer: string }

export class SoundStudio implements Studio {
  id = 'sound';
  el: HTMLElement;
  private bank = presetBank();
  private cat = 'All';
  private q = '';
  private sel: Preset = this.bank[0];
  private p: SoundParams = { ...this.bank[0].p };
  private grid: HTMLElement;
  private wave: HTMLCanvasElement;
  private ac: AudioContext | null = null;
  private auto = { pack: 'cinematic' as Pack, markers: true, keys: true, inout: true, volume: 0, scope: 'all' as 'all' | 'selected' };
  private favs = new Set<string>(JSON.parse(localStorage.getItem('kinetix.sfx.favs') || '[]'));

  constructor() {
    this.grid = h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } });
    this.wave = h('canvas', { style: { width: '100%', height: '90px', display: 'block', borderRadius: '12px', background: 'var(--bg-deep)' } });
    const search = h('input', { class: 'input', placeholder: `Search ${this.bank.length} sounds…`, style: { fontFamily: 'var(--font-ui)' } }) as HTMLInputElement;
    search.addEventListener('keydown', (e) => e.stopPropagation());
    search.addEventListener('input', () => { this.q = search.value.toLowerCase(); this.renderGrid(); });
    const a = this.auto;
    const P = this.p;
    const sp = (k: keyof SoundParams, label: string, min: number, max: number, step: number) => Slider({ label, min, max, step, get: () => this.p[k] as number, set: (v, f) => { (this.p as any)[k] = v; if (f) this.play(); } });

    const side = [
      Section('Library', [
        search,
        Chips(['All', 'Favorites', ...CATEGORIES].map((c) => ({ value: c, label: c })), () => this.cat, (v) => { this.cat = v; this.renderGrid(); refreshAll(); }),
        h('div', { class: 'hint' }, 'Every sound is synthesised by Kinetix — royalty free, and the Randomize button makes endless new variations.'),
      ], { color: 'var(--lime)' }),
    ];
    const main = [
      h('div', { class: 'panel-card' },
        h('div', { class: 'hstack' }, h('b', { class: 'grow', style: { fontSize: '15px' } }, '⚡ Auto-SFX'), Seg<Pack>([{ value: 'clean', label: 'Clean UI' }, { value: 'cinematic', label: 'Cinematic' }, { value: 'cartoon', label: 'Cartoon' }], () => a.pack, (v) => { a.pack = v; refreshAll(); })),
        h('div', { class: 'hint' }, 'Scans the comp for Kinetix events (bounces, physics hits, camera moves, In/Out animations) and keyframed motion, then places a matching, unique sound on each — panned to where it happens on screen.'),
        h('div', { class: 'row3' }, Toggle('Kinetix markers', () => a.markers, (v) => { a.markers = v; refreshAll(); }), Toggle('Keyframed motion', () => a.keys, (v) => { a.keys = v; refreshAll(); }), Toggle('Layer in/out', () => a.inout, (v) => { a.inout = v; refreshAll(); })),
        h('div', { class: 'row' }, Seg([{ value: 'all', label: 'Whole comp' }, { value: 'selected', label: 'Selected layers' }], () => a.scope, (v) => { a.scope = v; refreshAll(); }), Slider({ label: 'Mix level (dB)', min: -24, max: 6, get: () => a.volume, set: (v) => { a.volume = v; } })),
        Btn('Scan & place sounds', () => this.autoSfx(), { variant: 'primary', size: 'lg', block: true, icon: 'sound' })),
      Group('Sounds', [this.grid]),
    ];
    const right = [
      Section('Sound editor', [
        this.wave,
        (() => { const n = h('b'); setInterval(() => { n.textContent = this.sel.name; }, 300); return n; })(),
        h('div', { class: 'row' }, Btn('Play', () => this.play(), { icon: 'play', variant: 'soft' }), Btn('Randomize', () => { this.p.seed = Math.floor(Math.random() * 99999); this.p.pitch += Math.round((Math.random() - 0.5) * 4); this.play(); refreshAll(); }, { icon: 'dice' })),
        sp('length', 'Length (s)', 0.02, 8, 0.01), sp('pitch', 'Pitch (st)', -24, 24, 1), sp('bright', 'Brightness', 0, 1, 0.01),
        sp('reverb', 'Reverb', 0, 1, 0.01), sp('width', 'Stereo width', 0, 1, 0.01), sp('drive', 'Drive', 0, 1, 0.01), sp('volume', 'Volume (dB)', -30, 0, 0.5),
        h('div', { class: 'row' }, Btn('Add at playhead', () => this.place(), { variant: 'primary', icon: 'send' }), Btn('★', () => { this.favs.has(this.sel.id) ? this.favs.delete(this.sel.id) : this.favs.add(this.sel.id); localStorage.setItem('kinetix.sfx.favs', JSON.stringify([...this.favs])); toast(this.favs.has(this.sel.id) ? 'Saved to favorites' : 'Removed'); }, { title: 'Favorite' })),
      ], { color: 'var(--lime)' }),
    ];
    void P;
    this.el = Page({ title: 'Sound Lab', sub: `${this.bank.length}+ synthesised sound effects and Auto-SFX that scores your animation in one click.`, side, main, right }).el;
    this.renderGrid();
    registerCommands([
      { id: 'sfx.auto', label: 'Sound: Auto-SFX (scan & place)', group: 'Sound', run: () => this.autoSfx() },
      ...Object.entries(GENERATORS).map(([k, g]) => ({ id: 'sfx.' + k, label: 'Sound: add ' + g.label, group: 'Sound', run: () => { const pr = this.bank.find((b) => b.p.gen === k)!; this.pick(pr); this.place(); } })),
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

  private async play() {
    try {
      const buf = await render(this.p);
      drawWave(buf, this.wave);
      this.ac ??= new AudioContext();
      const s = this.ac.createBufferSource();
      s.buffer = buf;
      s.connect(this.ac.destination);
      s.start();
    } catch (e: any) { toast('Audio: ' + e.message, 'err'); }
  }

  /** Render → WAV file next to the project → import & place in AE. */
  private async writeWav(p: SoundParams, name: string): Promise<string | null> {
    const buf = await render(p);
    const req = nodeRequire();
    if (!req) return null;
    const fs = req('fs'), path = req('path'), os = req('os');
    let dir: string | null = null;
    try { dir = await call<string | null>('sfxFolder'); } catch { /* */ }
    dir ??= path.join(os.homedir(), 'Documents', 'Kinetix SFX');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name.replace(/[^a-z0-9 _-]+/gi, '').replace(/\s+/g, '_')}_${p.seed}_${Date.now() % 100000}.wav`);
    fs.writeFileSync(file, Buffer.from(toWav(buf)));
    return file;
  }

  private async place() {
    if (!inAE) { toast('Preview mode: in After Effects this saves a WAV and drops it at the playhead', 'info'); return; }
    try {
      const f = await this.writeWav(this.p, this.sel.name);
      if (!f) throw new Error('Node.js is not available in this panel');
      await call('sfxPlace', { files: [{ path: f, t: null, name: this.sel.name, db: 0, pan: 0 }] });
      toast('Sound added at the playhead');
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }

  private async autoSfx() {
    const a = this.auto;
    let events: SfxEvent[];
    try { events = await call<SfxEvent[]>('sfxScan', { markers: a.markers, keys: a.keys, inout: a.inout, scope: a.scope }); }
    catch (e: any) { toast(e.message, 'err', 6000); return; }
    if (!events?.length) { toast('No animation events found in this comp', 'info'); return; }
    events.sort((x, y) => x.t - y.t);
    // don't stack sounds closer than 60 ms
    const kept: SfxEvent[] = [];
    for (const e of events) if (!kept.length || e.t - kept[kept.length - 1].t > 0.06 || e.kind !== kept[kept.length - 1].kind) kept.push(e);
    if (!inAE) { toast(`Preview mode: would place ${kept.length} sounds (${[...new Set(kept.map((k) => k.kind))].join(', ')})`, 'info', 5000); return; }
    toast(`Synthesising ${kept.length} sounds…`, 'info', 2500);
    const files: { path: string; t: number; name: string; db: number; pan: number }[] = [];
    let i = 0;
    for (const e of kept) {
      const gen = PACKS[a.pack][e.kind] ?? 'swoosh';
      const base = this.bank.find((b) => b.p.gen === gen)!.p;
      const G = GENERATORS[gen];
      const whooshy = ['whoosh', 'swoosh', 'swish', 'sweep', 'riser', 'revcymbal'].includes(gen);
      const len = whooshy && e.dur > 0.05 ? Math.min(G.len[1] * 2, Math.max(G.len[0], e.dur)) : base.length;
      const p: SoundParams = { ...base, length: len, seed: base.seed * 31 + (i++) * 977, pitch: base.pitch + Math.round((Math.random() - 0.5) * 3), width: 0.5 };
      const path = await this.writeWav(p, `KX ${G.label}`);
      if (!path) break;
      const start = whooshy && e.kind !== 'hit' ? Math.max(0, e.t - (e.dur > 0.05 ? 0 : len * 0.5)) : e.t;
      files.push({ path, t: start, name: `KX SFX · ${G.label}`, db: a.volume - 14 + e.strength * 12, pan: (e.x - 0.5) * 2 * 0.8 });
    }
    try { const r = await call<{ layers: number }>('sfxPlace', { files }); toast(`Auto-SFX: ${r.layers} sounds placed`); }
    catch (e: any) { toast(e.message, 'err', 6000); }
  }
}
