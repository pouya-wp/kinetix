import { store, type RenderState } from '../core/state';
import { h, Section, Slider, Toggle, Seg, Btn, Field, NumInput, TextInput, Select, toast, refreshAll, onRefresh, modal, clear } from '../ui/kit';
import { call, inAE, hasNode, chooseFolder, nodeRequire, openInExplorer } from '../core/ae-bridge';
import { syncCompFromAE } from '../core/common-ui';
import { PRESETS, resolve, ffmpegArgs, type RenderPreset, type Resolved } from './presets';
import { findFFmpeg, downloadFFmpeg, runFFmpeg, FFMPEG_SOURCE, type Job } from './ffmpeg';
import type { Studio } from '../main';

const S = () => store.state;
const R = () => store.state.render;
const setR = (fn: (r: RenderState) => void) => store.set((s) => fn(s.render));

interface InterResult { path: string; duration: number; hasAudio: boolean; w: number; h: number; comp: string }

export class RenderStudio implements Studio {
  id = 'render';
  el: HTMLElement;
  private cards: HTMLElement;
  private detail: HTMLElement;
  private logEl: HTMLElement;
  private bar: HTMLElement;
  private status: HTMLElement;
  private job: Job | null = null;
  private running = false;
  private multi = false;
  private ffmpegPath: string | null = null;
  private ffStatus: HTMLElement;

  constructor() {
    this.cards = h('div', { class: 'stack', style: { gap: '18px' } });
    this.detail = h('div', { class: 'stack' });
    this.logEl = h('pre', { class: 'mono', style: { margin: '0', maxHeight: '140px', overflow: 'auto', fontSize: '11px', color: 'var(--text-3)', whiteSpace: 'pre-wrap' } });
    this.bar = h('div', { style: { width: '0%' } });
    this.status = h('div', { class: 'hint' }, 'Ready.');
    this.ffStatus = h('div', { class: 'hint' });

    const side = h('div', { class: 'side' },
      this.compSection(),
      this.outputSection(),
      this.engineSection(),
      this.reframeSection(),
    );
    // the render bar lives at the top of the main column so it is always visible
    const what = h('div', { class: 'grow' });
    onRefresh(what, () => {
      const ids = this.multi ? R().batch : [R().preset];
      const names = ids.map((id) => PRESETS.find((p) => p.id === id)?.label ?? id);
      const eng = R().engine === 'ffmpeg' ? (this.ffmpegPath ? 'FFmpeg' : 'AE H.264 (FFmpeg not found)') : R().engine === 'ame' ? 'Media Encoder' : 'AE H.264';
      what.innerHTML = '';
      what.append(h('div', { style: { font: '700 16px var(--font-display)', textTransform: 'uppercase' } }, names.length > 1 ? `${names.length} presets` : names[0] ?? '—'),
        h('div', { class: 'hint' }, `${S().comp.name} · ${eng}${names.length > 1 ? ' · ' + names.join(', ') : ''}`));
    });
    const renderBar = h('div', { class: 'panel-card render-bar' },
      h('div', { class: 'hstack', style: { flexWrap: 'wrap' } }, what,
        Btn('Render now', () => this.renderAll(), { variant: 'primary', size: 'lg', icon: 'render' })),
      h('div', { class: 'progress' }, this.bar),
      h('div', { class: 'hstack' }, h('div', { class: 'grow' }, this.status),
        Btn('Cancel', () => this.cancel(), { size: 'sm', variant: 'danger' }),
        Btn('Open folder', () => this.openFolder(), { size: 'sm', icon: 'folder' })),
      h('details', null, h('summary', { class: 'hint', style: { cursor: 'pointer' } }, 'Log'), this.logEl),
    );
    const main = h('div', { class: 'page-main' },
      h('div', { class: 'page-head' },
        h('div', { class: 'grow' },
          h('div', { class: 'page-title' }, 'Export for every platform'),
          h('div', { class: 'page-sub' }, 'Pick a destination, tweak if you like, and render in one click.'),
        ),
        Toggle('Batch mode', () => this.multi, (v) => { this.multi = v; if (v && !R().batch.length) setR((r) => { r.batch = [r.preset]; }); this.renderCards(); refreshAll(); }),
      ),
      renderBar,
      this.cards,
    );
    const right = h('div', { class: 'side right', style: { width: '330px' } },
      Section('Settings', [this.detail], { color: 'var(--lime)' }),
    );
    this.el = h('div', { class: 'view' }, side, main, right);
    this.renderCards();
    this.renderDetail();
    let sig = '';
    store.subscribe(() => {
      const s = R().preset + '|' + R().batch.join() + '|' + this.multi;
      if (s !== sig) { sig = s; this.renderCards(); this.renderDetail(); }
      refreshAll();
    });
  }

