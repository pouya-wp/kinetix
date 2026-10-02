import { describe, it, expect } from 'vitest';
import { resample, ellipsePath, rectPath, starPath, flatten, signedArea, centroid, pathToPoly, perimeter } from '../src/shapes/geometry';
import { align, morphPoly } from '../src/shapes/morph';
import { mergePolys } from '../src/shapes/metaball';
import { buildKeyed, sample, physicsToKeyed } from '../src/bounce/solver';
import { simulate } from '../src/bounce/physics';
import { newBall } from '../src/core/state';
import { simplifyKeys } from '../src/core/math';

const circle = (cx: number, cy: number, r: number, n = 64) =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r] as [number, number]);

describe('geometry', () => {
  it('resamples by arc length', () => {
    const sq = flatten(rectPath(100, 100), 1);
    const r = resample(sq, 40);
    expect(r).toHaveLength(40);
    const d = r.map((p, i) => Math.hypot(r[(i + 1) % 40][0] - p[0], r[(i + 1) % 40][1] - p[1]));
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(3);
    expect(perimeter(r)).toBeGreaterThan(380);
  });
  it('ellipse path is clockwise in screen space and centred', () => {
    const p = pathToPoly(ellipsePath(200, 100), 64);
    expect(signedArea(p)).toBeGreaterThan(0);
    const c = centroid(p);
    expect(Math.abs(c[0])).toBeLessThan(0.5);
    expect(Math.abs(c[1])).toBeLessThan(0.5);
    expect(Math.abs(signedArea(p) - Math.PI * 100 * 50)).toBeLessThan(400);
  });
});

describe('morph', () => {
  it('align recovers a rotated vertex order', () => {
    const a = circle(0, 0, 100, 48);
    const b = [...a.slice(13), ...a.slice(0, 13)];
    const al = align(a, b);
    al.forEach((p, i) => expect(Math.hypot(p[0] - a[i][0], p[1] - a[i][1])).toBeLessThan(1e-9));
  });
  it('morph endpoints match', () => {
    const a = pathToPoly(ellipsePath(100, 100), 64);
    const b = align(a, pathToPoly(starPath(80, 40, 5), 64));
    for (const mode of ['linear', 'center', 'twist'] as const) {
      const m0 = morphPoly(a, b, 0, mode), m1 = morphPoly(a, b, 1, mode);
      m0.forEach((p, i) => expect(Math.hypot(p[0] - a[i][0], p[1] - a[i][1])).toBeLessThan(1e-6));
      m1.forEach((p, i) => expect(Math.hypot(p[0] - b[i][0], p[1] - b[i][1])).toBeLessThan(1e-6));
    }
  });
});

describe('metaball merge', () => {
  const o = { blend: 60, cell: 4, minArea: 50 };
  it('keeps far shapes separate', () => {
    const loops = mergePolys([circle(0, 0, 50), circle(400, 0, 50)], o);
    expect(loops).toHaveLength(2);
    loops.forEach((l) => expect(signedArea(l)).toBeGreaterThan(0));
  });
  it('bridges close shapes into one blob', () => {
    const loops = mergePolys([circle(0, 0, 50), circle(120, 0, 50)], o);
    expect(loops).toHaveLength(1);
    expect(signedArea(loops[0])).toBeGreaterThan(2 * Math.PI * 50 * 50 * 0.95);
  });
  it('approximates a single circle', () => {
    const loops = mergePolys([circle(0, 0, 80)], o);
    expect(loops).toHaveLength(1);
    expect(Math.abs(signedArea(loops[0]) - Math.PI * 80 * 80) / (Math.PI * 80 * 80)).toBeLessThan(0.03);
  });
});

describe('bounce solver', () => {
  const ball = () => {
    const b = newBall(1);
    b.start = [100, 100];
    b.bounces = [
      { id: 'a', x: 300, y: 700, arc: 0, travel: 0.5, hang: 0, follow: false, hangEase: 0, squash: 0.3, stretch: 0.2, squashTime: 0.08 },
      { id: 'b', x: 600, y: 700, arc: 300, travel: 0.4, hang: 0, follow: true, hangEase: 0, squash: 0.3, stretch: 0.2, squashTime: 0.08 },
    ];
    return b;
  };
  it('hits every contact at the right time', () => {
    const b = ball();
    const tl = buildKeyed(b);
    expect(tl.segs).toHaveLength(2);
    expect(tl.segs[0].tDown).toBeCloseTo(0.5);
    // gravity implied by the first fall: 600px in 0.5s
    const g = (2 * 600) / 0.25;
    expect(tl.segs[1].tDown).toBeCloseTo(Math.sqrt((2 * 300) / g), 5);
    const tc = tl.segs[0].t0 + tl.segs[0].tUp + tl.segs[0].tDown;
    const s = sample(b, tc, 1920, 1080);
    expect(s.x).toBeCloseTo(300, 1);
    expect(s.y).toBeCloseTo(700, 1);
  });
  it('apex height matches arc', () => {
    const b = ball();
    const tl = buildKeyed(b);
    const seg = tl.segs[1];
    const s = sample(b, seg.t0 + seg.tUp, 1920, 1080);
    expect(s.y).toBeCloseTo(400, 0);
  });
  it('physics loses energy and converts to keyed', () => {
    const b = newBall(1);
    b.mode = 'physics';
    b.start = [200, 200];
    b.phys.duration = 4;
    const tr = simulate(b, 1920, 1080);
    const floor = tr.contacts.filter((c) => c.ny < -0.5);
    expect(floor.length).toBeGreaterThan(2);
    for (let i = 1; i < floor.length; i++) expect(floor[i].speed).toBeLessThanOrEqual(floor[i - 1].speed + 1);
    const k = physicsToKeyed(b, 1920, 1080);
    expect(k.bounces.length).toBeGreaterThan(1);
  });
});

describe('key reduction', () => {
  it('keeps corners, drops collinear samples', () => {
    const t = Array.from({ length: 11 }, (_, i) => i);
    const v = t.map((x) => [x < 5 ? x : 10 - x]);
    const idx = simplifyKeys(t, v, [0.01]);
    expect(idx).toEqual([0, 5, 10]);
  });
});
