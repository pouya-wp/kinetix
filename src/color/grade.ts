// Color grading: a small set of plain-language controls, mapped onto native AE effects on
// one adjustment layer (so the grade stays fully editable without Kinetix). The same math
// runs on a sample image in the panel, so tiles and the big preview show the real look.

export interface Grade {
  exposure: number;   // stops, -2..2
  contrast: number;   // -50..100
  saturation: number; // -100..100
  vibrance: number;   // -100..100
  warmth: number;     // -100 (cool) .. 100 (warm)
  tint: number;       // -100 (green) .. 100 (magenta)
  split: number;      // 0..100 teal shadows / orange highlights
  fade: number;       // 0..100 lifted, matte blacks
  vignette: number;   // 0..100
  grain: number;      // 0..100
  glow: number;       // 0..100
  bw: boolean;
}
export const NEUTRAL: Grade = { exposure: 0, contrast: 0, saturation: 0, vibrance: 0, warmth: 0, tint: 0, split: 0, fade: 0, vignette: 0, grain: 0, glow: 0, bw: false };

export const LOOKS: { id: string; label: string; sub: string; g: Partial<Grade> }[] = [
  { id: 'clean', label: 'Clean Pop', sub: 'crisp, punchy, true colours', g: { contrast: 18, vibrance: 35, exposure: 0.1 } },
  { id: 'teal-orange', label: 'Teal & Orange', sub: 'the blockbuster look', g: { split: 60, contrast: 22, vibrance: 15, vignette: 25 } },
  { id: 'warm-film', label: 'Warm Film', sub: 'golden, soft, nostalgic', g: { warmth: 45, fade: 25, contrast: 8, grain: 25, saturation: -8 } },
  { id: 'cool-night', label: 'Cool Night', sub: 'blue, calm, after dark', g: { warmth: -50, exposure: -0.25, contrast: 15, saturation: -15, vignette: 30 } },
  { id: 'moody', label: 'Moody Matte', sub: 'faded blacks, muted colour', g: { fade: 55, saturation: -30, contrast: 10, vignette: 35, split: 20 } },
  { id: 'golden', label: 'Golden Hour', sub: 'sunset warmth and glow', g: { warmth: 60, exposure: 0.1, vibrance: 25, glow: 25, split: 15 } },
  { id: 'pastel', label: 'Pastel', sub: 'airy, light, gentle', g: { exposure: 0.3, contrast: -25, fade: 35, vibrance: 15, saturation: -10, tint: 8 } },
  { id: 'neon', label: 'Neon Night', sub: 'magenta & cyan, glowing', g: { tint: 35, saturation: 35, contrast: 25, glow: 45, warmth: -20 } },
  { id: 'cinematic', label: 'Cinematic', sub: 'dense contrast, cool shadows', g: { contrast: 30, split: 35, saturation: -12, vignette: 40, exposure: -0.1 } },
  { id: 'bleach', label: 'Bleach Bypass', sub: 'gritty, silvery, low colour', g: { saturation: -55, contrast: 45, grain: 30 } },
  { id: 'vintage', label: 'Vintage', sub: 'old print, warm fade, grain', g: { warmth: 35, fade: 45, saturation: -25, grain: 55, vignette: 45, tint: 6 } },
  { id: 'bw', label: 'Black & White', sub: 'rich monochrome', g: { bw: true, contrast: 30, grain: 20, vignette: 30 } },
];

type Fx = { match: string[]; name: string; props: Record<string, number | number[] | boolean> };

/** Native AE effect stack for a grade. */
export function gradeFx(g: Grade): Fx[] {
  const fx: Fx[] = [];
  if (g.exposure || g.fade) fx.push({ match: ['ADBE Exposure2'], name: 'KX Grade Exposure', props: { 'Exposure': g.exposure, 'Offset': (g.fade / 100) * 0.06 } });
  if (g.warmth || g.tint || g.split) {
    const w = g.warmth / 100, t = g.tint / 100, s = g.split / 100;
    fx.push({ match: ['ADBE Color Balance 2'], name: 'KX Grade Balance', props: {
      'Shadow Red Balance': -40 * s, 'Shadow Green Balance': 8 * s - 20 * t, 'Shadow Blue Balance': 45 * s,
      'Midtone Red Balance': 30 * w + 10 * t, 'Midtone Green Balance': -30 * t, 'Midtone Blue Balance': -30 * w + 10 * t,
      'Highlight Red Balance': 30 * s + 15 * w, 'Highlight Green Balance': 6 * s, 'Highlight Blue Balance': -30 * s - 15 * w,
      'Preserve Luminosity': true,
    } });
  }
  if (g.contrast) fx.push({ match: ['ADBE Brightness & Contrast 2'], name: 'KX Grade Contrast', props: { 'Contrast': g.contrast } });
  if (g.vibrance || g.saturation || g.bw) fx.push({ match: ['ADBE Vibrance'], name: 'KX Grade Colour', props: { 'Vibrance': g.bw ? 0 : g.vibrance, 'Saturation': g.bw ? -100 : g.saturation } });
  if (g.glow) fx.push({ match: ['ADBE Glo2'], name: 'KX Grade Glow', props: { 'Glow Threshold': 72, 'Glow Radius': 60, 'Glow Intensity': (g.glow / 100) * 1.2 } });
  if (g.vignette) fx.push({ match: ['CC Vignette'], name: 'KX Grade Vignette', props: { 'Amount': g.vignette * 0.9, 'Angle of View': 40 } });
  if (g.grain) fx.push({ match: ['ADBE Noise'], name: 'KX Grade Grain', props: { 'Amount of Noise': g.grain * 0.12, 'Use Color Noise': false } });
  return fx;
}

