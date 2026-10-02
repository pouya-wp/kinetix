import { describe, it, expect } from 'vitest';
import { analyzeScan, segment, type Scan, type Track } from '../src/sound/gestures';

const fps = 30;
const opts = { motion: true, text: true, morph: true, markers: true, cuts: false, density: 'rich' as const };
function track(name: string, n: number, f: (t: number) => { x?: number; y?: number; s?: number; r?: number; o?: number }): Track {
  const T: Track = { name, kind: 'shape', inner: false, inPoint: 0, outPoint: n / fps, x: [], y: [], s: [], r: [], o: [], markers: [], textKeys: [], pathKeys: [], type: null, inout: null };
  for (let i = 0; i < n; i++) { const v = f(i / fps); T.x.push(v.x ?? 960); T.y.push(v.y ?? 540); T.s.push(v.s ?? 150); T.r.push(v.r ?? 0); T.o.push(v.o ?? 100); }
  return T;
}
const scan = (layers: Track[], w = 1920, h = 1080): Scan => ({ fps, t0: 0, end: Math.max(...layers.map((l) => l.x.length)) / fps, comp: { w, h }, layers });

describe('auto-sfx v3 gestures', () => {
  it('a drop is one gesture with a landing at the impact', () => {
    const ev = analyzeScan(scan([track('drop', 60, (t) => ({ y: t < 1 ? 100 + 800 * t * t : 900 }))]), opts);
    const land = ev.filter((e) => e.role === 'land');
    expect(land.length).toBe(1);
    expect(Math.abs(land[0].t - 1)).toBeLessThan(0.07);
    // a single primary sound for the whole fall, not a stream of fragments
    expect(ev.filter((e) => !e.accent).length).toBe(1);
  });

  it('bounces become decaying accents', () => {
    const y = (t: number) => { if (t < 0.6) return 150 + 750 * (t / 0.6) ** 2; const k = t - 0.6; const per = [0.5, 0.35]; const hts = [300, 140]; if (k < per[0]) { const u = k / per[0]; return 900 - hts[0] * 4 * u * (1 - u); } if (k < per[0] + per[1]) { const u = (k - per[0]) / per[1]; return 900 - hts[1] * 4 * u * (1 - u); } return 900; };
    const ev = analyzeScan(scan([track('ball', 70, (t) => ({ y: y(t) }))]), opts);
    const hits = ev.filter((e) => e.role === 'bounce' || e.role === 'land').sort((a, b) => a.t - b.t);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(hits[0].t - 0.6)).toBeLessThan(0.1);
    expect(hits[hits.length - 1].strength).toBeLessThanOrEqual(hits[0].strength);
  });

  it('pop-ins of three cards form one stagger group that climbs', () => {
    const cards = [0, 1, 2].map((i) => track('card' + i, 60, (t) => { const p = Math.max(0, Math.min(1, (t - 0.5 - i * 0.12) / 0.3)); return { s: p * 260, o: p > 0 ? 100 : 0 }; }));
    const ev = analyzeScan(scan(cards), opts).filter((e) => e.role === 'enter');
    expect(ev.length).toBe(3);
    expect(new Set(ev.map((e) => e.group)).size).toBe(1);
    expect(ev.map((e) => e.step)).toEqual([0, 1, 2]);
  });

  it('a fast slide is a whoosh aligned to its speed peak', () => {
    const ev = analyzeScan(scan([track('slide', 60, (t) => { const q = Math.max(0, Math.min(1, (t - 0.3) / 0.5)); return { x: -300 + 1500 * (1 - Math.pow(1 - q, 3)) }; })]), opts);
    const w = ev.find((e) => e.role === 'whoosh');
    expect(w).toBeTruthy();
    expect(w!.peak! - w!.t).toBeLessThan(0.2);
  });

  it('is resolution independent (same events at 4K)', () => {
    const mk = (k: number) => [track('drop', 60, (t) => ({ y: (t < 1 ? 100 + 800 * t * t : 900) * k, x: 960 * k, s: 150 * k }))];
    const a = analyzeScan(scan(mk(1)), opts).map((e) => e.role + Math.round(e.t * 30));
    const b = analyzeScan(scan(mk(2), 3840, 2160), opts).map((e) => e.role + Math.round(e.t * 30));
    expect(b).toEqual(a);
  });

  it('typing ticks follow the Kinetix Type timing', () => {
    const t = track('title', 60, () => ({}));
    t.kind = 'text';
    t.type = { text: 'Hello', basedOn: 1, hasIn: true, hasOut: false, inDur: 0.2, outDur: null, stagger: 0.06, fit: 0, inT: 0.5, outT: 2 };
    const ev = analyzeScan(scan([t]), opts).filter((e) => e.role === 'type');
    expect(ev.length).toBe(5);
    expect(ev[1].t - ev[0].t).toBeCloseTo(0.06, 3);
  });

  it('segmentation merges tiny gaps and ignores noise', () => {
    const E = [0, 0.05, 0.6, 0.9, 0.1, 0.12, 0.7, 0.2, 0, 0, 0, 0.05, 0];
    expect(segment(E, 30).length).toBe(1);
  });
});

import { blendPacks } from '../src/sound/mixer';
describe('mixing sound styles', () => {
  it('blends sources from every picked style', () => {
    const p = blendPacks(['tickle', 'water']);
    const cats = (p.map.enter ?? []).map((s) => ('cat' in s ? s.cat : s.synth));
    expect(cats).toContain('pop');
    expect(cats).toContain('water');
    expect(p.mixAll).toBe(true);
  });
  it('a per-motion override wins over the styles', () => {
    const p = blendPacks(['tickle'], { impact: ['mallet'] });
    expect((p.map.land ?? []).every((s) => 'cat' in s && s.cat === 'mallet')).toBe(true);
  });
});
