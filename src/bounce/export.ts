import type { BallObj, Comp } from '../core/state';
import { durationOf, sample, buildKeyed, effectiveTravel, trackOf } from './solver';
import { simplifyKeys, round } from '../core/math';

export type ExportStyle = 'baked' | 'smart' | 'expression';
export type ExportTarget = 'new' | 'selected';

export interface ChannelKeys { t: number[]; v: (number | number[])[] }
export interface BallExport {
  name: string;
  color: number[];
  radius: number;
  marker: boolean;
  /** property -> keys */
  pos: ChannelKeys;
  deformRot: ChannelKeys;
  deformScale: ChannelKeys;
  spin: ChannelKeys;
  expr?: { pos: string; deformRot: string; deformScale: string; spin: string };
  duration: number;
  /** contact markers (KX:contact <strength> x<screen%>) for Auto-SFX */
  markers: { t: number; comment: string }[];
}
export interface BouncePayload { comp: Comp; style: ExportStyle; target: ExportTarget; balls: BallExport[] }

export const hexToRgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Unwrap an angle sequence so keyframes never spin the long way round. */
function unwrap(a: number[]) {
  for (let i = 1; i < a.length; i++) {
    let d = a[i] - a[i - 1];
    while (d > 180) { a[i] -= 360; d -= 360; }
    while (d < -180) { a[i] += 360; d += 360; }
  }
  // deform axis is 180° symmetric — fold large flips (an ellipse at 0° == at 180°)
  return a;
}

function foldAxis(a: number[]) {
  for (let i = 1; i < a.length; i++) {
    let d = a[i] - a[i - 1];
    while (d > 90) { a[i] -= 180; d -= 180; }
    while (d < -90) { a[i] += 180; d += 180; }
  }
  return a;
}

export function buildBallExport(o: BallObj, comp: Comp, style: ExportStyle): BallExport {
  const fps = comp.fps;
  const dur = durationOf(o, comp.w, comp.h);
  const n = Math.max(2, Math.ceil(dur * fps) + 1);
  const t: number[] = [], pos: number[][] = [], axis: number[] = [], scl: number[][] = [], rot: number[] = [];
  for (let f = 0; f < n; f++) {
    const tt = f / fps;
    const s = sample(o, tt, comp.w, comp.h);
    t.push(tt);
    pos.push([round(s.x, 2), round(s.y, 2)]);
    axis.push(s.axis);
    scl.push([round(s.sa * 100, 2), round(s.sb * 100, 2)]);
    rot.push(s.rot);
  }
  foldAxis(axis);
  unwrap(rot);
  // inner spin compensates the deform axis so the ball keeps its own orientation
  const spin = rot.map((r, i) => round(r - axis[i], 2));
  const axisR = axis.map((a) => round(a, 2));
  // When the ball is round, axis rotation is irrelevant: hold it to avoid noisy keys
  for (let i = 0; i < n; i++) {
    if (Math.abs(scl[i][0] - 100) < 0.05 && Math.abs(scl[i][1] - 100) < 0.05 && i > 0) {
      const d = axisR[i] - axisR[i - 1];
      axisR[i] = axisR[i - 1];
      spin[i] = round(spin[i] + d, 2);
    }
  }

  const pick = (vals: number[][], tol: number[]): ChannelKeys => {
    if (style === 'baked') return { t, v: vals.map((v) => (v.length === 1 ? v[0] : v)) };
    const idx = simplifyKeys(t, vals, tol);
    return { t: idx.map((i) => t[i]), v: idx.map((i) => (vals[i].length === 1 ? vals[i][0] : vals[i])) };
  };
  const ex: BallExport = {
    name: o.name,
    color: hexToRgb(o.color),
    radius: o.radius,
    marker: o.rot.mode !== 'none',
    pos: pick(pos, [0.35, 0.35]),
    deformRot: pick(axisR.map((a) => [a]), [0.5]),
    deformScale: pick(scl, [0.4, 0.4]),
    spin: pick(spin.map((a) => [a]), [0.5]),
    duration: dur,
    markers: contactMarkers(o, comp),
  };
  // collapse constant channels
  for (const k of ['deformRot', 'deformScale', 'spin'] as const) {
    const ch = ex[k];
    const first = JSON.stringify(ch.v[0]);
    if (ch.v.every((v) => JSON.stringify(v) === first)) ex[k] = { t: [0], v: [ch.v[0]] };
  }
  if (style === 'expression' && o.mode === 'keyed' && o.start) ex.expr = buildExpressions(o);
  return ex;
}

export function buildPayload(objs: BallObj[], comp: Comp, style: ExportStyle, target: ExportTarget): BouncePayload {
  return { comp, style, target, balls: objs.map((o) => buildBallExport(o, comp, style)) };
}

// ───────── editable expression ─────────
// The expression re-implements the keyed solver so every bounce can be edited
// directly in the expression text, with layer sliders for global control.

function bounceTable(o: BallObj) {
  const tl = buildKeyed(o);
  return {
    start: [round(o.start![0], 2), round(o.start![1], 2)],
    delay: o.delay,
    r: o.radius,
    roll: o.rot.mode === 'roll' ? 1 : 0,
    spin: o.rot.mode === 'spin' ? [o.rot.spin, o.rot.decay] : 0,
    volume: o.deform.volume ? 1 : 0,
    // x, y, arc, travel (resolved, so 'follow' is baked in), hang, hangEase, squash, stretch, squashTime
    b: o.bounces.map((b, i) => [round(b.x, 2), round(b.y, 2), round(b.arc, 2), round(effectiveTravel(o, i, tl.g), 4), b.hang, b.hangEase, b.squash, b.stretch, b.squashTime]),
  };
}