  activate() {
    this.detectFFmpeg();
    if (inAE) syncCompFromAE(true);
  }
  deactivate() {}

  private preset(): RenderPreset { return PRESETS.find((p) => p.id === R().preset) ?? PRESETS[0]; }
  private resolved(p = this.preset()): Resolved { return resolve(p, S().comp, p.id === R().preset ? R().over : {}); }

  // ───────── side ─────────
  private compSection() {
    const info = h('div', { class: 'stack', style: { gap: '4px' } });
    onRefresh(info, () => {
      const c = S().comp;
      info.innerHTML = '';
      info.append(
        h('b', { style: { fontSize: '14px' } }, c.name),
        h('span', { class: 'mono muted', style: { fontSize: '12px' } }, `${c.w}×${c.h} · ${+c.fps.toFixed(3)} fps · ${c.duration.toFixed(2)}s`),
      );
    });
    return Section('Composition', [
      info,
      Btn('Use active AE comp', () => syncCompFromAE(), { size: 'sm', icon: 'sync', variant: 'soft' }),
      Toggle('Render work area only', () => R().useWorkArea, (v) => setR((r) => { r.useWorkArea = v; })),
    ], { color: 'var(--info)' });
  }

  private outputSection() {
    return Section('Output', [
      Field('Folder', TextInput({ get: () => R().outDir, set: (v) => setR((r) => { r.outDir = v; }), placeholder: 'Default: “Kinetix Renders” next to the project' })),
      Btn('Choose folder…', () => { const f = chooseFolder('Render output folder'); if (f) setR((r) => { r.outDir = f; }); else if (!inAE) toast('Folder picker works inside After Effects', 'info'); }, { size: 'sm', icon: 'folder' }),
      Field('File name', TextInput({ get: () => (R().over.name as string) ?? '{comp}_{preset}', set: (v) => setR((r) => { r.over.name = v; }) })),
      h('div', { class: 'hint' }, 'Tokens: {comp} {preset} {w} {h} {fps} {date}'),
      Toggle('Keep the ProRes intermediate', () => R().keepIntermediate, (v) => setR((r) => { r.keepIntermediate = v; })),
    ], { color: 'var(--violet)' });
  }

  private engineSection() {
    return Section('Engine', [
      Seg([
        { value: 'ffmpeg', label: 'FFmpeg', title: 'Exact bitrate, GOP, profile — best quality control' },
        { value: 'native', label: 'AE H.264', title: 'After Effects built-in H.264 (fixed 15/40 Mbps templates)' },
        { value: 'ame', label: 'Media Encoder', title: 'Queue in Adobe Media Encoder' },
      ], () => R().engine, (v) => setR((r) => { r.engine = v; })),
      this.ffStatus,
      Btn('Locate ffmpeg.exe…', () => this.locateFFmpeg(), { size: 'sm' }),
      Btn('Download FFmpeg', () => this.askDownload(), { size: 'sm', variant: 'soft' }),
      Field('Encoder speed', Seg([{ value: 'fast', label: 'Fast' }, { value: 'balanced', label: 'Balanced' }, { value: 'best', label: 'Best' }], () => (R().over.quality as any) ?? 'best', (v) => setR((r) => { r.over.quality = v; }))),
    ], { color: 'var(--lime)' });
  }

  private reframeSection() {
    return Section('Reframe', [
      h('div', { class: 'hint' }, 'When the comp’s aspect ratio differs from the platform (e.g. 16:9 → 9:16), Kinetix builds a wrapper comp:'),
      Seg([
        { value: 'blur', label: 'Blur fill', title: 'Fit the comp and fill the rest with a blurred copy' },
        { value: 'fit', label: 'Fit', title: 'Letterbox — whole frame visible' },
        { value: 'fill', label: 'Fill', title: 'Crop to fill the frame' },
      ], () => R().reframe, (v) => setR((r) => { r.reframe = v; })),
    ], { color: 'var(--text-3)' });
  }

