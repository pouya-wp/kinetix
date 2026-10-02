import type { BallObj, Bounce } from '../core/state';
import { clamp, ease, lerp, type Vec } from '../core/math';
import { simulate, type PhysTrack } from './physics';

/** One sampled ball state. Position is the ball centre in comp pixels. */
export interface BallSample {
  x: number;
  y: number;
  /** scale along deform axis / across it (1 = round) */
  sa: number;
  sb: number;
  /** deform axis angle in degrees (0 = horizontal) */
  axis: number;
  /** layer rotation in degrees (roll / spin) */
  rot: number;
  vx: number;
  vy: number;
  contact: boolean;
}

export interface Segment {
  index: number; // bounce index (arrives at bounces[index])
  p0: Vec;
  p1: Vec;
  apexY: number;
  rise: number;
  fall: number;
  t0: number; // start time (airborne)
  tUp: number;
  tHang: number;
  tDown: number;
  tDwell: number; // contact / squash time at p1
  b: Bounce;
  impact: number; // speed at impact px/s
}

export interface KeyedTimeline { segs: Segment[]; duration: number; start: Vec; g: number }

const MIN_T = 1 / 120;

/** Gravity implied by the first bounce: fall height covered in `travel` seconds. */
function baseGravity(o: BallObj): number {
  if (!o.start || !o.bounces.length) return 2400;
  const b = o.bounces[0];
  const apexY = Math.min(o.start[1], b.y) - Math.max(0, b.arc);
  const fall = Math.max(1, b.y - apexY);
  return (2 * fall) / Math.max(MIN_T, b.travel) ** 2;
}

/** Effective travel (apex → contact) time for a bounce. */
export function effectiveTravel(o: BallObj, i: number, g = baseGravity(o)): number {
  const b = o.bounces[i];
  const prev: Vec = i === 0 ? o.start! : [o.bounces[i - 1].x, o.bounces[i - 1].y];
  const apexY = Math.min(prev[1], b.y) - Math.max(0, b.arc);
  const fall = Math.max(0, b.y - apexY);
  if (i > 0 && b.follow) return Math.max(MIN_T, Math.sqrt((2 * fall) / g));
  return Math.max(MIN_T, b.travel);
}

export function buildKeyed(o: BallObj): KeyedTimeline {
  const segs: Segment[] = [];
  const start: Vec = o.start ?? [0, 0];
  const g = baseGravity(o);
  let t = o.delay;
  let prev = start;
  o.bounces.forEach((b, i) => {
    const p1: Vec = [b.x, b.y];
    const apexY = Math.min(prev[1], p1[1]) - Math.max(0, b.arc);
    const rise = Math.max(0, prev[1] - apexY);
    const fall = Math.max(0, p1[1] - apexY);
    const tDown = effectiveTravel(o, i, g);
    // the up leg obeys the same gravity as the down leg of this arc
    const gl = fall > 0.5 ? (2 * fall) / (tDown * tDown) : g;
    const tUp = rise > 0.5 ? Math.sqrt((2 * rise) / gl) : 0;
    const tHang = Math.max(0, b.hang);
    const tDwell = b.squash > 0 || b.stretch > 0 ? Math.max(0, b.squashTime) : 0;
    segs.push({ index: i, p0: prev, p1, apexY, rise, fall, t0: t, tUp, tHang, tDown, tDwell, b, impact: Math.sqrt(2 * gl * Math.max(1, fall)) });
    t += tUp + tHang + tDown + tDwell;
    prev = p1;
  });
  return { segs, duration: t, start, g };
}

/** Vertical profile f(s) for s in [0,1] → normalised distance from apex. */
function profile(o: BallObj, b: Bounce, s: number) {
  if (o.profile === 'curve') return ease(o.curve, s);
  // physical parabola (p = 2), hang ease flattens the apex (larger p)
  const p = 2 + (b.hangEase / 100) * 2.6;
  return Math.pow(s, p);
}

