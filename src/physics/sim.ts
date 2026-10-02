// Rigid-body simulation of AE layers with Matter.js, recorded per frame for baking.
// Shape layers use their exact outline (concave shapes are split into convex
// parts); when the outline animates (morphs), the body is rebuilt every frame
// while keeping its position, velocity and spin.

import Matter from 'matter-js';
import decomp from 'poly-decomp';
import { rng } from '../core/math';
import { rdp, signedArea } from '../shapes/geometry';

export interface PhysLayer {
  index: number; name: string; cx: number; cy: number; w: number; h: number; rot: number; offX: number; offY: number; pos: number[]; kind: string;
  /** exact outlines (shape layers): frames → polygons → points, in layer space */
  outlines?: number[][][][]; anchor?: number[]; scale?: number[]; morphing?: boolean;
}
export type BodyShape = 'auto' | 'box' | 'circle';
export interface PhysParams {
  recipe: string; gravity: number; bounce: number; friction: number; air: number; duration: number; strength: number; seed: number;
  floor: boolean; walls: boolean; ceiling: boolean; floorOffset: number; shape: BodyShape; spin: boolean;
}
/** per frame: layer anchor position (x, y) and layer rotation (radians) */
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

Matter.Common.setDecomp(decomp);

type V = { x: number; y: number };
interface KBody { body: Matter.Body; anchorRel: V; aBase: number; frame: number; i: number }

const rot = (p: V, a: number): V => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });

/** Layer-space outline → convex pieces in world space for anchor A and layer angle th. */
export function worldPieces(l: PhysLayer, polys: number[][][], A: V, th: number): V[][] {
  const an = l.anchor ?? [0, 0], sc = l.scale ?? [100, 100];
  const out: V[][] = [];
  for (const poly of polys) {
    let pts = poly.map((q) => [(q[0] - an[0]) * sc[0] / 100, (q[1] - an[1]) * sc[1] / 100] as [number, number]);
    if (pts.length > 64) pts = rdp(pts, 1.2) as [number, number][];
    if (pts.length < 3 || Math.abs(signedArea(pts)) < 4) continue;
    const d: number[][] = pts.map((q) => [q[0], q[1]]);
    decomp.makeCCW(d);
    decomp.removeCollinearPoints(d, 0.02);
    let parts: number[][][] = [];
    try { parts = d.length >= 3 && decomp.isSimple(d) ? decomp.quickDecomp(d) : []; } catch { parts = []; }
    if (!parts.length) parts = [Matter.Vertices.hull(d.map((q) => ({ x: q[0], y: q[1] })) as any).map((v: V) => [v.x, v.y])];
    for (const pc of parts) {
      if (pc.length < 3) continue;
      out.push(pc.map((q) => { const r = rot({ x: q[0], y: q[1] }, th); return { x: A.x + r.x, y: A.y + r.y }; }));
    }
  }
  return out;
}

