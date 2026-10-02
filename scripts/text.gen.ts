// Builds a Liquid Glass (flow) text payload from scripts/out/analyze2.json (AE analyze without outlines).
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { initialState } from '../src/core/state';
import { TextEngine } from '../src/text/engine';
import { buildTextPayload } from '../src/text/export';
import { makeGlyph, wordIndex, type LineGeo } from '../src/text/glyphs';

it('flow text payload', () => {
  const raw = JSON.parse(readFileSync('scripts/out/analyze2.json', 'utf8'));
  if (!raw.ok) throw new Error(raw.err);
  const a = raw.r;
  const s = initialState();
  Object.assign(s.comp, { w: a.comp.w, h: a.comp.h, fps: a.comp.fps, duration: a.comp.duration, name: a.comp.name });
  s.text.lines = a.lines.map((l: any, i: number) => ({ ...l, id: 'ln' + i }));
  s.text.style = 'flow';
  s.text.dur = 0.6;
  s.text.box.style = 'spring';
  // Node has no canvas: approximate glyph boxes (only bounds matter for the box + lifespans)
  const geos = new Map<string, LineGeo>();
  for (const l of s.text.lines) {
    const w = wordIndex(l.text);
    const cw = l.size * 0.55, total = w.chars.length * cw;
    const glyphs = w.chars.map((ch, i) => { const x = l.x - total / 2 + i * cw, y = l.y - l.size * 0.7; return makeGlyph(ch, [[[x, y], [x + cw * 0.8, y], [x + cw * 0.8, y + l.size * 0.7], [x, y + l.size * 0.7]]], w.word[i]); });
    geos.set(l.id, { id: l.id, text: l.text, glyphs, words: w.words });
  }
  const eng = new TextEngine(() => ({ text: s.text, fps: s.comp.fps }));
  eng.sync(s.text.lines, geos);
  const p = buildTextPayload(eng, s.text, s.comp, s.text.lines);
  writeFileSync('scripts/out/text-payload.json', JSON.stringify(p));
  console.log('flow windows', p.flow, 'lines', p.lines.map((l) => [l.useOrig, l.orig, l.in.toFixed(2), l.out.toFixed(2)]));
});
