// Trace text or images into morphable outlines.
// Raster → coverage field → marching squares → simplified loops. Holes (the inside of an
// "o", a ring, a logo cut-out) are joined to their outer outline with an invisible zero-width
// bridge, so every piece is ONE closed path that still renders and morphs with its hole.
import { contour } from './metaball';
import { rdp, signedArea, bbox, pointInPoly, centroid, type Poly } from './geometry';
import type { Vec } from '../core/math';
import type { PathData } from '../core/state';

export interface Piece { poly: Poly; cx: number; cy: number; area: number }

function field(data: Uint8ClampedArray, W: number, H: number, mode: 'alpha' | 'dark' | 'light', thr: number) {
  const v = new Float32Array((W + 2) * (H + 2)).fill(0.5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4, a = data[k + 3] / 255;
    const lum = (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255;
    const ink = mode === 'alpha' ? a : mode === 'dark' ? (1 - lum) * a : lum * a;
    v[(y + 1) * (W + 2) + x + 1] = thr - ink; // negative inside
  }
  return { nx: W + 2, ny: H + 2, x0: -1, y0: -1, cell: 1, v };
}

/** Loops (outer CW, holes CCW) from a canvas, in canvas pixels. */
export function traceCanvas(ctx: CanvasRenderingContext2D, W: number, H: number, mode: 'alpha' | 'dark' | 'light' = 'alpha', thr = 0.5, detail = 0.6): Poly[] {
  const data = ctx.getImageData(0, 0, W, H).data;
  const minArea = W * H * 0.00015 + 4;
  return contour(field(data, W, H, mode, thr)).map((l) => rdp(l, detail)).filter((l) => l.length > 2 && Math.abs(signedArea(l)) > minArea);
}

/** Join every hole into its enclosing outline with a zero-width bridge. */
export function keyhole(loops: Poly[]): Poly[] {
  // the biggest loop is always an outline; loops winding the same way are outlines, the rest holes
  const biggest = loops.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  const outerSign = Math.sign(signedArea(biggest));
  const outers = loops.filter((l) => Math.sign(signedArea(l)) === outerSign);
  const holes = loops.filter((l) => !outers.includes(l));
  const result = outers.map((o) => o.slice());
  for (const hole of holes) {
    // the smallest outer that contains the hole
    let best = -1, ba = Infinity;
    result.forEach((o, i) => { const a = Math.abs(signedArea(o)); if (a < ba && pointInPoly(hole[0], o)) { ba = a; best = i; } });
    if (best < 0) continue;
    const o = result[best];
    // closest vertex pair
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < o.length; i++) for (let j = 0; j < hole.length; j += Math.max(1, Math.floor(hole.length / 60))) {
      const d = (o[i][0] - hole[j][0]) ** 2 + (o[i][1] - hole[j][1]) ** 2;
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    const hr = [...hole.slice(bj), ...hole.slice(0, bj), hole[bj]];
    result[best] = [...o.slice(0, bi + 1), ...hr, ...o.slice(bi)];
  }
  return result;
}

/** Chain several outlines into one path (for "one shape becomes the whole word"). */
export function chain(polys: Poly[]): Poly {
  const sorted = [...polys].sort((a, b) => centroid(a)[0] - centroid(b)[0]);
  let out = sorted[0].slice();
  for (const p of sorted.slice(1)) {
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < out.length; i += Math.max(1, Math.floor(out.length / 120))) for (let j = 0; j < p.length; j += Math.max(1, Math.floor(p.length / 60))) {
      const d = (out[i][0] - p[j][0]) ** 2 + (out[i][1] - p[j][1]) ** 2;
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    const pr = [...p.slice(bj), ...p.slice(0, bj), p[bj]];
    out = [...out.slice(0, bi + 1), ...pr, ...out.slice(bi)];
  }
  return out;
}

function pieces(loops: Poly[], scale: number, ox: number, oy: number): Piece[] {
  if (!loops.length) return [];
  return keyhole(loops).map((p) => {
    const q = p.map((v) => [v[0] * scale + ox, v[1] * scale + oy] as Vec);
    const c = centroid(q);
    return { poly: q, cx: c[0], cy: c[1], area: Math.abs(signedArea(q)) };
  }).sort((a, b) => a.cx - b.cx);
}

/** Outline a word / line of text, centred on (0,0), `height` px tall (cap height ≈ height). */
export function tracedText(text: string, font: string, weight: number, height: number): Piece[] {
  const R = 220; // raster cap size
  const cv = document.createElement('canvas');
  const css = `${weight} ${R}px "${font}", "Inter Variable", Inter, Arial, sans-serif`;
  let ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.font = css;
  const rows = text.split(/\n/);
  const w = Math.max(...rows.map((r) => ctx.measureText(r).width));
  cv.width = Math.ceil(w + R * 0.6); cv.height = Math.ceil(R * 1.35 * rows.length + R * 0.4);
  ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.font = css; ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  rows.forEach((r, i) => ctx.fillText(r, cv.width / 2, R * 1.05 + i * R * 1.25));
  const loops = traceCanvas(ctx, cv.width, cv.height, 'alpha', 0.5, 0.45);
  if (!loops.length) return [];
  const b = bbox(loops.flat());
  const s = height / Math.max(1, b.h);
  return pieces(loops, s, -(b.x0 + b.w / 2) * s, -(b.y0 + b.h / 2) * s);
}

/** Outline an image (logo, icon, silhouette), centred on (0,0) and fitted into `size` px. */
export async function tracedImage(file: File, size: number, mode: 'alpha' | 'dark' | 'light', thr: number): Promise<Piece[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image')); i.src = url; });
    const M = 420, k = Math.min(1, M / Math.max(img.width, img.height));
    const W = Math.max(8, Math.round(img.width * k)), H = Math.max(8, Math.round(img.height * k));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, W, H);
    // a photo with no transparency falls back to brightness
    let opaque = true; const d = ctx.getImageData(0, 0, W, H).data;
    for (let i = 3; i < d.length; i += 4 * 37) if (d[i] < 250) { opaque = false; break; }
    const m = mode === 'alpha' && opaque ? 'dark' : mode;
    const loops = traceCanvas(ctx, W, H, m, thr, 0.7);
    if (!loops.length) return [];
    const b = bbox(loops.flat());
    const s = size / Math.max(1, b.w, b.h);
    // tiny specks are noise in a morph
    const ps = pieces(loops, s, -(b.x0 + b.w / 2) * s, -(b.y0 + b.h / 2) * s);
    const big = Math.max(...ps.map((p) => p.area));
    return ps.filter((p) => p.area > big * 0.01).slice(0, 40);
  } finally { URL.revokeObjectURL(url); }
}

/** Straight-segment path around a local origin (keeps letter corners crisp). */
export function polyPath(poly: Poly, cx: number, cy: number): PathData {
  const v = poly.map((p) => [p[0] - cx, p[1] - cy] as Vec);
  return { v, i: v.map(() => [0, 0] as Vec), o: v.map(() => [0, 0] as Vec), closed: true };
}