function bodyFromPieces(pieces: V[][], opts: Matter.IBodyDefinition): Matter.Body | null {
  const parts = pieces
    .filter((pc) => Math.abs(Matter.Vertices.area(pc as any, false)) > 2)
    .map((pc) => { const c = Matter.Vertices.centre(pc as any); return Matter.Bodies.fromVertices(c.x, c.y, [pc as any], opts as any); })
    .filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return Matter.Body.create({ ...opts, parts });
}

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
  const opts: Matter.IChamferableBodyDefinition = { restitution: p.bounce, friction: p.friction, frictionAir: p.air, density: 0.001 };
  const useExact = (l: PhysLayer) => !!l.outlines?.length && p.shape === 'auto';

  const kb: KBody[] = L.map((l, i) => {
    const dy = p.recipe === 'rain' ? -(H + i * 120 + rand() * 200) : 0;
    const A: V = { x: l.pos[0], y: l.pos[1] + dy };
    const th = (l.rot * Math.PI) / 180;
    let b: Matter.Body | null = useExact(l) ? bodyFromPieces(worldPieces(l, l.outlines![0], A, th), opts) : null;
    if (!b) {
      const circle = p.shape === 'circle' || (p.shape === 'auto' && Math.abs(l.w - l.h) < Math.min(l.w, l.h) * 0.12 && l.kind !== 'text');
      b = circle ? Bodies.circle(l.cx, l.cy + dy, Math.max(4, Math.min(l.w, l.h) / 2), { ...opts, angle: th }) : Bodies.rectangle(l.cx, l.cy + dy, Math.max(4, l.w), Math.max(4, l.h), { ...opts, angle: th });
    }
    (b as any).kxIndex = i;
    return { body: b, anchorRel: rot({ x: A.x - b.position.x, y: A.y - b.position.y }, -b.angle), aBase: b.angle - th, frame: 0, i };
  });
  const bodies = () => kb.map((q) => q.body);
  Composite.add(engine.world, [...statics, ...bodies()]);
  const cx = W / 2, cy = H / 2;
  const k = p.strength;
  const constraints: Matter.Constraint[] = [];
  const addC = (c: Matter.Constraint) => { constraints.push(c); Composite.add(engine.world, c); };
  const B = bodies();
  if (p.recipe === 'explode' || p.recipe === 'scatter') {
    B.forEach((b) => {
      const dx = b.position.x - cx, dy = b.position.y - cy, d = Math.hypot(dx, dy) || 1;
      const sp = (18 + rand() * 12) * k;
      Body.setVelocity(b, { x: (dx / d) * sp, y: (dy / d) * sp - (p.recipe === 'explode' ? 8 * k : 0) });
      if (p.spin) Body.setAngularVelocity(b, (rand() - 0.5) * 0.4 * k);
    });
  }
  if (p.recipe === 'zerog' || p.recipe === 'arena') B.forEach((b) => { Body.setVelocity(b, { x: (rand() - 0.5) * 14 * k, y: (rand() - 0.5) * 14 * k }); if (p.spin) Body.setAngularVelocity(b, (rand() - 0.5) * 0.08 * k); });
  if (p.recipe === 'domino' && B[0]) Body.setAngularVelocity(B[0], 0.06 * k);
  if (p.recipe === 'wrecking' && B[0]) {
    const b = B[0];
    const anchor = { x: b.position.x - 500, y: Math.min(b.position.y - 500, 0) };
    addC(Constraint.create({ pointA: anchor, bodyB: b, length: Math.hypot(b.position.x - anchor.x, b.position.y - anchor.y), stiffness: 1 }));
    Body.setMass(b, b.mass * 12);
  }
  if (p.recipe === 'chain' && B.length) {
    addC(Constraint.create({ pointA: { x: B[0].position.x, y: B[0].position.y - L[0].h / 2 }, bodyB: B[0], pointB: { x: 0, y: -L[0].h / 2 }, stiffness: 1, length: 0 }));
    for (let i = 1; i < B.length; i++) addC(Constraint.create({ bodyA: B[i - 1], bodyB: B[i], pointA: { x: 0, y: L[i - 1].h / 2 }, pointB: { x: 0, y: -L[i].h / 2 }, stiffness: 0.9, length: 10 }));
    Body.setVelocity(B[B.length - 1], { x: 25 * k, y: 0 });
  }
  if (p.recipe === 'jelly') {
    B.forEach((b) => {
      addC(Constraint.create({ pointA: { x: b.position.x, y: b.position.y }, bodyB: b, stiffness: 0.015, damping: 0.02, length: 0 }));
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
      const A = pair.bodyA.parent, Bb = pair.bodyB.parent;
      const sp = Math.hypot(A.velocity.x - Bb.velocity.x, A.velocity.y - Bb.velocity.y);
      if (sp < 4) continue;
      for (const b of [A, Bb]) {
        const i = (b as any).kxIndex;
        if (i === undefined) continue;
        if (!hits.length || hits[hits.length - 1].index !== L[i].index || time - hits[hits.length - 1].t > 0.12) hits.push({ t: time, index: L[i].index, speed: sp, x: b.position.x / W });
      }
    }
  });

  const anchorOf = (q: KBody): V => { const r = rot(q.anchorRel, q.body.angle); return { x: q.body.position.x + r.x, y: q.body.position.y + r.y }; };
  const angleOf = (q: KBody) => q.body.angle - q.aBase;

  /** The outline changed (morphing shape): rebuild the body, keep its motion. */
  const rebuild = (q: KBody, f: number) => {
    const l = L[q.i];
    const fi = Math.min(f, l.outlines!.length - 1);
    if (fi === q.frame) return;
    const A = anchorOf(q), th = angleOf(q);
    const nb = bodyFromPieces(worldPieces(l, l.outlines![fi], A, th), opts);
    q.frame = fi;
    if (!nb) return;
    const old = q.body;
    Body.setVelocity(nb, old.velocity);
    Body.setAngularVelocity(nb, old.angularVelocity);
    (nb as any).kxIndex = q.i;
    Composite.remove(engine.world, old);
    Composite.add(engine.world, nb);
    for (const c of constraints) { if (c.bodyA === old) c.bodyA = nb; if (c.bodyB === old) c.bodyB = nb; }
    q.body = nb;
    q.anchorRel = rot({ x: A.x - nb.position.x, y: A.y - nb.position.y }, -nb.angle);
    q.aBase = nb.angle - th;
  };

  const fps = comp.fps, nF = Math.ceil(p.duration * fps) + 1, SUB = 4;
  const dtMs = 1000 / fps / SUB;
  const frames: Frame[] = [];
  const noiseSeed = rand() * 100;
  for (let f = 0; f < nF; f++) {
    for (const q of kb) if (L[q.i].morphing && useExact(L[q.i])) rebuild(q, f);
    const an = kb.map(anchorOf);
    frames.push({ x: Float32Array.from(an, (v) => v.x), y: Float32Array.from(an, (v) => v.y), a: Float32Array.from(kb, angleOf) });
    for (let s = 0; s < SUB; s++) {
      time = (f + s / SUB) / fps;
      kb.forEach((q, i) => {
        const b = q.body;
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

/** World outline of a layer for the preview (exact shapes when available). */
export function previewPieces(l: PhysLayer, f: number, x: number, y: number, a: number): V[][] | null {
  if (!l.outlines?.length) return null;
  return worldPieces(l, l.outlines[Math.min(f, l.outlines.length - 1)], { x, y }, a);
}