  // ───────── cards ─────────
  private renderCards() {
    clear(this.cards);
    const groups = new Map<string, RenderPreset[]>();
    for (const p of PRESETS) { if (!groups.has(p.platform)) groups.set(p.platform, []); groups.get(p.platform)!.push(p); }
    for (const [platform, list] of groups) {
      const grid = h('div', { class: 'cards' });
      for (const p of list) {
        const on = this.multi ? R().batch.includes(p.id) : R().preset === p.id;
        const r = resolve(p, S().comp, {});
        const ar = p.w && p.h ? p.w / p.h : S().comp.w / S().comp.h;
        const rw = ar >= 1 ? 22 : 22 * ar, rh = ar >= 1 ? 22 / ar : 22;
        const card = h('div', { class: 'card' + (on ? ' on' : '') },
          h('div', { class: 'ratio', style: { width: rw + 'px', height: rh + 'px' } }),
          h('div', { class: 'card-title' }, p.label),
          h('div', { class: 'card-sub' }, p.sub),
          h('div', { class: 'card-meta' }, p.codec === 'prores' ? 'ProRes 422 HQ' : `${r.mbps} Mbps · ${p.codec.toUpperCase()}`),
          p.badge ? h('span', { class: 'badge' + (p.platform === 'Master' ? ' gold' : ''), style: { position: 'absolute', right: '12px', bottom: '12px' } }, p.badge) : null,
        );
        card.addEventListener('click', () => {
          if (this.multi) setR((rr) => { rr.batch = rr.batch.includes(p.id) ? rr.batch.filter((x) => x !== p.id) : [...rr.batch, p.id]; rr.preset = p.id; });
          else setR((rr) => { if (rr.preset !== p.id) { rr.preset = p.id; rr.over = { name: rr.over.name, quality: rr.over.quality }; } });
        });
        grid.appendChild(card);
      }
      this.cards.append(h('div', { class: 'stack', style: { gap: '10px' } }, h('div', { class: 'section-head', style: { padding: '0', cursor: 'default' } }, h('span', { class: 'dot' }), platform), grid));
    }
  }

  private renderDetail() {
    clear(this.detail);
    const p = this.preset();
    const r = () => this.resolved();
    const ov = (k: string) => (v: any) => setR((rr) => { rr.over[k] = v; });
    this.detail.append(...[
      h('div', { class: 'hstack' }, h('b', { class: 'grow', style: { fontSize: '15px' } }, p.label), Btn('Reset', () => setR((rr) => { rr.over = { name: rr.over.name, quality: rr.over.quality }; }), { size: 'sm' })),
      h('div', { class: 'row' },
        Field('Width', NumInput({ get: () => r().w, set: ov('w'), min: 16, max: 8192, int: true })),
        Field('Height', NumInput({ get: () => r().h, set: ov('h'), min: 16, max: 8192, int: true }))),
      h('div', { class: 'row' },
        Field('Frame rate', NumInput({ get: () => r().fps, set: ov('fps'), min: 1, max: 120 })),
        Field('Codec', Select([{ value: 'h264', label: 'H.264' }, { value: 'h265', label: 'H.265 10-bit' }, { value: 'prores', label: 'ProRes 422 HQ' }], () => r().codec, ov('codec')))),
      p.codec !== 'prores' ? Slider({ label: 'Video bitrate (Mbps)', min: 2, max: 120, step: 0.5, get: () => r().mbps, set: (v, f) => store.set((s) => { s.render.over.mbps = v; }, f), begin: () => store.begin() }) : null,
      p.codec !== 'prores' ? Slider({ label: 'Audio (kbps)', min: 96, max: 512, step: 32, get: () => r().audioKbps, set: (v, f) => store.set((s) => { s.render.over.audioKbps = v; }, f), begin: () => store.begin() }) : null,
      h('div', { class: 'stack', style: { gap: '6px' } }, ...p.tips.map((t) => h('div', { class: 'hint', style: { paddingLeft: '10px', borderLeft: '2px solid var(--lime-line)' } }, t))),
      this.commandPreview(),
    ].filter(Boolean) as Node[]);
  }