function rawKeyedPos(o: BallObj, tl: KeyedTimeline, t: number): { p: Vec; seg: Segment | null; phase: 'pre' | 'air' | 'dwell' | 'rest'; w: number } {
  if (!tl.segs.length || t <= tl.segs[0].t0) return { p: tl.start, seg: tl.segs[0] ?? null, phase: 'pre', w: 0 };
  for (const s of tl.segs) {
    const air = s.tUp + s.tHang + s.tDown;
    const local = t - s.t0;
    if (local <= air) {
      const x = lerp(s.p0[0], s.p1[0], air > 0 ? local / air : 1);
      let y: number;
      if (local < s.tUp) y = s.apexY + s.rise * profile(o, s.b, 1 - local / s.tUp);
      else if (local < s.tUp + s.tHang) y = s.apexY;
      else y = s.apexY + s.fall * profile(o, s.b, s.tDown > 0 ? (local - s.tUp - s.tHang) / s.tDown : 1);
      return { p: [x, y], seg: s, phase: 'air', w: local / Math.max(1e-6, air) };
    }
    if (local <= air + s.tDwell) return { p: s.p1, seg: s, phase: 'dwell', w: s.tDwell > 0 ? (local - air) / s.tDwell : 1 };
  }
  const last = tl.segs[tl.segs.length - 1];
  return { p: last.p1, seg: last, phase: 'rest', w: 1 };
}

export function sampleKeyed(o: BallObj, tl: KeyedTimeline, t: number): BallSample {
  const cur = rawKeyedPos(o, tl, t);
  const dt = 1 / 240;
  const a = rawKeyedPos(o, tl, Math.max(0, t - dt)).p;
  const b = rawKeyedPos(o, tl, t + dt).p;
  let vx = (b[0] - a[0]) / (2 * dt), vy = (b[1] - a[1]) / (2 * dt);
  let x = cur.p[0], y = cur.p[1];
  let sa = 1, sb = 1, axis = 0;
  const r = o.radius;

  if (cur.phase === 'air' && cur.seg) {
    const s = cur.seg;
    const speed = Math.hypot(vx, vy);
    const ref = Math.max(1, s.impact);
    // stretch builds near contact (both leaving and arriving)
    const st = s.b.stretch * clamp(speed / ref, 0, 1) ** 1.5;
    // the stretch that carries into this arc comes from the previous bounce's setting
    const prevB = s.index > 0 ? o.bounces[s.index - 1] : null;
    const leaving = cur.w < 0.5 && prevB ? prevB.stretch * clamp(speed / ref, 0, 1) ** 1.5 : st;
    const k = 1 + (cur.w < 0.5 ? leaving : st) * (1 + o.deform.anticipate);
    sa = k;
    sb = o.deform.volume ? 1 / Math.sqrt(k) : 1;
    axis = o.deform.align && speed > 1 ? (Math.atan2(vy, vx) * 180) / Math.PI : 90;
  } else if (cur.phase === 'dwell' && cur.seg) {
    const s = cur.seg;
    const w = cur.w;
    // squash in fast, recover with optional overshoot
    let amt: number;
    const peak = 0.35;
    if (w < peak) amt = Math.sin((w / peak) * Math.PI * 0.5);
    else {
      const u = (w - peak) / (1 - peak);
      amt = Math.cos(u * Math.PI * 0.5) - o.deform.recover * 0.35 * Math.sin(u * Math.PI);
    }
    const sq = s.b.squash * amt;
    // vertical axis squash; ball stays on the floor (bottom anchored)
    sa = 1 - sq; // along normal
    sb = o.deform.volume ? 1 / Math.max(0.2, Math.sqrt(1 - sq)) : 1 + sq * 0.5;
    axis = 90;
    y = s.p1[1] + r * (1 - sa);
    vx = 0; vy = 0;
  }

  // rotation
  let rot = 0;
  if (o.rot.mode === 'roll') rot = (rollDistance(o, tl, t) / r) * (180 / Math.PI);
  else if (o.rot.mode === 'spin') {
    const tt = Math.max(0, t - o.delay);
    const d = Math.max(1e-3, o.rot.decay);
    rot = (o.rot.spin * (1 - Math.exp(-d * tt))) / d;
  }
  return { x, y, sa, sb, axis, rot, vx, vy, contact: cur.phase === 'dwell' };
}

/** Signed horizontal distance travelled up to time t (for rolling). */
function rollDistance(o: BallObj, tl: KeyedTimeline, t: number) {
  const p = rawKeyedPos(o, tl, t).p;
  return p[0] - tl.start[0];
}

// ───────── unified access ─────────
export type Track = { kind: 'keyed'; tl: KeyedTimeline } | { kind: 'physics'; tr: PhysTrack };

const cache = new WeakMap<BallObj, { key: string; track: Track }>();
export function trackOf(o: BallObj, compW: number, compH: number): Track {
  const key = JSON.stringify(o) + compW + 'x' + compH;
  const c = cache.get(o);
  if (c && c.key === key) return c.track;
  const track: Track = o.mode === 'physics'
    ? { kind: 'physics', tr: simulate(o, compW, compH) }
    : { kind: 'keyed', tl: buildKeyed(o) };
  cache.set(o, { key, track });
  return track;
}

