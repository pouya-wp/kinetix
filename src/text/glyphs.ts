// Glyph geometry. In AE the real outlines come from "Create Shapes from Text";
// in the browser (and as a fallback) glyphs are rasterised and contoured.

import type { TextLine } from '../core/state';
import type { Vec } from '../core/math';
import { contour } from '../shapes/metaball';
import { rdp, signedArea, bbox, flatten, type Poly } from '../shapes/geometry';
import type { PathData } from '../core/state';

export interface Glyph {
  ch: string;
  /** contours relative to the glyph centre (cx, cy) */
  contours: Poly[];
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** index of the word this glyph belongs to */
  word: number;
  /** exact bezier outlines relative to the centre (when they came from AE) */
  paths?: PathData[];
}
export interface LineGeo { id: string; text: string; glyphs: Glyph[]; words: string[] }

/** Build glyph records from absolute contours (comp space). */
export function makeGlyph(ch: string, abs: Poly[], word: number): Glyph {
  const all = abs.flat();
  const b = all.length ? bbox(all) : { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return { ch, contours: abs.map((c) => c.map((p) => [p[0] - cx, p[1] - cy] as Vec)), cx, cy, w: b.w, h: b.h, word };
}

/** Split text into words, returning for each non-space char its word index. */
export function wordIndex(text: string): { chars: string[]; word: number[]; words: string[] } {
  const chars: string[] = [], word: number[] = [], words: string[] = [];
  let w = -1, inWord = false;
  for (const ch of Array.from(text)) {
    if (/\s/.test(ch)) { inWord = false; continue; }
    if (!inWord) { w++; words.push(''); inWord = true; }
    words[w] += ch;
    chars.push(ch);
    word.push(w);
  }
  return { chars, word, words };
}

// ───────── AE outlines → glyphs ─────────
export interface AEGlyphGroup { name: string; paths: PathData[] }
export function glyphsFromAE(line: TextLine, groups: AEGlyphGroup[]): LineGeo {
  const { chars, word, words } = wordIndex(line.text);
  const glyphs: Glyph[] = [];
  groups.forEach((g, i) => {
    const contours = g.paths.map((p) => flatten(p, 6)).filter((c) => c.length > 2);
    const gl = makeGlyph(chars[i] ?? g.name, contours, word[i] ?? 0);
    gl.paths = g.paths.map((p) => ({ v: p.v.map((q) => [q[0] - gl.cx, q[1] - gl.cy] as Vec), i: p.i, o: p.o, closed: p.closed }));
    glyphs.push(gl);
  });
  return { id: line.id, text: line.text, glyphs, words };
}

// ───────── raster fallback ─────────
let cv: HTMLCanvasElement | null = null;
function canvas(w: number, h: number) {
  if (!cv) cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv.getContext('2d', { willReadFrequently: true })!;
}

const fontCss = (l: TextLine) => {
  const f = l.font || 'Inter';
  const bold = /bold|black|heavy|semibold|extrabold/i.test(f) ? '800' : '700';
  const fam = f.replace(/[-_](bold|black|heavy|semibold|extrabold|regular|medium|light)$/i, '');
  return `${bold} ${l.size}px "${fam}", "Inter Variable", Inter, Arial, sans-serif`;
};

/** Outline one character by rasterising it and contouring the coverage field. */
function outlineChar(ch: string, font: string, size: number): { contours: Poly[]; adv: number } {
  const pad = Math.ceil(size * 0.4);
  const w = Math.ceil(size * 1.6) + pad * 2, h = Math.ceil(size * 1.6) + pad * 2;
  const scale = Math.min(1, 160 / size); // rasterise at ≤160px, scale back up
  const W = Math.ceil(w * scale), H = Math.ceil(h * scale);
  const ctx = canvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.font = font.replace(/(\d+(\.\d+)?)px/, `${size * scale}px`);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.fillText(ch, pad * scale, (pad + size) * scale);
  const adv = ctx.measureText(ch).width / scale;
  const data = ctx.getImageData(0, 0, W, H).data;
  const v = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) v[i] = 0.5 - data[i * 4 + 3] / 255; // negative inside
  const loops = contour({ nx: W, ny: H, x0: 0, y0: 0, cell: 1, v });
  const contours = loops
    .map((l) => rdp(l, 0.35))
    .filter((l) => l.length > 2 && Math.abs(signedArea(l)) > 1.5)
    .map((l) => l.map((p) => [p[0] / scale - pad, p[1] / scale - pad - size] as Vec)); // origin at baseline-left
  return { contours, adv };
}

/** Lay out a text line (single or multi-line) and outline every glyph. */
export function rasterLine(line: TextLine): LineGeo {
  const font = fontCss(line);
  const ctx = canvas(10, 10);
  ctx.font = font;
  const rows = line.text.split(/\r\n|\r|\n/);
  const lh = line.size * 1.2;
  const { word, words } = wordIndex(line.text);
  const glyphs: Glyph[] = [];
  let gi = 0;
  rows.forEach((row, r) => {
    ctx.font = font;
    const rowW = ctx.measureText(row).width;
    let x = line.justify === 'center' ? line.x - rowW / 2 : line.justify === 'right' ? line.x - rowW : line.x;
    const y = line.y + (r - (rows.length - 1)) * lh; // last row sits on the anchor baseline
    for (const ch of Array.from(row)) {
      ctx.font = font;
      const adv = ctx.measureText(ch).width;
      if (!/\s/.test(ch)) {
        const o = outlineChar(ch, font, line.size);
        const abs = o.contours.map((c) => c.map((p) => [p[0] + x, p[1] + y] as Vec));
        glyphs.push(makeGlyph(ch, abs, word[gi] ?? 0));
        gi++;
      }
      x += adv;
    }
  });
  return { id: line.id, text: line.text, glyphs, words };
}
