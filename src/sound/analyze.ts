// Auto-SFX motion analysis: per-frame layer samples → sound events.

export interface LayerSample {
  name: string;
  index: number;
  inPoint: number;
  outPoint: number;
  size: [number, number];
  pos?: number[][];   // per frame [x, y]
  scale?: number[];   // per frame, % (average of x/y)
  rot?: number[];     // per frame, degrees
  op?: number[];      // per frame, 0..100
  textKeys: number[];
  pathKeys: number[];
  markers: { t: number; dur: number; comment: string }[];
}
export interface SampleSet { fps: number; t0: number; end?: number; comp: { w: number; h: number }; layers: LayerSample[] }

export type Kind = 'appear' | 'vanish' | 'pop' | 'shrink' | 'move' | 'land' | 'bounce' | 'spin' | 'type' | 'morph' | 'hit' | 'contact' | 'cam' | 'in' | 'out';
export interface SfxEvent { t: number; dur: number; kind: Kind; strength: number; x: number; size: number; layer: string }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function smooth(a: number[], r = 1) {
  return a.map((_, i) => { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const v = a[i + k]; if (v !== undefined) { s += v; n++; } } return s / n; });
}

export function analyze(S: SampleSet, opts: { motion: boolean; text: boolean; morph: boolean; markers: boolean; cuts: boolean }): SfxEvent[] {
  const ev: SfxEvent[] = [];
  const dt = 1 / S.fps;
  const W = S.comp.w;
  for (const L of S.layers) {
    const size = Math.max(4, Math.sqrt(L.size[0] * L.size[1]));
    const at = (i: number) => S.t0 + i * dt;
    let px = 0.5;
    if (L.pos?.length) px = clamp(L.pos[0][0] / W, 0, 1);
    const push = (t: number, dur: number, kind: Kind, strength: number, x = px) => ev.push({ t, dur, kind, strength: clamp(strength, 0.05, 1), x: clamp(x, 0, 1), size, layer: L.name });

    if (opts.motion && L.pos && L.pos.length > 3) {
      const P = L.pos;
      const vx = P.map((_, i) => (P[Math.min(P.length - 1, i + 1)][0] - P[Math.max(0, i - 1)][0]) / (2 * dt));
      const vy = P.map((_, i) => (P[Math.min(P.length - 1, i + 1)][1] - P[Math.max(0, i - 1)][1]) / (2 * dt));
      const sp = smooth(vx.map((x, i) => Math.hypot(x, vy[i])), 1);
      const maxV = Math.max(...sp);
      const T = Math.max(220, maxV * 0.18);
      let i = 0;
      while (i < sp.length) {
        if (sp[i] <= T) { i++; continue; }
        let e = i;
        while (e < sp.length - 1 && (sp[e + 1] > T || (sp[e + 2] ?? 0) > T)) e++;
        let peak = 0, mx = 0;
        for (let k = i; k <= e; k++) { peak = Math.max(peak, sp[k]); mx += P[k][0]; }
        mx /= e - i + 1;
        const dur = (e - i + 1) * dt;
        if (dur >= 2 * dt) push(at(i), dur, 'move', peak / 3200, mx / W);
        // a hard stop = landing
        const after = sp[Math.min(sp.length - 1, e + 2)];
        if (after < peak * 0.25 && peak > 400) push(at(e), 0, 'land', peak / 2600, P[e][0] / W);
        // direction reversals inside the move = bounces
        for (let k = i + 1; k < e; k++) {
          const d1 = vx[k - 1] * vx[k + 1] + vy[k - 1] * vy[k + 1];
          if (d1 < 0 && sp[k - 1] > T && sp[k + 1] > T && Math.abs(vy[k - 1]) > Math.abs(vx[k - 1]) * 0.6) { push(at(k), 0, 'bounce', Math.max(sp[k - 1], sp[k + 1]) / 2600, P[k][0] / W); k += 2; }
        }
        i = e + 1;
      }
    }
    if (opts.motion && L.scale && L.scale.length > 3) {
      const s = L.scale;
      const maxS = Math.max(...s);
      for (let i = 1; i < s.length; i++) {
        // pop in: from small to big within 0.5 s
        if (s[i - 1] < maxS * 0.35 && s[i] > s[i - 1] + 0.5) {
          const j = Math.min(s.length - 1, i + Math.round(0.5 / dt));
          let k = i; while (k < j && s[k] < maxS * 0.85) k++;
          if (s[k] >= maxS * 0.85 && s[i - 1] < maxS * 0.35 && (i === 1 || s[i - 2] < maxS * 0.35)) { push(at(i - 1), (k - i + 1) * dt, 'pop', 0.4 + 0.6 * (maxS / 200)); i = k; continue; }
        }
        if (s[i - 1] > maxS * 0.6 && s[i] < s[i - 1] && i + 3 < s.length) {
          const j = Math.min(s.length - 1, i + Math.round(0.5 / dt));
          let k = i; while (k < j && s[k] > maxS * 0.2) k++;
          if (s[k] <= maxS * 0.2) { push(at(i), (k - i) * dt, 'shrink', 0.5); i = k; }
        }
      }
    }
    if (opts.motion && L.op && L.op.length > 2) {
      const o = L.op;
      for (let i = 1; i < o.length; i++) {
        if (o[i - 1] < 45 && o[i] >= 45) push(at(i - 1), 0, 'appear', 0.5 + (o[Math.min(o.length - 1, i + 3)] - o[i - 1]) / 250);
        if (o[i - 1] >= 45 && o[i] < 45) push(at(i), 0, 'vanish', 0.45);
      }
    }
    if (opts.motion && L.rot && L.rot.length > 3) {
      const r = L.rot, w = smooth(r.map((_, i) => Math.abs(r[Math.min(r.length - 1, i + 1)] - r[Math.max(0, i - 1)]) / (2 * dt)), 1);
      let i = 0;
      while (i < w.length) {
        if (w[i] < 420) { i++; continue; }
        let e = i; while (e < w.length - 1 && w[e + 1] >= 420) e++;
        if (e - i >= 2) push(at(i), (e - i + 1) * dt, 'spin', Math.max(...w.slice(i, e + 1)) / 1800);
        i = e + 1;
      }
    }
    if (opts.text) L.textKeys.forEach((t) => push(t, 0, 'type', 0.45));
    if (opts.morph) L.pathKeys.forEach((t, i) => { const nx = L.pathKeys[i + 1]; if (nx !== undefined && nx - t < 3) push(t, nx - t, 'morph', 0.55); });
    if (opts.markers) for (const m of L.markers) {
      const c = m.comment;
      if (!c.startsWith('KX:')) continue;
      const parts = c.split(' ');
      const kind = parts[0].slice(3) as Kind;
      let strength = 0.6, x = px;
      for (const q of parts.slice(1)) { if (q.startsWith('x')) x = parseFloat(q.slice(1)) / 100; else if (!isNaN(parseFloat(q))) strength = parseFloat(q) / 40; }
      push(m.t, m.dur, (['hit', 'contact', 'cam'].includes(kind) ? kind : 'hit') as Kind, strength, x);
    }
    if (opts.cuts) {
      const near = (t: number, kinds: Kind[]) => ev.some((e) => e.layer === L.name && kinds.includes(e.kind) && Math.abs(e.t - t) < 0.3);
      if (L.inPoint > S.t0 + 0.04 && !near(L.inPoint, ['appear', 'pop', 'move'])) push(L.inPoint, 0, 'in', 0.5);
      if (L.outPoint < (S.end ?? 1e9) - 0.05 && !near(L.outPoint, ['vanish', 'shrink', 'move'])) push(L.outPoint - 0.02, 0, 'out', 0.4);
    }
  }
  return thin(ev);
}

