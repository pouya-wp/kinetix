// Auto-SFX v3 — gesture analysis.
// Input: per-frame, screen-space samples of every visible layer (host KX.sfxSample3).
// Every channel (travel, size, rotation, opacity) is folded into one motion-energy curve per
// layer; the curve is cut into gestures (onset → peak → settle) and each gesture becomes ONE
// primary sound plus a few decaying accents (landing, bounces, overshoot). Thresholds are
// relative to the comp size and time-based, so 1080p / 4K / 24 / 60 fps all behave alike.

export interface Track {
  name: string;
  kind: 'text' | 'shape' | 'precomp' | 'null' | 'solid' | 'footage';
  inner: boolean;
  inPoint: number;
  outPoint: number;
  x: number[]; y: number[]; s: number[]; r: number[]; o: number[];
  markers: { t: number; dur: number; comment: string }[];
  textKeys: number[];
  pathKeys: number[];
  type: null | { text: string; basedOn: number; hasIn: boolean; hasOut: boolean; inDur: number; outDur: number | null; stagger: number | null; fit: number | null; inT: number; outT: number };
  inout: null | { inT: number; inDur: number | null; outT: number; outDur: number | null };
}
export interface Scan { fps: number; t0: number; end: number; comp: { w: number; h: number }; layers: Track[] }

export type Role =
  | 'enter' | 'exit' | 'pop' | 'shrink' | 'whoosh' | 'land' | 'bounce' | 'settle' | 'spin' | 'nudge'
  | 'type' | 'morph' | 'hit' | 'cam' | 'cut';

export interface Ev {
  t: number;         // when the sound's transient should hit (s, comp time)
  dur: number;       // gesture length for sustained roles (whoosh / spin / morph)
  peak?: number;     // time of max speed inside a whoosh
  role: Role;
  strength: number;  // 0..1
  x: number;         // 0..1 screen position → pan
  size: number;      // 0..1 relative visual size → pitch
  layer: string;
  group?: number;    // stagger group id (several layers doing the same thing in a row)
  step?: number;     // position inside the stagger group
  accent?: number;   // 0 = primary, 1.. = secondary accents of the same gesture
}

export interface Opts { motion: boolean; text: boolean; morph: boolean; markers: boolean; cuts: boolean; density: 'sparse' | 'normal' | 'rich' }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mean3 = (a: number[]) => a.map((_, i) => ((a[i - 1] ?? a[i]) + a[i] + (a[i + 1] ?? a[i])) / 3);

/** Unwrap an angle series so 179 → -179 is +2°, not -358°. */
function unwrap(r: number[]) {
  const o = r.slice();
  for (let i = 1; i < o.length; i++) { let d = o[i] - o[i - 1]; while (d > 180) d -= 360; while (d < -180) d += 360; o[i] = o[i - 1] + d; }
  return o;
}

interface Curves { v: number[]; vx: number[]; vy: number[]; g: number[]; gs: number[]; w: number[]; q: number[]; E: number[]; vis: number[] }

