// Generates host payloads from the real engines for the AE integration test.
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initialState, newBall } from '../src/core/state';
import { buildPayload } from '../src/bounce/export';
import { buildShapesPayload } from '../src/shapes/export';
import { PRESETS } from '../src/shapes/library';

const out = (name: string, data: unknown) => writeFileSync(`scripts/out/${name}.json`, JSON.stringify(data));

it('bounce payloads', () => {
  const s = initialState();
  const b = newBall(1);
  b.start = [200, 300];
  b.rot.mode = 'roll';
  b.bounces = [
    { id: 'a', x: 420, y: 900, arc: 0, travel: 0.5, hang: 0, follow: false, hangEase: 30, squash: 0.35, stretch: 0.25, squashTime: 0.08 },
    { id: 'b', x: 800, y: 900, arc: 380, travel: 0.4, hang: 0.05, follow: true, hangEase: 30, squash: 0.3, stretch: 0.2, squashTime: 0.08 },
    { id: 'c', x: 1100, y: 900, arc: 200, travel: 0.4, hang: 0.03, follow: true, hangEase: 30, squash: 0.2, stretch: 0.15, squashTime: 0.07 },
  ];
  const p = newBall(2, '#4cc9f0');
  p.mode = 'physics';
  p.start = [300, 200];
  p.phys.duration = 3;
  out('bounce-smart', buildPayload([b, p], s.comp, 'smart', 'new'));
  out('bounce-expr', buildPayload([b], s.comp, 'expression', 'new'));
});

it('shape payloads', () => {
  const s = initialState();
  for (const id of ['morph', 'split', 'jelly']) {
    const part = PRESETS.find((p) => p.id === id)!.build(s.comp.w, s.comp.h, s.comp.duration);
    s.shapes.items = part.items!; s.shapes.groups = part.groups!; s.shapes.loop = !!part.loop;
    out('shapes-' + id, buildShapesPayload({ shapes: s.shapes, comp: s.comp }, 'auto'));
  }
  // a plain morph with no behaviors → sparse, editable keys
  const part = PRESETS.find((p) => p.id === 'morph')!.build(s.comp.w, s.comp.h, s.comp.duration);
  part.items![0].behaviors = [];
  s.shapes.items = part.items!; s.shapes.groups = [];
  out('shapes-sparse', buildShapesPayload({ shapes: s.shapes, comp: s.comp }, 'auto'));
});