// ───────── preview ─────────
const samples = new Map<string, ImageData>();
/** A small colourful scene: sky, sun, hills, skin tone, a lime card. */
function sampleScene(W: number, H: number): ImageData {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#2c5fa8'); sky.addColorStop(0.55, '#e99a5c'); sky.addColorStop(1, '#f2c48a');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff2c8'; g.beginPath(); g.arc(W * 0.72, H * 0.42, H * 0.12, 0, 7); g.fill();
  g.fillStyle = '#2b3a2f'; g.beginPath(); g.moveTo(0, H * 0.7); g.quadraticCurveTo(W * 0.3, H * 0.5, W * 0.6, H * 0.72); g.quadraticCurveTo(W * 0.85, H * 0.82, W, H * 0.66); g.lineTo(W, H); g.lineTo(0, H); g.fill();
  g.fillStyle = '#c98c6a'; g.beginPath(); g.ellipse(W * 0.26, H * 0.58, H * 0.13, H * 0.16, 0, 0, 7); g.fill();
  g.fillStyle = '#d1fe17'; g.fillRect(W * 0.45, H * 0.74, W * 0.16, H * 0.12);
  g.fillStyle = '#ff5a8a'; g.fillRect(W * 0.64, H * 0.78, W * 0.1, H * 0.1);
  return g.getImageData(0, 0, W, H);
}

/** The same grade, applied in JS (approximation of the AE stack, close enough to judge a look). */
export function gradePixels(src: ImageData, g: Grade, strength = 1): ImageData {
  const out = new ImageData(src.width, src.height), d = src.data, o = out.data;
  const W = src.width, H = src.height;
  const ex = Math.pow(2, g.exposure), off = (g.fade / 100) * 0.12, con = 1 + g.contrast / 100;
  const sat = 1 + g.saturation / 100, vib = g.vibrance / 100, w = g.warmth / 100, t = g.tint / 100, sp = g.split / 100;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4;
    let r = d[k] / 255, gg = d[k + 1] / 255, b = d[k + 2] / 255;
    r *= ex; gg *= ex; b *= ex;
    const L = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    // split toning: teal shadows, orange highlights; warmth / tint on mids
    const sh = Math.max(0, 1 - L * 2), hi = Math.max(0, L * 2 - 1);
    r += sp * (-0.08 * sh + 0.07 * hi) + w * 0.07 + t * 0.03; gg += sp * (0.02 * sh + 0.01 * hi) - t * 0.06; b += sp * (0.09 * sh - 0.07 * hi) - w * 0.07 + t * 0.03;
    r = (r - 0.5) * con + 0.5; gg = (gg - 0.5) * con + 0.5; b = (b - 0.5) * con + 0.5;
    const L2 = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), cur = mx - mn;
    const s = g.bw ? 0 : sat * (1 + vib * (1 - Math.min(1, cur * 1.6)));
    r = L2 + (r - L2) * s; gg = L2 + (gg - L2) * s; b = L2 + (b - L2) * s;
    r = r * (1 - off) + off; gg = gg * (1 - off) + off; b = b * (1 - off) + off;
    if (g.glow) { const gl = Math.max(0, L2 - 0.7) * (g.glow / 100) * 1.5; r += gl; gg += gl; b += gl; }
    if (g.vignette) { const dx = x / W - 0.5, dy = y / H - 0.5, v = 1 - (g.vignette / 100) * Math.min(1, (dx * dx + dy * dy) * 2.6); r *= v; gg *= v; b *= v; }
    if (g.grain) { const n = rnd() * (g.grain / 100) * 0.18; r += n; gg += n; b += n; }
    const mix = (a: number, z: number) => Math.round(Math.max(0, Math.min(1, a * strength + z * (1 - strength))) * 255);
    o[k] = mix(r, d[k] / 255); o[k + 1] = mix(gg, d[k + 1] / 255); o[k + 2] = mix(b, d[k + 2] / 255); o[k + 3] = 255;
  }
  return out;
}

export function paintGrade(c: HTMLCanvasElement, g: Grade, strength = 1, img?: ImageData | null) {
  const r = c.getBoundingClientRect();
  const W = Math.max(2, Math.round(r.width)), H = Math.max(2, Math.round(r.height));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const key = W + 'x' + H;
  if (!samples.has(key)) samples.set(key, sampleScene(W, H));
  const base = img && img.width === W && img.height === H ? img : samples.get(key)!;
  c.getContext('2d')!.putImageData(gradePixels(base, g, strength), 0, 0);
}
export function scaledImage(img: HTMLImageElement, W: number, H: number): ImageData {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const k = Math.max(W / img.width, H / img.height);
  g.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
  return g.getImageData(0, 0, W, H);
}