export function curves(L: Track, fps: number, diag: number): Curves {
  const n = L.x.length, dt = 1 / fps;
  const d = (a: number[], i: number) => (a[Math.min(n - 1, i + 1)] - a[Math.max(0, i - 1)]) / ((Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * dt || dt);
  const vis = L.o.map((o, i) => (o > 3 && L.s[i] > 0.5 ? 1 : 0));
  const lns = L.s.map((s) => Math.log(Math.max(1, s)));
  const r = unwrap(L.r);
  const vx: number[] = [], vy: number[] = [], v: number[] = [], g: number[] = [], gs: number[] = [], w: number[] = [], q: number[] = [];
  for (let i = 0; i < n; i++) {
    const on = vis[i] || vis[Math.max(0, i - 1)] || vis[Math.min(n - 1, i + 1)];
    vx.push(on ? d(L.x, i) / diag : 0); vy.push(on ? d(L.y, i) / diag : 0);
    v.push(Math.hypot(vx[i], vy[i]));
    const gg = on ? d(lns, i) : 0; gs.push(gg); g.push(Math.abs(gg));
    w.push(on ? Math.abs(d(r, i)) / 360 : 0);
    q.push(Math.abs(d(L.o, i)) / 100);
  }
  const vS = mean3(v), gS = mean3(g), wS = mean3(w), qS = mean3(q);
  // each term ≈1 for a clearly noticeable motion
  const E = vS.map((_, i) => vS[i] / 0.22 + gS[i] / 1.1 + wS[i] / 0.55 + qS[i] / 2.2);
  return { v: vS, vx, vy, g: gS, gs, w: wS, q: qS, E, vis };
}

interface Gesture { a: number; b: number; peak: number }

/** Hysteresis segmentation of the energy curve. */
export function segment(E: number[], fps: number, on = 0.4, off = 0.14): Gesture[] {
  const out: Gesture[] = [];
  let i = 0;
  while (i < E.length) {
    if (E[i] < on) { i++; continue; }
    let a = i; while (a > 0 && E[a - 1] > off) a--;
    let b = i; while (b < E.length - 1 && E[b + 1] > off) b++;
    let peak = a; for (let k = a; k <= b; k++) if (E[k] > E[peak]) peak = k;
    const last = out[out.length - 1];
    if (last && a - last.b - 1 <= Math.round(0.07 * fps)) { last.b = b; if (E[peak] > E[last.peak]) last.peak = peak; }
    else out.push({ a, b, peak });
    i = b + 1;
  }
  return out.filter((G) => G.b - G.a >= 1);
}

export function analyzeScan(S: Scan, o: Opts): Ev[] {
  const ev: Ev[] = [];
  const fps = S.fps, dt = 1 / fps, W = S.comp.w, H = S.comp.h;
  const diag = Math.hypot(W, H);
  const at = (i: number) => S.t0 + i * dt;
  for (const L of S.layers) {
    const n = L.x.length;
    if (n < 2) continue;
    const C = curves(L, fps, diag);
    const maxS = Math.max(1, ...L.s.map((s, i) => (C.vis[i] ? s : 0)));
    const rel = clamp(maxS / (0.5 * Math.min(W, H)), 0.02, 1);
    const px = (i: number) => clamp(L.x[clamp(i, 0, n - 1)] / W, 0, 1);
    const push = (e: Omit<Ev, 'layer' | 'size'> & { size?: number }) => ev.push({ size: rel, layer: L.name, ...e, strength: clamp(e.strength, 0.05, 1) });

    if (o.motion) {
      for (const G of segment(C.E, fps)) {
        const { a, b, peak } = G;
        const vis0 = a > 0 ? C.vis[a - 1] : C.vis[a];
        const vis1 = b < n - 1 ? C.vis[b + 1] : C.vis[b];
        // channel shares over the gesture
        let sv = 0, sg = 0, sw = 0, sq = 0, dist = 0;
        for (let k = a; k <= b; k++) { sv += C.v[k] / 0.22; sg += C.g[k] / 1.1; sw += C.w[k] / 0.55; sq += C.q[k] / 2.2; dist += C.v[k] * dt; }
        const tot = sv + sg + sw + sq || 1;
        const dur = (b - a + 1) * dt;
        const Epk = C.E[peak];
        const strength = clamp(0.25 + Math.log2(1 + Epk) * 0.22, 0.1, 1) * (0.55 + 0.45 * Math.sqrt(rel));
        const sizeA = L.s[Math.max(0, a - 1)], sizeB = L.s[Math.min(n - 1, b + 1)];
        const opA = L.o[Math.max(0, a - 1)], opB = L.o[Math.min(n - 1, b + 1)];
        const entering = !vis0 || opA < 15 || sizeA < maxS * 0.12;
        const leaving = !vis1 || opB < 15 || sizeB < maxS * 0.12;
        // landing: the gesture ends abruptly (speed drops from >45% of peak to ~0 within 3 frames)
        const stopK = Math.max(a, b - 3);
        const hardStop = C.v[stopK] > C.v[peak] * 0.45 && C.v[peak] > 0.25;
        if (entering && !leaving) {
          push({ t: at(a), dur, role: 'enter', strength: strength + 0.1, x: px(peak), accent: 0 });
        } else if (leaving && !entering) {
          push({ t: at(Math.max(a, b - Math.round(0.08 * fps))), dur, role: 'exit', strength: strength * 0.8, x: px(a), accent: 0 });
        } else if (sv / tot > 0.55 && dist > 0.12 && dur > 0.12) {
          push({ t: at(a), dur, peak: at(peak), role: 'whoosh', strength: clamp(Math.log2(1 + dist * 4) * 0.45, 0.15, 1) * (0.6 + 0.4 * Math.sqrt(rel)), x: px(peak), accent: 0 });
        } else if (sw / tot > 0.5 && dur > 0.15) {
          push({ t: at(a), dur, role: 'spin', strength: strength * 0.8, x: px(peak), accent: 0 });
        } else if (sg / tot > 0.5) {
          let net = 0; for (let k = a; k <= b; k++) net += C.gs[k] * dt;
          push({ t: at(a), dur, role: net >= 0 ? 'pop' : 'shrink', strength, x: px(peak), accent: 0 });
        } else if (sq / tot > 0.6) {
          // pure fades are quiet by nature
          push({ t: at(a), dur, role: opB > opA ? 'enter' : 'exit', strength: strength * 0.6, x: px(peak), accent: 0 });
        } else {
          push({ t: at(a), dur, role: 'nudge', strength: strength * 0.7, x: px(peak), accent: 0 });
        }
        // accents: landing and bounces (direction reversals of fast motion), decaying
        let acc = 1;
        for (let k = a + 2; k < b - 1; k++) {
          const dot = C.vx[k - 2] * C.vx[k + 2] + C.vy[k - 2] * C.vy[k + 2];
          const fast = C.v[k - 2] > 0.3 && C.v[k + 2] > 0.3;
          if (dot < 0 && fast) {
            push({ t: at(k), dur: 0, role: 'bounce', strength: strength * Math.pow(0.72, acc - 1) * clamp((C.v[k - 2] + C.v[k + 2]) / 1.4, 0.3, 1), x: px(k), accent: acc++ });
            k += Math.round(0.08 * fps);
          }
        }
        // the final stop is as loud as the speed it stops from, after any bounces
        if (hardStop && !leaving) push({ t: at(b), dur: 0, role: 'land', strength: strength * 0.95 * clamp(C.v[stopK] / Math.max(1e-6, C.v[peak]), 0.25, 1) * Math.pow(0.72, acc - 1), x: px(b), accent: acc++ });
        // scale overshoot / settle wobble at the end of the gesture
        const tail = Math.round(0.35 * fps);
        let sign = 0, wob = 0;
        for (let k = Math.max(a + 1, b - tail); k <= b && wob < 2; k++) {
          const sgn = Math.sign(C.gs[k]);
          if (sgn && sign && sgn !== sign && C.g[k - 1] > 0.6) { push({ t: at(k), dur: 0, role: 'settle', strength: strength * 0.45 * Math.pow(0.7, wob), x: px(k), accent: acc++ }); wob++; }
          if (sgn) sign = sgn;
        }
      }
    }

    // ── semantic events (exact, from Kinetix tools and AE keyframes) ──
    if (o.text && L.type) {
      const T = L.type;
      const units = unitCount(T.text, T.basedOn);
      const ticks = (start: number, d: number, out: boolean) => {
        let s = T.stagger ?? 0.05;
        const mx = Math.max(1, units - 1);
        if ((T.fit ?? 0) > 0) s = Math.max(0, ((T.fit ?? 0) - d) / mx);
        const minGap = 0.045;
        let last = -1;
        for (let k = 0; k <= mx; k++) {
          const t = out ? start - d - (mx - k) * s : start + k * s + d * 0.15;
          if (t - last < minGap) continue;
          last = t;
          push({ t, dur: 0, role: 'type', strength: 0.4, x: clamp((L.x[0] ?? W / 2) / W + (k / mx - 0.5) * 0.3, 0, 1), size: 0.15, accent: 0 });
        }
      };
      // the typing already voices the reveal — drop the generic appear of the same layer
      for (let k = ev.length - 1; k >= 0; k--) if (ev[k].layer === L.name && ev[k].role === 'enter' && Math.abs(ev[k].t - T.inT) < 0.3) ev.splice(k, 1);
      if (T.hasIn) ticks(T.inT, T.inDur, false);
      if (T.hasOut && T.outDur) ticks(T.outT, T.outDur, true);
    }
    if (o.text) L.textKeys.forEach((t) => push({ t, dur: 0, role: 'type', strength: 0.45, x: px(0), accent: 0 }));
    if (o.morph) L.pathKeys.forEach((t, i) => { const nx = L.pathKeys[i + 1]; if (nx !== undefined && nx - t < 3) push({ t, dur: nx - t, role: 'morph', strength: 0.55, x: px(Math.round((t - S.t0) * fps)), accent: 0 }); });
    if (o.markers) for (const m of L.markers) {
      if (!m.comment.startsWith('KX:')) continue;
      const parts = m.comment.split(' ');
      const k = parts[0].slice(3);
      let strength = 0.6, x = px(Math.round((m.t - S.t0) * fps));
      for (const p of parts.slice(1)) { if (p.startsWith('x')) x = parseFloat(p.slice(1)) / 100; else if (!isNaN(parseFloat(p))) strength = clamp(parseFloat(p) / 40, 0.15, 1); }
      push({ t: m.t, dur: m.dur, role: k === 'cam' ? 'cam' : 'hit', strength, x, accent: 0 });
    }
    // Kinetix In/Out that the transform sampling cannot see (effect-only styles such as Melt)
    if (o.motion && L.inout) {
      const near = (t: number) => ev.some((e) => e.layer === L.name && Math.abs(e.t - t) < 0.2);
      if (L.inout.inDur && !near(L.inout.inT)) push({ t: L.inout.inT, dur: L.inout.inDur, role: 'enter', strength: 0.55, x: px(0), accent: 0 });
      if (L.inout.outDur && !near(L.inout.outT - L.inout.outDur)) push({ t: L.inout.outT - L.inout.outDur, dur: L.inout.outDur, role: 'exit', strength: 0.45, x: px(n - 1), accent: 0 });
    }
    if (o.cuts && !L.inner) {
      const near = (t: number) => ev.some((e) => e.layer === L.name && Math.abs(e.t - t) < 0.25);
      if (L.inPoint > S.t0 + 0.04 && L.inPoint < S.end && !near(L.inPoint)) push({ t: L.inPoint, dur: 0, role: 'cut', strength: 0.45, x: px(Math.round((L.inPoint - S.t0) * fps)), accent: 0 });
    }
  }
  return arrange(dedupeNested(ev, S), o.density);
}

function unitCount(text: string, basedOn: number) {
  const t = text.replace(/\r\n?/g, '\n');
  if (basedOn === 3) return Math.max(1, t.split(/\s+/).filter(Boolean).length); // words
  if (basedOn === 4) return Math.max(1, t.split('\n').length);                   // lines
  return Math.max(1, t.replace(/\s/g, '').length);                               // characters
}

/** A precomp's children move with it — keep the outer event, drop the copies inside. */
function dedupeNested(ev: Ev[], S: Scan): Ev[] {
  const outer = new Set(S.layers.filter((l) => !l.inner).map((l) => l.name));
  return ev.filter((e) => {
    const p = e.layer.indexOf(' > ');
    if (p < 0) return true;
    const parent = e.layer.slice(0, p);
    if (!outer.has(parent)) return true;
    return !ev.some((q) => q.layer === parent && q.role === e.role && Math.abs(q.t - e.t) < 0.06);
  });
}

const IMPORTANCE: Record<Role, number> = { hit: 10, land: 9, enter: 9, pop: 8, bounce: 7, cam: 7, whoosh: 6, morph: 6, exit: 5, shrink: 5, cut: 5, spin: 4, settle: 3, type: 3, nudge: 2 };

/**
 * Musical arrangement:
 *  - several layers doing the same thing in a quick row become a stagger group (one family of
 *    sounds, stepping up in pitch) instead of a pile-up,
 *  - per-layer minimum spacing and a density cap per 120 ms window, keeping the most important.
 */
export function arrange(ev: Ev[], density: Opts['density']): Ev[] {
  const cap = density === 'sparse' ? 1 : density === 'rich' ? 3 : 2;
  const drop = density === 'sparse' ? new Set<Role>(['type', 'nudge', 'settle', 'spin', 'cut']) : density === 'normal' ? new Set<Role>(['nudge']) : new Set<Role>();
  const sorted = ev.filter((e) => !drop.has(e.role) || (e.role === 'type' && density !== 'sparse')).sort((a, b) => a.t - b.t || IMPORTANCE[b.role] - IMPORTANCE[a.role]);
  // stagger groups
  let gid = 0;
  const lastOf = new Map<Role, { t: number; g: number; step: number }>();
  for (const e of sorted) {
    if (e.accent || !['enter', 'pop', 'exit', 'shrink', 'land', 'hit'].includes(e.role)) continue;
    const l = lastOf.get(e.role);
    if (l && e.t - l.t < 0.22) { e.group = l.g; e.step = l.step + 1; lastOf.set(e.role, { t: e.t, g: l.g, step: e.step }); }
    else { e.group = ++gid; e.step = 0; lastOf.set(e.role, { t: e.t, g: gid, step: 0 }); }
  }
  const out: Ev[] = [];
  const lastLayer = new Map<string, number>();
  for (const e of sorted) {
    const gap = e.role === 'type' ? 0.04 : 0.07;
    const ll = lastLayer.get(e.layer);
    if (ll !== undefined && e.t - ll < gap && e.role !== 'whoosh') continue;
    const win = out.filter((q) => Math.abs(q.t - e.t) < 0.06 && q.role !== 'whoosh');
    if (e.role !== 'whoosh' && win.length >= cap) {
      // replace the weakest if this one matters more
      const weakest = win.reduce((m, q) => (IMPORTANCE[q.role] * q.strength < IMPORTANCE[m.role] * m.strength ? q : m));
      if (IMPORTANCE[e.role] * e.strength > IMPORTANCE[weakest.role] * weakest.strength * 1.2) out.splice(out.indexOf(weakest), 1);
      else continue;
    }
    // overlapping whooshes: keep the strongest of any that start within 150 ms
    if (e.role === 'whoosh') {
      const w = out.find((q) => q.role === 'whoosh' && Math.abs(q.t - e.t) < 0.15);
      if (w) { if (w.strength >= e.strength) continue; out.splice(out.indexOf(w), 1); }
    }
    out.push(e);
    lastLayer.set(e.layer, e.t);
  }
  return out.sort((a, b) => a.t - b.t);
}

export const ROLE_LABEL: Record<Role, string> = {
  enter: 'Appear', exit: 'Disappear', pop: 'Pop / grow', shrink: 'Shrink', whoosh: 'Whoosh', land: 'Landing', bounce: 'Bounce',
  settle: 'Wobble', spin: 'Spin', nudge: 'Nudge', type: 'Typing', morph: 'Morph', hit: 'Hit', cam: 'Camera', cut: 'Cut-in',
};
