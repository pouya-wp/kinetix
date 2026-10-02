// Rigid-body simulation of AE layers with Matter.js, recorded per frame for baking.

import Matter from 'matter-js';
import { rng } from '../core/math';

export interface PhysLayer { index: number; name: string; cx: number; cy: number; w: number; h: number; rot: number; offX: number; offY: number; pos: number[]; kind: string }
export type BodyShape = 'auto' | 'box' | 'circle';
export interface PhysParams {
  recipe: string; gravity: number; bounce: number; friction: number; air: number; duration: number; strength: number; seed: number;
  floor: boolean; walls: boolean; ceiling: boolean; floorOffset: number; shape: BodyShape; spin: boolean;
}
export interface Frame { x: Float32Array; y: Float32Array; a: Float32Array }
export interface SimResult { frames: Frame[]; hits: { t: number; index: number; speed: number; x: number }[]; fps: number }

export const RECIPES: { id: string; label: string; sub: string; set?: Partial<PhysParams> }[] = [
  { id: 'fall', label: 'Fall & Stack', sub: 'drop and pile up', set: { gravity: 1, bounce: 0.35, friction: 0.4, air: 0.01 } },
  { id: 'rain', label: 'Rain In', sub: 'fall in from above', set: { gravity: 1, bounce: 0.3, friction: 0.5 } },
  { id: 'explode', label: 'Explode', sub: 'burst from the center', set: { gravity: 0.8, bounce: 0.4, friction: 0.3, strength: 1 } },
  { id: 'scatter', label: 'Scatter Out', sub: 'fly apart, no gravity', set: { gravity: 0, bounce: 0.6, friction: 0.05, air: 0.02 } },
  { id: 'magnet', label: 'Magnet', sub: 'pulled to the center', set: { gravity: 0, bounce: 0.2, friction: 0.6, air: 0.04 } },
  { id: 'vortex', label: 'Vortex', sub: 'swirl around the center', set: { gravity: 0, bounce: 0.3, air: 0.02 } },
  { id: 'float', label: 'Float / Bubbles', sub: 'rise and drift', set: { gravity: -0.15, bounce: 0.5, air: 0.06, ceiling: true } },
  { id: 'zerog', label: 'Zero-G Drift', sub: 'slow space tumble', set: { gravity: 0, bounce: 0.9, friction: 0, air: 0.002 } },
  { id: 'arena', label: 'Bounce Arena', sub: 'never stop bouncing', set: { gravity: 0, bounce: 1, friction: 0, air: 0, ceiling: true, walls: true } },
  { id: 'wind', label: 'Wind', sub: 'blown sideways', set: { gravity: 0.6, bounce: 0.3, air: 0.03 } },
  { id: 'domino', label: 'Domino', sub: 'tip the first one over', set: { gravity: 1, bounce: 0.05, friction: 0.6 } },
  { id: 'wrecking', label: 'Wrecking Ball', sub: 'first layer swings into the rest', set: { gravity: 1, bounce: 0.2, friction: 0.5 } },
  { id: 'chain', label: 'Chain / Rope', sub: 'layers linked, first one pinned', set: { gravity: 1, bounce: 0.1, air: 0.02 } },
  { id: 'jelly', label: 'Spring Home', sub: 'knocked loose, springs back', set: { gravity: 0, bounce: 0.5, air: 0.05 } },
  { id: 'tornado', label: 'Tornado', sub: 'lifted and spun upward', set: { gravity: 0.2, bounce: 0.3, air: 0.03, ceiling: false } },
];

