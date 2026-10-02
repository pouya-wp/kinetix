import { describe, it, expect } from 'vitest';
import { simulate, worldPieces, type PhysLayer, type PhysParams } from '../src/physics/sim';

const P: PhysParams = { recipe: 'fall', gravity: 1, bounce: 0.2, friction: 0.5, air: 0.01, duration: 4, strength: 1, seed: 1, floor: true, walls: true, ceiling: false, floorOffset: 0, shape: 'auto', spin: false };
const comp = { w: 1920, h: 1080, fps: 30 };
const L_SHAPE = [[-110, -110], [-30, -110], [-30, 50], [110, 50], [110, 110], [-110, 110]];
const circle = (r: number) => Array.from({ length: 40 }, (_, k) => [Math.cos((k / 40) * Math.PI * 2) * r, Math.sin((k / 40) * Math.PI * 2) * r]);
const layer = (name: string, frames: number[][][][], x = 960, y = 300, morphing = false): PhysLayer => ({ index: 1, name, cx: x, cy: y, w: 220, h: 220, rot: 0, offX: 0, offY: 0, pos: [x, y], kind: 'shape', outlines: frames, anchor: [0, 0], scale: [100, 100], morphing });

describe('exact-shape physics', () => {
  it('splits a concave outline into convex pieces', () => {
    const pcs = worldPieces(layer('L', [[L_SHAPE]]), L_SHAPE ? [L_SHAPE] : [], { x: 0, y: 0 }, 0);
    expect(pcs.length).toBeGreaterThan(1);
  });

  it('a concave L rests on the floor without sinking', () => {
    const r = simulate([layer('L', [[L_SHAPE]])], P, comp);
    const last = r.frames[r.frames.length - 1];
    // the L's lowest point is 110 px below its anchor: it must rest on y = 1080
    expect(last.y[0] + 110).toBeGreaterThan(1060);
    expect(last.y[0] + 110).toBeLessThan(1092);
  });

  it('a morphing outline keeps colliding as it changes', () => {
    // big circle shrinking to a small one over 2 s while falling
    const frames = Array.from({ length: 121 }, (_, f) => [circle(140 - Math.min(1, f / 60) * 90)]);
    const r = simulate([layer('morph', frames, 960, 300, true)], { ...P, duration: 4 }, comp);
    const last = r.frames[r.frames.length - 1];
    // final radius is 50: the anchor (centre) settles ~50 px above the floor
    expect(1080 - last.y[0]).toBeGreaterThan(35);
    expect(1080 - last.y[0]).toBeLessThan(70);
  });

  it('records the anchor, so baking needs no offset math', () => {
    const r = simulate([layer('L', [[L_SHAPE]], 500, 500)], { ...P, gravity: 0 }, comp);
    expect(r.frames[0].x[0]).toBeCloseTo(500, 3);
    expect(r.frames[0].y[0]).toBeCloseTo(500, 3);
    expect(r.frames[0].a[0]).toBeCloseTo(0, 5);
  });
});

describe('Newton-style worlds', () => {
  const box = (w: number, h: number) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  it('a ball stays inside a container layer', () => {
    const cont = { ...layer('Box', [[box(600, 400)]], 960, 540), index: 1, role: 'container' as const };
    const ball = { ...layer('Ball', [[circle(30)]], 960, 450), index: 2 };
    const open = { ...P, floor: false, walls: false, explode: 0, recipe: 'zerog', gravity: 1 };
    const r = simulate([cont, ball], open, comp);
    for (const fr of r.frames) {
      expect(fr.y[1]).toBeLessThan(540 + 200);
      expect(Math.abs(fr.x[1] - 960)).toBeLessThan(300);
    }
  });
  it('a ball on a rope hangs instead of falling, and the rope is recorded', () => {
    const ball = layer('Ball', [[circle(30)]], 960, 300);
    const r = simulate([ball], { ...P, joints: [{ a: 0, b: null, type: 'rope', slack: 0.05 }] }, comp);
    const last = r.frames[r.frames.length - 1];
    expect(last.y[0]).toBeLessThan(500);
    expect(r.links.length).toBe(1);
    expect(r.links[0].pts.length).toBe(r.frames.length);
    expect(r.links[0].pts[0].length).toBeGreaterThan(4);
  });
  it('a fixed layer never moves', () => {
    const shelf = { ...layer('Shelf', [[box(400, 40)]], 960, 600), role: 'static' as const };
    const r = simulate([shelf], P, comp);
    expect(r.frames[r.frames.length - 1].y[0]).toBeCloseTo(600, 1);
  });
});
