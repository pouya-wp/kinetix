import { describe, it, expect } from 'vitest';
import { analyze, sizePitch, tunedPitches, type SampleSet } from '../src/sound/analyze';

const fps = 30;
function set(layers: SampleSet['layers']): SampleSet { return { fps, t0: 0, comp: { w: 1920, h: 1080 }, layers }; }
const base = { inPoint: 0, outPoint: 10, size: [120, 120] as [number, number], textKeys: [], pathKeys: [], markers: [] };
const all = { motion: true, text: true, morph: true, markers: true, cuts: false };

describe('auto-sfx analysis', () => {
  it('finds a move and the landing of a dropped object', () => {
    // falls for 1 s with gravity, then rests
    const pos = Array.from({ length: 60 }, (_, f) => { const t = f / fps; return [960, t < 1 ? 100 + 800 * t * t : 900]; });
    const ev = analyze(set([{ ...base, name: 'drop', index: 1, pos }]), all);
    const land = ev.find((e) => e.kind === 'land');
    expect(ev.some((e) => e.kind === 'move')).toBe(true);
    expect(land).toBeTruthy();
    expect(Math.abs(land!.t - 1)).toBeLessThan(0.1);
  });
  it('finds a scale pop and an opacity appear', () => {
    const scale = Array.from({ length: 60 }, (_, f) => (f < 20 ? 0 : Math.min(100, (f - 20) * 15)));
    const op = Array.from({ length: 60 }, (_, f) => (f < 30 ? 0 : 100));
    const ev = analyze(set([{ ...base, name: 'p', index: 1, scale }, { ...base, name: 'o', index: 2, op }]), all);
    const pop = ev.find((e) => e.kind === 'pop');
    const ap = ev.find((e) => e.kind === 'appear');
    expect(pop && Math.abs(pop.t - 19 / fps) < 0.1).toBe(true);
    expect(ap && Math.abs(ap.t - 29 / fps) < 0.1).toBe(true);
  });
  it('turns text keys into typing ticks and morphs into squishes', () => {
    const ev = analyze(set([{ ...base, name: 't', index: 1, textKeys: [1, 1.1, 1.2], pathKeys: [2, 2.5] }]), all);
    expect(ev.filter((e) => e.kind === 'type').length).toBe(3);
    expect(ev.filter((e) => e.kind === 'morph').length).toBe(1);
  });
  it('smaller things sound higher; quick runs climb a scale', () => {
    expect(sizePitch(40)).toBeGreaterThan(sizePitch(800));
    const p = tunedPitches([0, 0.1, 0.2, 2].map((t) => ({ t } as any)));
    expect(p[1]).toBeGreaterThan(p[0]);
    expect(p[2]).toBeGreaterThan(p[1]);
    expect(p[3]).toBe(0);
  });
});