  private commandPreview() {
    const pre = h('pre', { class: 'mono', style: { margin: '0', padding: '10px', borderRadius: '10px', background: 'var(--glass)', fontSize: '10.5px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-2)' } });
    onRefresh(pre, () => {
      const r = this.resolved();
      pre.textContent = 'ffmpeg ' + ffmpegArgs(r, 'intermediate.mov', 'output.' + (r.codec === 'prores' ? 'mov' : 'mp4'), S().comp.w, S().comp.h, true).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
    });
    return h('details', null, h('summary', { class: 'hint', style: { cursor: 'pointer' } }, 'FFmpeg command'), pre);
  }

  // ───────── ffmpeg ─────────
  private detectFFmpeg() {
    if (!hasNode()) { this.ffStatus.textContent = inAE ? 'Node.js is disabled — FFmpeg engine unavailable.' : 'Preview mode — FFmpeg runs inside After Effects.'; return; }
    this.ffmpegPath = findFFmpeg(R().ffmpeg);
    this.ffStatus.innerHTML = this.ffmpegPath ? `<span class="lime">●</span> FFmpeg found` : `<span style="color:var(--danger)">●</span> FFmpeg not found — download it or pick AE H.264`;
    this.ffStatus.title = this.ffmpegPath ?? '';
  }
  private locateFFmpeg() {
    if (!window.cep?.fs) { toast('Works inside After Effects', 'info'); return; }
    const r = window.cep.fs.showOpenDialogEx(false, false, 'Locate ffmpeg', '', []);
    if (r?.err === 0 && r.data?.[0]) { setR((rr) => { rr.ffmpeg = r.data[0]; }); this.detectFFmpeg(); }
  }
  private askDownload() {
    if (!hasNode()) { toast('Works inside After Effects', 'info'); return; }
    modal((close) => h('div', { class: 'stack' },
      h('h2', null, 'Download FFmpeg?'),
      h('div', { class: 'muted' }, `Source: ${FFMPEG_SOURCE.label}`),
      h('div', { class: 'hint' }, 'It is saved inside the Kinetix extension folder (bin/ffmpeg) and used only for rendering.'),
      h('div', { class: 'row' },
        Btn('Cancel', close),
        Btn('Download', async () => {
          close();
          this.status.textContent = 'Downloading FFmpeg…';
          try {
            const p = await downloadFFmpeg((s) => this.log(s));
            setR((rr) => { rr.ffmpeg = p; });
            this.detectFFmpeg();
            toast('FFmpeg ready');
            this.status.textContent = 'FFmpeg installed.';
          } catch (e: any) { toast(e.message, 'err', 6000); this.status.textContent = e.message; }
        }, { variant: 'primary' })),
    ));
  }

  // ───────── render ─────────
  private log(s: string) {
    this.logEl.textContent = (this.logEl.textContent + '\n' + s).split('\n').slice(-60).join('\n');
    this.logEl.scrollTop = 1e9;
  }
  private progress(p: number, msg?: string) {
    this.bar.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
    if (msg) this.status.textContent = msg;
  }
  private cancel() {
    if (this.job) { this.job.cancel(); this.job = null; }
    this.running = false;
    this.status.textContent = 'Cancelled.';
  }
  private lastOut = '';
  private openFolder() { if (this.lastOut) openInExplorer(this.lastOut); else toast('Nothing rendered yet', 'info'); }

