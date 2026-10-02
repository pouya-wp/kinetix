import { describe, it, expect } from 'vitest';
import { planTimeline, matchGlyphs, parseSRT } from '../src/text/plan';
import { wordIndex } from '../src/text/glyphs';
import type { TextLine } from '../src/core/state';

const line = (t0: number, t1: number, text = 'x'): TextLine => ({ id: text + t0, layer: 0, name: text, text, t0, t1, font: 'Inter', size: 60, color: '#fff', x: 0, y: 0, justify: 'center' });
const opts = { dur: 0.4, minDur: 0.1, maxDur: 0.8, intro: false, outro: false };

describe('timeline planning', () => {
  const lines = [line(0, 2), line(2.5, 4), line(3.9, 6), line(6, 8)]; // gap, overlap, touch
  for (const policy of ['fill', 'close', 'center', 'keep'] as const) {
    it(`${policy}: segments are ordered, gap-free and cover the lines`, () => {
      const segs = planTimeline(lines, { ...opts, policy });
      for (let i = 1; i < segs.length; i++) expect(segs[i].t0).toBeGreaterThanOrEqual(segs[i - 1].t1 - 1e-9);
      expect(segs[0].t0).toBeCloseTo(0);
      expect(segs[segs.length - 1].t1).toBeCloseTo(8);
      for (const s of segs) expect(s.t1).toBeGreaterThan(s.t0);
    });
  }
  it('fill lands the morph exactly when the next line starts', () => {
    const segs = planTimeline(lines, { ...opts, policy: 'fill' });
    const tr = segs.find((s) => s.kind === 'trans' && s.from === 0)!;
    expect(tr.t1).toBeCloseTo(2.5);
    expect(tr.t1 - tr.t0).toBeCloseTo(0.5);
  });
  it('keep leaves an empty gap with out/in halves', () => {
    const segs = planTimeline([line(0, 2), line(3, 5)], { ...opts, policy: 'keep' });
    expect(segs.map((s) => s.kind)).toEqual(['hold', 'out', 'in', 'hold']);
  });
});

describe('glyph matching', () => {
  const g = (t: string) => { const w = wordIndex(t); return { glyphs: w.chars.map((ch, i) => ({ ch, word: w.word[i] })), words: w.words }; };
  it('keeps shared words and letters', () => {
    const a = g('Today we build something'), b = g('Today we build something amazing');
    const m = matchGlyphs(a.glyphs, b.glyphs, a.words, b.words);
    expect(m.pairs.length).toBe(a.glyphs.length);
    expect(m.exits).toEqual([]);
    expect(m.enters.length).toBe('amazing'.length);
  });
  it('matches letters inside changed words', () => {
    const a = g('Watch the letters move'), b = g('Watch the words morph');
    const m = matchGlyphs(a.glyphs, b.glyphs, a.words, b.words);
    expect(m.pairs.length + m.enters.length).toBe(b.glyphs.length);
    expect(m.pairs.length + m.exits.length).toBe(a.glyphs.length);
    expect(m.pairs.length).toBeGreaterThan('Watchthe'.length);
  });
});

describe('srt', () => {
  it('parses blocks', () => {
    const s = parseSRT('1\n00:00:01,000 --> 00:00:02,500\nHello <i>world</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond\nline\n');
    expect(s).toEqual([{ t0: 1, t1: 2.5, text: 'Hello world' }, { t0: 3, t1: 4, text: 'Second\nline' }]);
  });
});
