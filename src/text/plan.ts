import type { GapPolicy, TextLine } from '../core/state';

export type Seg =
  | { kind: 'hold'; line: number; t0: number; t1: number }
  | { kind: 'trans'; from: number; to: number; t0: number; t1: number }
  | { kind: 'in'; line: number; t0: number; t1: number }
  | { kind: 'out'; line: number; t0: number; t1: number };

export interface PlanOpts { policy: GapPolicy; dur: number; minDur: number; maxDur: number; intro: boolean; outro: boolean }

export interface GapInfo { gap: number; kind: 'gap' | 'touch' | 'overlap' }
export function gapInfo(a: TextLine, b: TextLine): GapInfo {
  const g = b.t0 - a.t1;
  return { gap: g, kind: Math.abs(g) < 1e-3 ? 'touch' : g > 0 ? 'gap' : 'overlap' };
}

/**
 * Turn sorted subtitle lines into a gap-free sequence of holds and transitions.
 * Transitions never steal more than 45% of a neighbouring line's own time.
 */
export function planTimeline(lines: TextLine[], o: PlanOpts): Seg[] {
  const L = lines;
  if (!L.length) return [];
  const segs: Seg[] = [];
  const clampDur = (d: number) => Math.max(o.minDur, Math.min(o.maxDur, d));
  // transition windows between i and i+1
  const wins: ({ t0: number; t1: number; split?: { out: [number, number]; in: [number, number] } } | null)[] = [];
  for (let i = 0; i < L.length - 1; i++) {
    const a = L[i], b = L[i + 1];
    const gap = b.t0 - a.t1;
    const maxA = Math.max(0.02, (a.t1 - a.t0) * 0.45), maxB = Math.max(0.02, (b.t1 - b.t0) * 0.45);
    let t0: number, t1: number;
    const d = clampDur(o.dur);
    switch (o.policy) {
      case 'fill': {
        if (gap > 0) {
          // the morph uses the gap and ends exactly when the next line starts
          t1 = b.t0; t0 = t1 - clampDur(gap);
        } else { const m = (a.t1 + b.t0) / 2; t0 = m - d / 2; t1 = m + d / 2; }
        break;
      }
      case 'close': t0 = b.t0 - d / 2; t1 = b.t0 + d / 2; break;
      case 'center': { const m = (a.t1 + Math.max(a.t0, b.t0)) / 2; t0 = m - d / 2; t1 = m + d / 2; break; }
      case 'keep': {
        if (gap >= d) {
          wins.push({ t0: a.t1, t1: b.t0, split: { out: [a.t1, a.t1 + d / 2], in: [b.t0 - d / 2, b.t0] } });
          continue;
        }
        const m = (a.t1 + b.t0) / 2; t0 = m - d / 2; t1 = m + d / 2;
        break;
      }
    }
    // keep inside the neighbours' lifetimes
    t0 = Math.max(t0!, a.t0 + 0.02);
    t1 = Math.min(t1!, b.t1 - 0.02);
    if (t1 - t0 > maxA + maxB) { const m = (t0 + t1) / 2; t0 = m - (maxA + maxB) / 2; t1 = m + (maxA + maxB) / 2; }
    if (t1 - t0 < 1 / 120) t1 = t0 + 1 / 120;
    wins.push({ t0, t1 });
  }
  let cursor = L[0].t0;
  if (o.intro) {
    const d = Math.min(clampDur(o.dur), (L[0].t1 - L[0].t0) * 0.45);
    segs.push({ kind: 'in', line: 0, t0: cursor, t1: cursor + d });
    cursor += d;
  }
  for (let i = 0; i < L.length; i++) {
    const w = wins[i];
    const end = w ? (w.split ? w.split.out[0] : w.t0) : o.outro ? L[i].t1 - Math.min(clampDur(o.dur), (L[i].t1 - L[i].t0) * 0.45) : L[i].t1;
    if (end > cursor) segs.push({ kind: 'hold', line: i, t0: cursor, t1: end });
    if (!w) {
      if (o.outro) segs.push({ kind: 'out', line: i, t0: Math.max(cursor, end), t1: L[i].t1 });
      break;
    }
    if (w.split) {
      segs.push({ kind: 'out', line: i, t0: w.split.out[0], t1: w.split.out[1] });
      segs.push({ kind: 'in', line: i + 1, t0: w.split.in[0], t1: w.split.in[1] });
      cursor = w.split.in[1];
    } else {
      segs.push({ kind: 'trans', from: i, to: i + 1, t0: Math.max(cursor, w.t0), t1: w.t1 });
      cursor = w.t1;
    }
  }
  return segs;
}

// ───────── matching ─────────
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { out.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

export interface Match { pairs: [number, number][]; exits: number[]; enters: number[] }

/**
 * Glyph correspondence between two lines: shared words first, then shared
 * letters inside the changed regions, so common letters "travel" (magic move).
 */
export function matchGlyphs(a: { ch: string; word: number }[], b: { ch: string; word: number }[], aw: string[], bw: string[], caseSensitive = false): Match {
  const norm = (s: string) => (caseSensitive ? s : s.toLowerCase());
  const wp = lcs(aw, bw, (x, y) => norm(x) === norm(y));
  const pairs: [number, number][] = [];
  const glyphsOf = (g: { word: number }[], w: number) => g.map((x, i) => (x.word === w ? i : -1)).filter((i) => i >= 0);
  // matched words → glyph by glyph
  for (const [wa, wb] of wp) {
    const ga = glyphsOf(a, wa), gb = glyphsOf(b, wb);
    for (let k = 0; k < Math.min(ga.length, gb.length); k++) pairs.push([ga[k], gb[k]]);
  }
  // changed regions between matched words → letter-level LCS
  const anchors: [number, number][] = [[-1, -1], ...wp, [aw.length, bw.length]];
  for (let k = 0; k < anchors.length - 1; k++) {
    const [a0, b0] = anchors[k], [a1, b1] = anchors[k + 1];
    const ra: number[] = [], rb: number[] = [];
    a.forEach((g, i) => { if (g.word > a0 && g.word < a1) ra.push(i); });
    b.forEach((g, i) => { if (g.word > b0 && g.word < b1) rb.push(i); });
    if (!ra.length || !rb.length) continue;
    for (const [i, j] of lcs(ra, rb, (x, y) => norm(a[x].ch) === norm(b[y].ch))) pairs.push([ra[i], rb[j]]);
  }
  const ma = new Set(pairs.map((p) => p[0])), mb = new Set(pairs.map((p) => p[1]));
  return {
    pairs: pairs.sort((p, q) => p[1] - q[1]),
    exits: a.map((_, i) => i).filter((i) => !ma.has(i)),
    enters: b.map((_, i) => i).filter((i) => !mb.has(i)),
  };
}

// ───────── SRT ─────────
export function parseSRT(src: string): { t0: number; t1: number; text: string }[] {
  const out: { t0: number; t1: number; text: string }[] = [];
  const ts = (s: string) => { const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : 0; };
  for (const block of src.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.trim().split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const text = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (text) out.push({ t0: ts(a), t1: ts(b), text });
  }
  return out;
}