function solverSource(o: BallObj) {
  const D = JSON.stringify(bounceTable(o));
  return `// Kinetix Bounce — edit the numbers below. Each bounce row:
// [x, y, arcHeight, travelTime, hangTime, hangEase%, squash, stretch, squashTime]
var K = ${D};
function kxs(n, d) { try { return thisLayer.effect(n)("Slider").value; } catch (e) { return d; } }
var TS = kxs("Time Scale", 100) / 100;
var SQ = kxs("Squash Amount", 100) / 100;
var STR = kxs("Stretch Amount", 100) / 100;
function prof(s, he) { return Math.pow(s, 2 + he / 100 * 2.6); }
function segs() {
  var out = [], t = K.delay, p = K.start;
  for (var i = 0; i < K.b.length; i++) {
    var b = K.b[i], apex = Math.min(p[1], b[1]) - Math.max(0, b[2]);
    var rise = Math.max(0, p[1] - apex), fall = Math.max(0, b[1] - apex);
    var tD = Math.max(1 / 120, b[3]) * TS, g = fall > 0.5 ? 2 * fall / (tD * tD) : 1;
    var tU = rise > 0.5 ? Math.sqrt(2 * rise / g) : 0, tH = b[4] * TS;
    var tW = (b[6] > 0 || b[7] > 0) ? b[8] * TS : 0;
    out.push({ p0: p, p1: [b[0], b[1]], apex: apex, rise: rise, fall: fall, t0: t, tU: tU, tH: tH, tD: tD, tW: tW, b: b, imp: Math.sqrt(2 * g * Math.max(1, fall)) });
    t += tU + tH + tD + tW; p = [b[0], b[1]];
  }
  return out;
}
var S = segs();
function raw(t) {
  if (!S.length || t <= S[0].t0) return { p: K.start, s: S[0], ph: 0, w: 0 };
  for (var i = 0; i < S.length; i++) {
    var s = S[i], air = s.tU + s.tH + s.tD, l = t - s.t0;
    if (l <= air) {
      var x = s.p0[0] + (s.p1[0] - s.p0[0]) * (air > 0 ? l / air : 1), y;
      if (l < s.tU) y = s.apex + s.rise * prof(1 - l / s.tU, s.b[5]);
      else if (l < s.tU + s.tH) y = s.apex;
      else y = s.apex + s.fall * prof(s.tD > 0 ? (l - s.tU - s.tH) / s.tD : 1, s.b[5]);
      return { p: [x, y], s: s, ph: 1, w: l / Math.max(1e-6, air), i: i };
    }
    if (l <= air + s.tW) return { p: s.p1, s: s, ph: 2, w: s.tW > 0 ? (l - air) / s.tW : 1, i: i };
  }
  var L = S[S.length - 1];
  return { p: L.p1, s: L, ph: 3, w: 1 };
}
function state(t) {
  var c = raw(t), dt = 1 / 240, a = raw(Math.max(0, t - dt)).p, bb = raw(t + dt).p;
  var vx = (bb[0] - a[0]) / (2 * dt), vy = (bb[1] - a[1]) / (2 * dt);
  var x = c.p[0], y = c.p[1], sa = 1, sb = 1, ax = 0;
  if (c.ph == 1) {
    var sp = Math.sqrt(vx * vx + vy * vy), q = Math.min(1, sp / Math.max(1, c.s.imp));
    var st = (c.w < 0.5 && c.i > 0 ? K.b[c.i - 1][7] : c.s.b[7]) * Math.pow(q, 1.5) * STR;
    sa = 1 + st; sb = K.volume ? 1 / Math.sqrt(sa) : 1; ax = sp > 1 ? Math.atan2(vy, vx) * 180 / Math.PI : 90;
  } else if (c.ph == 2) {
    var w = c.w, amt = w < 0.35 ? Math.sin(w / 0.35 * Math.PI / 2) : Math.cos((w - 0.35) / 0.65 * Math.PI / 2);
    var sq = c.s.b[6] * amt * SQ;
    sa = 1 - sq; sb = K.volume ? 1 / Math.max(0.2, Math.sqrt(1 - sq)) : 1 + sq * 0.5; ax = 90;
    y = c.s.p1[1] + K.r * (1 - sa);
  }
  var rot = 0;
  if (K.roll) rot = (c.p[0] - K.start[0]) / K.r * 180 / Math.PI;
  else if (K.spin) { var tt = Math.max(0, t - K.delay), d = Math.max(1e-3, K.spin[1]); rot = K.spin[0] * (1 - Math.exp(-d * tt)) / d; }
  return { x: x, y: y, sa: sa, sb: sb, ax: ax, rot: rot };
}
var st = state(time - thisLayer.inPoint);
`;
}

function buildExpressions(o: BallObj) {
  const src = solverSource(o);
  return {
    pos: src + '[st.x, st.y];',
    deformRot: src + 'st.ax;',
    deformScale: src + '[st.sa * 100, st.sb * 100];',
    spin: src + 'st.rot - st.ax;',
  };
}

function contactMarkers(o: BallObj, comp: Comp) {
  const tr = trackOf(o, comp.w, comp.h);
  if (tr.kind === 'keyed') {
    return tr.tl.segs.map((s) => ({ t: s.t0 + s.tUp + s.tHang + s.tDown, comment: `KX:contact ${Math.round(Math.min(40, s.impact / 60))} x${Math.round((s.p1[0] / comp.w) * 100)}` }));
  }
  return tr.tr.contacts.map((c) => ({ t: o.delay + c.t, comment: `KX:contact ${Math.round(Math.min(40, c.speed / 60))} x${Math.round((c.x / comp.w) * 100)}` }));
}