/** Keep the mix clean: per-layer minimum spacing and a global density cap. */
export function thin(ev: SfxEvent[], density = 1): SfxEvent[] {
  const pri: Record<Kind, number> = { land: 9, hit: 9, contact: 8, pop: 8, appear: 7, bounce: 7, in: 6, cam: 6, morph: 5, move: 5, spin: 4, shrink: 4, vanish: 4, out: 3, type: 3 };
  const sorted = [...ev].sort((a, b) => a.t - b.t || pri[b.kind] - pri[a.kind]);
  const out: SfxEvent[] = [];
  const lastByLayer = new Map<string, number>();
  for (const e of sorted) {
    const gap = e.kind === 'type' ? 0.04 : 0.07;
    const last = lastByLayer.get(e.layer);
    if (last !== undefined && e.t - last < gap) continue;
    const win = out.filter((o) => Math.abs(o.t - e.t) < 0.12);
    if (win.length >= Math.round(3 * density)) continue;
    out.push(e);
    lastByLayer.set(e.layer, e.t);
  }
  return out;
}

// ───────── style packs ─────────
export interface Pack { id: string; label: string; sub: string; map: Partial<Record<Kind, string[]>>; reverb: number; bright: number; tuned: boolean }
export const PACKS: Pack[] = [
  { id: 'tickle', label: 'Ear-tickle Pops', sub: 'bloops, mouth pops, soft ticks — round & satisfying', reverb: 0.15, bright: 0.45, tuned: true,
    map: { appear: ['bloop', 'plip', 'boop'], vanish: ['boop'], pop: ['pop', 'bubblepop'], shrink: ['plip'], move: ['swish'], land: ['pop', 'cork'], bounce: ['bloop'], spin: ['zip'], type: ['tick'], morph: ['squish'], hit: ['cork'], contact: ['pop', 'bloop'], cam: ['whoosh'], in: ['bloop'], out: ['swish'] } },
  { id: 'water', label: 'Water Drops', sub: 'droplets, plops and bubbles', reverb: 0.22, bright: 0.5, tuned: true,
    map: { appear: ['droplet'], vanish: ['bubblepop'], pop: ['droplet', 'bubblepop'], shrink: ['bubblepop'], move: ['swish'], land: ['plop'], bounce: ['droplet'], spin: ['bubbles'], type: ['plip'], morph: ['bubbles'], hit: ['plop'], contact: ['droplet'], cam: ['whoosh'], in: ['droplet'], out: ['bubblepop'] } },
  { id: 'mallet', label: 'Soft Mallets', sub: 'kalimba & marimba notes that play a melody', reverb: 0.3, bright: 0.4, tuned: true,
    map: { appear: ['kalimba', 'mallet'], vanish: ['mallet'], pop: ['kalimba'], shrink: ['glass'], move: ['swish'], land: ['mallet'], bounce: ['glass'], spin: ['zip'], type: ['tick'], morph: ['chime'], hit: ['mallet'], contact: ['mallet'], cam: ['whoosh'], in: ['kalimba'], out: ['swish'] } },
  { id: 'clean', label: 'Clean UI', sub: 'Apple-like ticks, taps and toggles', reverb: 0.08, bright: 0.55, tuned: false,
    map: { appear: ['toggle', 'tap'], vanish: ['tap'], pop: ['tap'], shrink: ['tick'], move: ['swish'], land: ['tap'], bounce: ['tick'], spin: ['zip'], type: ['tick'], morph: ['swoosh'], hit: ['tap'], contact: ['tick'], cam: ['swoosh'], in: ['toggle'], out: ['swish'] } },
  { id: 'cartoon', label: 'Cartoon', sub: 'boings, squishes and zips', reverb: 0.12, bright: 0.5, tuned: true,
    map: { appear: ['boop', 'pop'], vanish: ['zip'], pop: ['pop'], shrink: ['zip'], move: ['zip', 'swish'], land: ['boing'], bounce: ['boing'], spin: ['zip'], type: ['tick'], morph: ['goo', 'squish'], hit: ['cork'], contact: ['boing'], cam: ['swoosh'], in: ['pop'], out: ['zip'] } },
  { id: 'cinematic', label: 'Cinematic', sub: 'whooshes, thumps and swells', reverb: 0.4, bright: 0.35, tuned: false,
    map: { appear: ['reverse', 'thump'], vanish: ['swish'], pop: ['thump'], shrink: ['swish'], move: ['whoosh'], land: ['thump', 'impact'], bounce: ['thump'], spin: ['swoosh'], type: ['tick'], morph: ['reverse'], hit: ['impact'], contact: ['thump'], cam: ['whoosh'], in: ['swoosh'], out: ['swish'] } },
];

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

/** Size → pitch (small elements sound higher). */
export const sizePitch = (size: number) => clamp(Math.round(Math.log2(220 / size) * 3), -6, 7);

/** Pentatonic stepping: quick successions climb the scale like a little melody. */
export function tunedPitches(events: SfxEvent[]): number[] {
  let step = 0, last = -10;
  return events.map((e) => {
    if (e.t - last > 0.6) step = 0; else step = Math.min(PENTA.length - 1, step + 1);
    last = e.t;
    return PENTA[step];
  });
}