  private outPath(p: RenderPreset, r: Resolved, dir: string, ext: string) {
    const req = nodeRequire();
    const c = S().comp;
    const date = new Date().toISOString().slice(0, 10);
    const name = (r.name || '{comp}_{preset}')
      .replace('{comp}', c.name).replace('{preset}', p.id).replace('{w}', String(r.w)).replace('{h}', String(r.h)).replace('{fps}', String(r.fps)).replace('{date}', date)
      .replace(/[\\/:*?"<>|]+/g, '_');
    const path = req ? req('path') : null;
    return path ? path.join(dir, name + '.' + ext) : `${dir}/${name}.${ext}`;
  }

  private async outDir(): Promise<string> {
    if (R().outDir) return R().outDir;
    const d = await call<string | null>('defaultRenderFolder');
    if (d) return d;
    const req = nodeRequire();
    return req ? req('path').join(req('os').homedir(), 'Desktop', 'Kinetix Renders') : 'Kinetix Renders';
  }

  private async renderAll() {
    if (this.running) return;
    const ids = this.multi ? R().batch : [R().preset];
    if (!ids.length) { toast('Pick at least one preset', 'info'); return; }
    this.running = true;
    this.logEl.textContent = '';
    try {
      for (let i = 0; i < ids.length && this.running; i++) {
        const p = PRESETS.find((x) => x.id === ids[i])!;
        await this.renderOne(p, i, ids.length);
      }
      if (this.running) { this.progress(1, `Done · ${ids.length} file(s)`); toast(`Rendered ${ids.length} file(s)`); }
    } catch (e: any) {
      this.progress(0, 'Failed: ' + e.message);
      this.log(e.message);
      toast(e.message, 'err', 8000);
    } finally { this.running = false; this.job = null; }
  }

  private async renderOne(p: RenderPreset, i: number, n: number) {
    const r = resolve(p, S().comp, p.id === R().preset ? R().over : { name: R().over.name, quality: R().over.quality });
    const base = i / n, span = 1 / n;
    const dir = await this.outDir();
    const ext = r.codec === 'prores' ? 'mov' : 'mp4';
    const out = this.outPath(p, r, dir, ext);
    const engine = R().engine;
    const reframe = { w: r.w, h: r.h, mode: R().reframe };
    this.log(`▶ ${p.label} → ${out}`);
    if (!inAE) {
      this.progress(base + span, 'Preview mode: this is what would run →');
      this.log('ffmpeg ' + ffmpegArgs(r, 'intermediate.mov', out, S().comp.w, S().comp.h, true).join(' '));
      return;
    }
    if (engine === 'native' || engine === 'ame') {
      this.progress(base + span * 0.1, engine === 'ame' ? 'Sending to Media Encoder…' : 'Rendering in After Effects (AE is busy until it finishes)…');
      const res = await call<{ path: string }>(engine === 'ame' ? 'renderAME' : 'renderNative', { out, reframe, useWorkArea: R().useWorkArea, mbps: r.mbps, fps: r.fps });
      this.lastOut = res.path;
      this.progress(base + span, engine === 'ame' ? 'Queued in Media Encoder.' : 'Rendered.');
      return;
    }
    if (!this.ffmpegPath) this.detectFFmpeg();
    if (!this.ffmpegPath) {
      // no FFmpeg: still render, with After Effects' own H.264 encoder
      this.log('FFmpeg not found — using After Effects H.264 instead (download FFmpeg for exact bitrates).');
      this.progress(base + span * 0.1, 'Rendering in After Effects (AE is busy until it finishes)…');
      const res = await call<{ path: string }>('renderNative', { out, reframe, useWorkArea: R().useWorkArea, mbps: r.mbps, fps: r.fps });
      this.lastOut = res.path;
      this.progress(base + span, 'Rendered.');
      this.log('✓ ' + res.path);
      return;
    }
    const req = nodeRequire()!;
    const fs = req('fs'), path = req('path');
    fs.mkdirSync(dir, { recursive: true });
    const inter = path.join(dir, `.kx_${Date.now()}.mov`);
    this.progress(base + span * 0.05, 'Rendering intermediate in After Effects…');
    const ir = await call<InterResult>('renderIntermediate', { out: inter, reframe, useWorkArea: R().useWorkArea });
    this.log(`intermediate ${ir.w}×${ir.h}, ${ir.duration.toFixed(2)}s, audio: ${ir.hasAudio}`);
    this.progress(base + span * 0.5, 'Encoding with FFmpeg…');
    const args = ffmpegArgs(r, ir.path, out, ir.w, ir.h, ir.hasAudio);
    this.log('ffmpeg ' + args.join(' '));
    this.job = runFFmpeg(this.ffmpegPath, args, ir.duration, (pp, line) => { this.progress(base + span * (0.5 + 0.5 * pp), `Encoding ${p.label} · ${Math.round(pp * 100)}%`); if (line) this.status.title = line; });
    try { await this.job.done; } finally {
      this.job = null;
      if (!R().keepIntermediate) try { fs.unlinkSync(ir.path); } catch { /* */ }
    }
    this.lastOut = out;
    this.log('✓ ' + out);
  }
}
