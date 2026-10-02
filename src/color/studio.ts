import { h, Slider, Seg, Btn, Toggle, toast, refreshAll, pickFile } from '../ui/kit';
import { Flow, Step, More, Picks } from '../ui/flow';
import { call } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { LOOKS, NEUTRAL, gradeFx, paintGrade, scaledImage, type Grade } from './grade';
import type { Studio } from '../main';

const LS = 'kinetix.color';

export class ColorStudio implements Studio {
  id = 'color';
  el: HTMLElement;
  private g: Grade = { ...NEUTRAL, ...LOOKS[0].g };
  private look = LOOKS[0].id;
  private strength = 100;
  private target: 'comp' | 'selected' = 'comp';
  private preview: HTMLCanvasElement;
  private user: HTMLImageElement | null = null;
  private thumbs: { c: HTMLCanvasElement; g: Grade }[] = [];
  private queued = false;

  constructor() {
    try { const s = JSON.parse(localStorage.getItem(LS) || '{}'); if (s.g) this.g = { ...NEUTRAL, ...s.g }; if (s.look) this.look = s.look; if (s.strength !== undefined) this.strength = s.strength; } catch { /* first run */ }
    this.preview = h('canvas', { style: { width: '100%', height: '210px', display: 'block', borderRadius: '14px', background: 'var(--bg-deep)' } }) as HTMLCanvasElement;
    const looks = Picks(LOOKS.map((l) => ({ id: l.id, label: l.label, sub: l.sub })), {
      isOn: (t) => t.id === this.look,
      onPick: (t) => { this.look = t.id; this.g = { ...NEUTRAL, ...LOOKS.find((l) => l.id === t.id)!.g }; this.changed(); },
      preview: (t) => { const c = h('canvas') as HTMLCanvasElement; this.thumbs.push({ c, g: { ...NEUTRAL, ...LOOKS.find((l) => l.id === t.id)!.g } }); return c; },
      min: 130,
    });
    const sl = (label: string, k: keyof Grade, min: number, max: number, step = 1, unit = '') =>
      Slider({ label, min, max, step, unit, get: () => this.g[k] as number, set: (v) => { (this.g as any)[k] = v; this.changed(); } });
    const body = [
      this.preview,
      h('div', { class: 'row wrap' },
        Btn('Preview on my own frame…', () => this.loadFrame(), { size: 'sm', variant: 'soft', title: 'Export a still from AE (Composition › Save Frame As) and pick it here' }),
        Btn('Sample image', () => { this.user = null; this.repaint(true); }, { size: 'sm', variant: 'ghost' })),
      Step(1, 'Pick a look', [looks.el]),
      Step(2, 'Adjust', [
        Slider({ label: 'Strength', min: 0, max: 100, unit: ' %', get: () => this.strength, set: (v, f) => { this.strength = v; this.changed(false); if (f) call('gradeStrength', { strength: v }).catch(() => {}); } }),
        h('div', { class: 'row' }, sl('Warmth', 'warmth', -100, 100), sl('Contrast', 'contrast', -50, 100)),
        h('div', { class: 'row' }, sl('Saturation', 'saturation', -100, 100), sl('Fade', 'fade', 0, 100)),
      ]),
      More('color-adv', [
        h('div', { class: 'row' }, sl('Exposure', 'exposure', -2, 2, 0.05, ' st'), sl('Vibrance', 'vibrance', -100, 100)),
        h('div', { class: 'row' }, sl('Tint (green ↔ pink)', 'tint', -100, 100), sl('Teal & orange', 'split', 0, 100)),
        h('div', { class: 'row' }, sl('Vignette', 'vignette', 0, 100), sl('Film grain', 'grain', 0, 100)),
        h('div', { class: 'row' }, sl('Glow', 'glow', 0, 100), Toggle('Black & white', () => this.g.bw, (v) => { this.g.bw = v; this.changed(); })),
        Seg([{ value: 'comp', label: 'Whole comp (adjustment layer)' }, { value: 'selected', label: 'Selected layers only' }], () => this.target, (v) => { this.target = v; }),
        Btn('Remove the colour grade', () => call('gradeRemove').then((ok) => toast(ok ? 'Grade removed' : 'No Kinetix grade in this comp', 'info')).catch((e) => toast(e.message, 'err')), { size: 'sm', variant: 'danger' }),
        h('div', { class: 'hint' }, 'Everything is built from native AE effects (Exposure, Colour Balance, Brightness & Contrast, Vibrance, Glow, CC Vignette, Noise) on one adjustment layer named “KX Color Grade” — tweak it in AE any time.'),
      ], 'More controls'),
    ];
    this.el = Flow({
      title: 'Color', sub: 'Give the whole video a look in one click — then fine-tune warmth, contrast and saturation. Stays fully editable in After Effects.',
      body, action: { label: 'Apply color grade', icon: 'style', need: () => (this.target === 'selected' ? 'layers' : 'comp'), run: () => this.apply() },
    }).el;
    new ResizeObserver(() => this.repaint(true)).observe(this.preview);
    registerCommands(LOOKS.map((l) => ({ id: 'color.' + l.id, label: 'Color: ' + l.label, group: 'Color', keywords: l.sub, run: () => { this.look = l.id; this.g = { ...NEUTRAL, ...l.g }; this.changed(); this.apply(); } })));
  }

  activate() { this.repaint(true); }
  deactivate() {}

  private changed(save = true) {
    if (save) try { localStorage.setItem(LS, JSON.stringify({ g: this.g, look: this.look, strength: this.strength })); } catch { /* storage blocked */ }
    this.repaint(false);
    refreshAll();
  }
  /** Repaint on the next frame (sliders fire fast). */
  private repaint(all: boolean) {
    if (all) this.thumbs.forEach((t) => paintGrade(t.c, t.g));
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      const r = this.preview.getBoundingClientRect();
      const img = this.user && r.width > 2 ? scaledImage(this.user, Math.round(r.width), Math.round(r.height)) : null;
      paintGrade(this.preview, this.g, this.strength / 100, img);
    });
  }
  private async loadFrame() {
    const f = await pickFile('image/*');
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { this.user = img; this.repaint(true); };
    img.src = url;
  }
  private async apply() {
    const L = LOOKS.find((l) => l.id === this.look);
    try {
      const r = await call<{ layers: number; missing: string[] }>('gradeApply', { name: L?.label ?? 'Custom', fx: gradeFx(this.g), strength: this.strength, target: this.target });
      toast(this.target === 'comp' ? `“${L?.label ?? 'Custom'}” grade applied to the whole comp` : `Graded ${r.layers} layer(s)`);
      r.missing?.forEach((m) => toast('Effect not available: ' + m, 'info', 4000));
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }
}