export function durationOf(o: BallObj, compW: number, compH: number) {
  const tr = trackOf(o, compW, compH);
  return tr.kind === 'keyed' ? tr.tl.duration : o.delay + tr.tr.duration;
}

export function sample(o: BallObj, t: number, compW: number, compH: number): BallSample {
  const tr = trackOf(o, compW, compH);
  if (tr.kind === 'keyed') {
    if (!o.start) return { x: -9999, y: -9999, sa: 1, sb: 1, axis: 0, rot: 0, vx: 0, vy: 0, contact: false };
    return sampleKeyed(o, tr.tl, t);
  }
  return samplePhysics(o, tr.tr, t);
}

export function samplePhysics(o: BallObj, tr: PhysTrack, t: number): BallSample {
  const n = tr.x.length;
  const f = clamp((t - o.delay) / tr.dt, 0, n - 1);
  const i = Math.min(n - 2, Math.floor(f)), u = f - i;
  const L = (arr: Float32Array) => (n < 2 ? arr[0] : lerp(arr[i], arr[i + 1], u));
  let x = L(tr.x), y = L(tr.y);
  const vx = L(tr.vx), vy = L(tr.vy);
  let rot = 0;
  if (o.rot.mode === 'roll') rot = L(tr.rot);
  else if (o.rot.mode === 'spin') {
    const tt = Math.max(0, t - o.delay), d = Math.max(1e-3, o.rot.decay);
    rot = (o.rot.spin * (1 - Math.exp(-d * tt))) / d;
  }
  let sa = 1, sb = 1, axis = 0;
  const speed = Math.hypot(vx, vy);
  const tt = t - o.delay;
  // squash around contacts
  const st = o.phys.squashTime;
  let squashed = false;
  for (const c of tr.contacts) {
    const d = tt - c.t;
    if (d > -st * 0.5 && d < st) {
      const w = d < 0 ? 1 + d / (st * 0.5) : 1 - d / st;
      const amt = o.phys.squash * clamp(c.speed / 1400, 0, 1) * Math.sin(clamp(w, 0, 1) * Math.PI * 0.5);
      if (amt > 0.002) {
        sa = 1 - amt;
        sb = o.deform.volume ? 1 / Math.sqrt(1 - amt) : 1 + amt * 0.5;
        axis = (Math.atan2(c.ny, c.nx) * 180) / Math.PI;
        // keep the touching side on the surface
        x -= c.nx * o.radius * (1 - sa);
        y -= c.ny * o.radius * (1 - sa);
        squashed = true;
      }
      break;
    }
  }
  if (!squashed && speed > 1) {
    const k = 1 + o.phys.squash * 0.5 * clamp(speed / 2200, 0, 1) ** 1.5;
    sa = k;
    sb = o.deform.volume ? 1 / Math.sqrt(k) : 1;
    axis = o.deform.align ? (Math.atan2(vy, vx) * 180) / Math.PI : 90;
  }
  return { x, y, sa, sb, axis, rot, vx, vy, contact: squashed };
}

/** Convert a physics simulation into editable keyed bounces. */
export function physicsToKeyed(o: BallObj, compW: number, compH: number): Pick<BallObj, 'start' | 'bounces'> {
  const tr = simulate(o, compW, compH);
  const floorHits = tr.contacts.filter((c) => c.ny < -0.5 && c.speed > 60);
  const start: Vec = [tr.x[0], tr.y[0]];
  const bounces: Bounce[] = [];
  let prevIdx = 0;
  for (const c of floorHits) {
    const idx = Math.round(c.t / tr.dt);
    let minY = Infinity;
    for (let k = prevIdx; k <= idx; k++) minY = Math.min(minY, tr.y[k]);
    const p0y = tr.y[prevIdx];
    const arc = Math.max(0, Math.min(p0y, c.y) - minY);
    const apexIdx = (() => { let m = prevIdx; for (let k = prevIdx; k <= idx; k++) if (tr.y[k] < tr.y[m]) m = k; return m; })();
    bounces.push({
      id: 'b' + bounces.length + '_' + Math.random().toString(36).slice(2, 6),
      x: c.x, y: c.y, arc,
      travel: Math.max(MIN_T, (idx - apexIdx) * tr.dt), hang: 0, follow: false, hangEase: 0,
      squash: o.phys.squash * clamp(c.speed / 1400, 0.2, 1), stretch: 0.2, squashTime: o.phys.squashTime,
    });
    prevIdx = idx;
  }
  return { start, bounces };
}