export function simulate(L: PhysLayer[], p: PhysParams, comp: { w: number; h: number; fps: number }): SimResult {
  const { Engine, Bodies, Body, Composite, Constraint, Events } = Matter;
  const engine = Engine.create({ enableSleeping: false });
  engine.gravity.y = p.gravity;
  const rand = rng(p.seed);
  const W = comp.w, H = comp.h;
  const statics: Matter.Body[] = [];
  const T = 400;
  if (p.floor) statics.push(Bodies.rectangle(W / 2, H - p.floorOffset + T / 2, W * 4, T, { isStatic: true, friction: p.friction }));
  if (p.walls) statics.push(Bodies.rectangle(-T / 2, H / 2, T, H * 6, { isStatic: true }), Bodies.rectangle(W + T / 2, H / 2, T, H * 6, { isStatic: true }));
  if (p.ceiling) statics.push(Bodies.rectangle(W / 2, -T / 2, W * 4, T, { isStatic: true }));
  const bodies = L.map((l, i) => {
    const circle = p.shape === 'circle' || (p.shape === 'auto' && Math.abs(l.w - l.h) < Math.min(l.w, l.h) * 0.12 && l.kind !== 'text');
    let y = l.cy;
    if (p.recipe === 'rain') y = l.cy - H - i * 120 - rand() * 200;
    const opts: Matter.IChamferableBodyDefinition = { restitution: p.bounce, friction: p.friction, frictionAir: p.air, angle: (l.rot * Math.PI) / 180, density: 0.001 };
    const b = circle ? Bodies.circle(l.cx, y, Math.max(4, Math.min(l.w, l.h) / 2), opts) : Bodies.rectangle(l.cx, y, Math.max(4, l.w), Math.max(4, l.h), opts);
    return b;
  });
  Composite.add(engine.world, [...statics, ...bodies]);
  const cx = W / 2, cy = H / 2;
  const k = p.strength;
  // recipe setup
  if (p.recipe === 'explode' || p.recipe === 'scatter') {
    bodies.forEach((b) => {
      const dx = b.position.x - cx, dy = b.position.y - cy, d = Math.hypot(dx, dy) || 1;
      const sp = (18 + rand() * 12) * k;
      Body.setVelocity(b, { x: (dx / d) * sp, y: (dy / d) * sp - (p.recipe === 'explode' ? 8 * k : 0) });
      if (p.spin) Body.setAngularVelocity(b, (rand() - 0.5) * 0.4 * k);
    });
  }
  if (p.recipe === 'zerog' || p.recipe === 'arena') bodies.forEach((b) => { Body.setVelocity(b, { x: (rand() - 0.5) * 14 * k, y: (rand() - 0.5) * 14 * k }); if (p.spin) Body.setAngularVelocity(b, (rand() - 0.5) * 0.08 * k); });
  if (p.recipe === 'domino' && bodies[0]) Body.setAngularVelocity(bodies[0], 0.06 * k);
  if (p.recipe === 'wrecking' && bodies[0]) {
    const b = bodies[0];
    const anchor = { x: b.position.x - 500, y: Math.min(b.position.y - 500, 0) };
    Composite.add(engine.world, Constraint.create({ pointA: anchor, bodyB: b, length: Math.hypot(b.position.x - anchor.x, b.position.y - anchor.y), stiffness: 1 }));
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setMass(b, b.mass * 12);
  }
  if (p.recipe === 'chain' && bodies.length) {
    Composite.add(engine.world, Constraint.create({ pointA: { x: bodies[0].position.x, y: bodies[0].position.y - L[0].h / 2 }, bodyB: bodies[0], pointB: { x: 0, y: -L[0].h / 2 }, stiffness: 1, length: 0 }));
    for (let i = 1; i < bodies.length; i++) {
      const a = bodies[i - 1], b = bodies[i];
      Composite.add(engine.world, Constraint.create({ bodyA: a, bodyB: b, pointA: { x: 0, y: L[i - 1].h / 2 }, pointB: { x: 0, y: -L[i].h / 2 }, stiffness: 0.9, length: 10 }));
    }
    Body.setVelocity(bodies[bodies.length - 1], { x: 25 * k, y: 0 });
  }
  const homes = bodies.map((b) => ({ x: b.position.x, y: b.position.y }));
  if (p.recipe === 'jelly') {
    bodies.forEach((b, i) => {
      Composite.add(engine.world, Constraint.create({ pointA: homes[i], bodyB: b, stiffness: 0.015, damping: 0.02, length: 0 }));
      const dx = b.position.x - cx, dy = b.position.y - cy, d = Math.hypot(dx, dy) || 1;
      Body.setVelocity(b, { x: (dx / d) * 30 * k, y: (dy / d) * 30 * k });
      Body.setAngularVelocity(b, (rand() - 0.5) * 0.3 * k);
    });
  }
  // collisions → hit markers (for Auto-SFX)
  const hits: SimResult['hits'] = [];
  let time = 0;
  Events.on(engine, 'collisionStart', (ev) => {
    for (const pair of ev.pairs) {
      const sp = Math.hypot(pair.bodyA.velocity.x - pair.bodyB.velocity.x, pair.bodyA.velocity.y - pair.bodyB.velocity.y);
      if (sp < 4) continue;
      for (const b of [pair.bodyA, pair.bodyB]) {
        const i = bodies.indexOf(b);
        if (i >= 0 && (!hits.length || hits[hits.length - 1].index !== L[i].index || time - hits[hits.length - 1].t > 0.12)) hits.push({ t: time, index: L[i].index, speed: sp, x: b.position.x / W });
      }
    }
  });
  const fps = comp.fps, nF = Math.ceil(p.duration * fps) + 1, SUB = 4;
  const dtMs = 1000 / fps / SUB;
  const frames: Frame[] = [];
  const noiseSeed = rand() * 100;
  for (let f = 0; f < nF; f++) {
    frames.push({ x: Float32Array.from(bodies, (b) => b.position.x), y: Float32Array.from(bodies, (b) => b.position.y), a: Float32Array.from(bodies, (b) => b.angle) });
    for (let s = 0; s < SUB; s++) {
      time = (f + s / SUB) / fps;
      // continuous forces
      bodies.forEach((b, i) => {
        const dx = cx - b.position.x, dy = cy - b.position.y, d = Math.hypot(dx, dy) || 1;
        const m = b.mass;
        switch (p.recipe) {
          case 'magnet': Body.applyForce(b, b.position, { x: (dx / d) * 0.0012 * m * k, y: (dy / d) * 0.0012 * m * k }); break;
          case 'vortex': Body.applyForce(b, b.position, { x: ((-dy / d) * 0.0011 + (dx / d) * 0.0004) * m * k, y: ((dx / d) * 0.0011 + (dy / d) * 0.0004) * m * k }); break;
          case 'tornado': Body.applyForce(b, b.position, { x: ((-dy / d) * 0.0012 + (dx / d) * 0.0003) * m * k, y: -0.0011 * m * k }); break;
          case 'wind': { const gust = 0.6 + 0.4 * Math.sin(time * 1.7 + noiseSeed + i * 0.3); Body.applyForce(b, b.position, { x: 0.0009 * m * k * gust, y: 0 }); break; }
          case 'float': Body.applyForce(b, b.position, { x: Math.sin(time * 1.3 + i * 1.7 + noiseSeed) * 0.00012 * m * k, y: 0 }); break;
        }
      });
      Engine.update(engine, dtMs);
    }
  }
  return { frames, hits, fps };
}
