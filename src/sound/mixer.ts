// Auto-SFX v3 — sound selection + one-pass mix.
// Every event gets a sound from the active pack, is pitched by size (and optionally tuned to a
// scale), panned by screen position and levelled by role. All voices then share one bus:
// a common short room (so everything sounds like it was recorded in the same space), a gentle
// glue compressor, an "ear-friendly" top-end tilt, loudness normalisation and a true-peak-ish
// limiter. Output is one stereo track (or three stems) — no pile of 80 separate layers.
import { loadIndex, loadSound, peakTime, type LibSound } from './library';
import { render as synthRender, GENERATORS, isPitched } from './synth';
import { rng } from '../core/math';
import type { Ev, Role } from './gestures';

type Src = { cat: string; minDur?: number; maxDur?: number; maxCen?: number; minCen?: number } | { synth: string };

export interface Pack {
  id: string; label: string; sub: string;
  room: number;      // shared reverb send 0..1
  tilt: number;      // top-end shelf dB (negative = softer)
  tuned: boolean;    // pitch tonal sounds to a scale by default
  map: Partial<Record<Role, Src[]>>;
}

const P = (cat: string, maxDur?: number, extra: Partial<{ minDur: number; maxCen: number; minCen: number }> = {}): Src => ({ cat, maxDur, ...extra });
const SY = (synth: string): Src => ({ synth });

export const PACKS: Pack[] = [
  { id: 'tickle', label: 'Ear-tickle Pops', sub: 'mouth pops, bubbles and drops — round, wet, never sharp', room: 0.14, tilt: -2.5, tuned: false,
    map: {
      enter: [P('pop', 0.3, { maxCen: 2200 }), P('bubble', 0.3)], pop: [P('bubble', 0.3), P('pop', 0.3)], shrink: [P('bubble', 0.35)], exit: [P('bubble', 0.4), P('pop', 0.3)],
      land: [P('water', 0.45), P('pop', 0.3)], bounce: [P('water', 0.35), P('bubble', 0.25)], settle: [P('bubble', 0.25)], hit: [P('pop', 0.3), P('water', 0.4)],
      whoosh: [P('whoosh', 1.2, { maxCen: 1800 })], spin: [P('whoosh', 1.0, { maxCen: 2200 })], cam: [P('whoosh', 1.6, { maxCen: 1500 })],
      nudge: [P('tick', 0.12)], type: [P('tick', 0.1, { maxCen: 2600 })], morph: [P('goo', 0.6), P('bubble', 0.8)], cut: [P('pop', 0.25)],
    } },
  { id: 'water', label: 'Water Drops', sub: 'droplets, plops and bubbles — liquid and satisfying', room: 0.2, tilt: -2, tuned: false,
    map: {
      enter: [P('water', 0.5)], pop: [P('water', 0.45), P('bubble', 0.3)], shrink: [P('bubble', 0.4)], exit: [P('bubble', 0.5)],
      land: [P('water', 0.5)], bounce: [P('water', 0.35)], settle: [P('bubble', 0.25)], hit: [P('water', 0.5)],
      whoosh: [P('whoosh', 1.2, { maxCen: 1800 })], spin: [P('bubble', 1.6, { minDur: 0.4 })], cam: [P('whoosh', 1.6, { maxCen: 1500 })],
      nudge: [P('water', 0.2)], type: [P('tick', 0.1, { maxCen: 2400 })], morph: [P('bubble', 1.0), P('goo', 0.7)], cut: [P('water', 0.3)],
    } },
  { id: 'mallet', label: 'Soft Mallets & Glass', sub: 'glass taps, bells and plucks that play a melody', room: 0.28, tilt: -1.5, tuned: true,
    map: {
      enter: [P('mallet', 1.2), P('ui', 0.9)], pop: [P('mallet', 0.9)], shrink: [P('ui', 0.8)], exit: [P('ui', 0.8)],
      land: [P('mallet', 1.0)], bounce: [P('mallet', 0.7)], settle: [P('mallet', 0.6)], hit: [P('mallet', 1.0)],
      whoosh: [P('whoosh', 1.2, { maxCen: 2000 })], spin: [P('magic', 1.5)], cam: [P('whoosh', 1.6, { maxCen: 1500 })],
      nudge: [P('tick', 0.12)], type: [P('tick', 0.1)], morph: [P('magic', 1.4)], cut: [P('mallet', 0.8)],
    } },
  { id: 'clean', label: 'Clean UI', sub: 'tidy ticks, taps and confirmations — product-video style', room: 0.08, tilt: -1, tuned: false,
    map: {
      enter: [P('ui', 0.6), P('tick', 0.2)], pop: [P('tick', 0.2)], shrink: [P('tick', 0.2)], exit: [P('tick', 0.25)],
      land: [P('tick', 0.2)], bounce: [P('tick', 0.15)], settle: [P('tick', 0.12)], hit: [P('tick', 0.2)],
      whoosh: [P('whoosh', 0.9, { maxCen: 2200 })], spin: [P('whoosh', 0.8)], cam: [P('whoosh', 1.4, { maxCen: 1600 })],
      nudge: [P('tick', 0.1)], type: [P('tick', 0.08)], morph: [P('ui', 0.8)], cut: [P('tick', 0.2)],
    } },
  { id: 'cartoon', label: 'Cartoon', sub: 'boings, squishes and zips', room: 0.12, tilt: -1.5, tuned: false,
    map: {
      enter: [P('cartoon', 0.7), P('pop', 0.3)], pop: [P('pop', 0.3)], shrink: [P('cartoon', 0.8)], exit: [P('cartoon', 0.8)],
      land: [P('goo', 0.5), P('pop', 0.3)], bounce: [P('cartoon', 0.6)], settle: [P('goo', 0.4)], hit: [P('goo', 0.5)],
      whoosh: [P('whoosh', 1.0)], spin: [P('cartoon', 1.2)], cam: [P('whoosh', 1.4)],
      nudge: [P('pop', 0.2)], type: [P('tick', 0.1)], morph: [P('goo', 0.8)], cut: [P('pop', 0.25)],
    } },
  { id: 'cinematic', label: 'Cinematic', sub: 'whooshes, soft thumps and shimmer', room: 0.32, tilt: -1, tuned: false,
    map: {
      enter: [P('impact', 0.8), P('magic', 1.2)], pop: [P('impact', 0.6)], shrink: [P('whoosh', 0.8)], exit: [P('whoosh', 0.9)],
      land: [P('impact', 0.9)], bounce: [P('impact', 0.6)], settle: [P('impact', 0.5)], hit: [P('impact', 0.9)],
      whoosh: [P('whoosh', 1.6)], spin: [P('whoosh', 1.4)], cam: [P('whoosh', 1.8), P('riser', 3)],
      nudge: [P('tick', 0.12)], type: [P('tick', 0.1)], morph: [P('magic', 1.6)], cut: [P('impact', 0.6)],
    } },
  { id: 'synth', label: 'Kinetix Synth', sub: 'our own synthesised bloops, plips and swishes', room: 0.15, tilt: -1, tuned: true,
    map: {
      enter: [SY('bloop'), SY('plip')], pop: [SY('bubblepop'), SY('pop')], shrink: [SY('plip')], exit: [SY('boop')],
      land: [SY('pop'), SY('cork')], bounce: [SY('bloop')], settle: [SY('plip')], hit: [SY('cork')],
      whoosh: [SY('swish')], spin: [SY('zip')], cam: [SY('whoosh')], nudge: [SY('tick')], type: [SY('tick')], morph: [SY('squish')], cut: [SY('bloop')],
    } },
];

// level per role (dB) — primaries forward, motion beds and detail tucked under
const ROLE_DB: Record<Role, number> = { enter: 0, pop: -1, land: -1, hit: 0, bounce: -3, settle: -9, exit: -5, shrink: -5, whoosh: -8, spin: -10, nudge: -12, type: -14, morph: -6, cam: -7, cut: -5 };
const STEMS: Record<Role, 'pops' | 'motion' | 'detail'> = { enter: 'pops', pop: 'pops', land: 'pops', hit: 'pops', bounce: 'pops', settle: 'pops', exit: 'pops', shrink: 'pops', cut: 'pops', whoosh: 'motion', spin: 'motion', cam: 'motion', morph: 'detail', nudge: 'detail', type: 'detail' };
const SCALES: Record<string, number[]> = { pentatonic: [0, 2, 4, 7, 9], major: [0, 2, 4, 5, 7, 9, 11], dreamy: [0, 2, 4, 7, 11] };

export interface MixOpts { pack: Pack; tuned: boolean; scale: keyof typeof SCALES; key: number; volume: number; width: number; room: number; stems: boolean; seed: number }
export interface Voice { e: Ev; src: string; label: string; start: number; rate: number; db: number; pan: number; buf: AudioBuffer }

function candidates(lib: LibSound[], s: Src): LibSound[] {
  if ('synth' in s) return [];
  const c = lib.filter((x) => x.cat === s.cat && (s.maxDur === undefined || x.dur <= s.maxDur) && (s.minDur === undefined || x.dur >= s.minDur) && (s.maxCen === undefined || x.cen <= s.maxCen) && (s.minCen === undefined || x.cen >= s.minCen));
  // fall back to the whole category if the filter was too strict
  return (c.length >= 3 ? c : lib.filter((x) => x.cat === s.cat)).sort((a, b) => b.score - a.score);
}

const synthCache = new Map<string, Promise<AudioBuffer>>();
function synthBuf(gen: string, seed: number) {
  const key = gen + ':' + (seed % 6);
  let p = synthCache.get(key);
  if (!p) {
    const G = GENERATORS[gen];
    p = synthRender({ gen, length: (G.len[0] + G.len[1]) / 2, pitch: 0, bright: 0.45, reverb: 0, width: 0.5, drive: 0.15, seed: seed % 6, volume: -3 });
    synthCache.set(key, p);
  }
  return p;
}

const semis = (f: number) => 12 * Math.log2(f / 261.63);

/** Pick a sound + pitch + level for every event. */
export async function planVoices(events: Ev[], o: MixOpts): Promise<Voice[]> {
  const lib = await loadIndex();
  const r = rng(o.seed);
  const voices: Voice[] = [];
  const lastByRole = new Map<Role, string>();
  const groupPick = new Map<number, number>();
  const rot = new Map<Role, number>();
  const scale = SCALES[o.scale] ?? SCALES.pentatonic;
  for (const e of events) {
    const srcs = o.pack.map[e.role] ?? o.pack.map.enter!;
    const src = srcs[(e.accent ?? 0) > 0 ? Math.min(srcs.length - 1, 1) : 0];
    let buf: AudioBuffer, id: string, label: string, f0 = 0, tonal = false;
    if ('synth' in src) {
      const gen = srcs[Math.floor(r() * srcs.length)] as { synth: string };
      buf = await synthBuf(gen.synth, Math.floor(r() * 1000));
      id = 'synth:' + gen.synth; label = GENERATORS[gen.synth]?.label ?? gen.synth;
      tonal = isPitched(gen.synth); f0 = 523;
    } else {
      const C = candidates(lib, src);
      if (!C.length) continue;
      // round-robin over the best few, never the same sample twice in a row; a stagger group shares one sample
      let k: number;
      if (e.group !== undefined && groupPick.has(e.group)) k = groupPick.get(e.group)!;
      else {
        const pool = Math.min(C.length, 8);
        k = (rot.get(e.role) ?? Math.floor(r() * pool)) % pool;
        if (C[k].id === lastByRole.get(e.role) && pool > 1) k = (k + 1) % pool;
        rot.set(e.role, k + 1 + Math.floor(r() * 2));
        if (e.group !== undefined) groupPick.set(e.group, k);
      }
      const s = C[k];
      buf = await loadSound(s);
      id = s.id; label = s.name; f0 = s.f0; tonal = s.tonal;
    }
    lastByRole.set(e.role, id);
    // ── pitch: small things sound higher; stagger groups climb ──
    let st = Math.max(-4, Math.min(5, Math.round(-Math.log2(Math.max(0.02, e.size) / 0.25) * 2.2)));
    const step = e.group !== undefined ? (e.step ?? 0) : 0;
    if (o.tuned && tonal && f0 > 60) {
      // land on the scale: nearest scale degree to the size-shifted pitch, then walk up the scale
      const cur = semis(f0) + st - o.key;
      const oct = Math.floor(cur / 12);
      const within = cur - oct * 12;
      let bi = 0; for (let i = 1; i < scale.length; i++) if (Math.abs(scale[i] - within) < Math.abs(scale[bi] - within)) bi = i;
      const deg = bi + Math.min(step, 7);
      const target = oct * 12 + Math.floor(deg / scale.length) * 12 + scale[deg % scale.length] + o.key;
      st += target - (semis(f0) + st);
    } else {
      st += Math.min(step, 5) * 0.8 + (r() - 0.5) * 0.5;
    }
    st = Math.max(-9, Math.min(9, st));
    let rate = Math.pow(2, st / 12);
    // ── timing ──
    let start = e.t - 0.003;
    if (e.role === 'whoosh' || e.role === 'cam' || e.role === 'spin') {
      // fit the whoosh to the gesture and line its loudest point up with the motion peak
      const want = Math.max(0.2, e.dur + 0.12);
      rate *= Math.max(0.8, Math.min(1.25, buf.duration / want));
      const pk = (e.peak ?? e.t + e.dur / 2) - peakTime(buf) / rate;
      start = Math.max(e.t - 0.15, pk);
    }
    // ── level ──
    const db = ROLE_DB[e.role] + 20 * Math.log10(0.35 + 0.65 * e.strength) - Math.max(0, (step - 3)) * 0.8;
    voices.push({ e, src: id, label, start, rate, db, pan: Math.max(-1, Math.min(1, (e.x - 0.5) * 1.4 * o.width)), buf });
  }
  // crowding: a voice that lands on top of others steps back a little
  voices.sort((a, b) => a.start - b.start);
  for (let i = 0; i < voices.length; i++) {
    let near = 0;
    for (let j = i - 1; j >= 0 && voices[i].start - voices[j].start < 0.05; j--) near++;
    voices[i].db -= near * 2.5;
  }
  return voices;
}

function roomIR(ctx: BaseAudioContext, sec: number, seed: number) {
  const n = Math.round(sec * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate), r = rng(seed);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      lp += ((r() * 2 - 1) - lp) * (0.55 - 0.4 * t); // darker as it decays
      d[i] = lp * Math.pow(1 - t, 2.6) * (i < 90 ? i / 90 : 1);
    }
  }
  return b;
}

/** Render voices through the shared bus. Returns one buffer per stem (or one 'mix'). */
export async function renderMix(voices: Voice[], o: MixOpts, length: number, t0: number): Promise<Record<string, AudioBuffer>> {
  const SR = 48000;
  const groups: Record<string, Voice[]> = o.stems ? { pops: [], motion: [], detail: [] } : { mix: [] };
  for (const v of voices) (o.stems ? groups[STEMS[v.e.role]] : groups.mix).push(v);
  const out: Record<string, AudioBuffer> = {};
  for (const [name, list] of Object.entries(groups)) {
    if (!list.length) continue;
    const ctx = new OfflineAudioContext(2, Math.ceil((length + 1.5) * SR), SR);
    const bus = ctx.createGain();
    const send = ctx.createGain(); send.gain.value = 1;
    const cv = ctx.createConvolver(); cv.buffer = roomIR(ctx, 0.35 + o.room * 0.9, 7);
    const wet = ctx.createGain(); wet.gain.value = o.room * 0.6;
    const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 6000;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 55; hp.Q.value = 0.7;
    const tilt = ctx.createBiquadFilter(); tilt.type = 'highshelf'; tilt.frequency.value = 7500; tilt.gain.value = o.pack.tilt;
    const deharsh = ctx.createBiquadFilter(); deharsh.type = 'peaking'; deharsh.frequency.value = 3800; deharsh.Q.value = 1.2; deharsh.gain.value = -1.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 2.2; comp.attack.value = 0.006; comp.release.value = 0.15;
    bus.connect(hp).connect(deharsh).connect(tilt).connect(comp);
    send.connect(cv).connect(wlp).connect(wet).connect(comp);
    comp.connect(ctx.destination);
    for (const v of list) {
      const s = ctx.createBufferSource(); s.buffer = v.buf; s.playbackRate.value = v.rate;
      const g = ctx.createGain(); g.gain.value = Math.pow(10, v.db / 20);
      const pn = ctx.createStereoPanner(); pn.pan.value = v.pan;
      s.connect(g).connect(pn); pn.connect(bus); pn.connect(send);
      s.start(Math.max(0, v.start - t0));
    }
    const buf = await ctx.startRendering();
    master(buf, -16 + o.volume);
    out[name] = buf;
  }
  return out;
}

/** Gated loudness normalisation + look-ahead peak limiter at -1 dBFS. */
export function master(buf: AudioBuffer, targetDb: number) {
  const ch = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
  const n = buf.length, blk = Math.round(buf.sampleRate * 0.4), hop = Math.round(blk / 4);
  const blocks: number[] = [];
  for (let i = 0; i + blk <= n; i += hop) {
    let s = 0; for (const d of ch) for (let k = i; k < i + blk; k++) s += d[k] * d[k];
    blocks.push(s / (blk * ch.length));
  }
  const lufs = (xs: number[]) => 10 * Math.log10(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length) + 1e-12);
  let g1 = blocks.filter((b) => 10 * Math.log10(b + 1e-12) > -70);
  const rel = lufs(g1) - 10;
  g1 = g1.filter((b) => 10 * Math.log10(b + 1e-12) > rel);
  const loud = g1.length ? lufs(g1) : -70;
  const gain = loud > -69 ? Math.pow(10, (targetDb - loud) / 20) : 1;
  // limiter: 3 ms look-ahead, 80 ms release
  const ceil = Math.pow(10, -1 / 20), la = Math.round(buf.sampleRate * 0.003), rel2 = Math.exp(-1 / (buf.sampleRate * 0.08));
  // required gain reduction, spread backwards over the look-ahead window
  const hold = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    let p = 0; for (const d of ch) p = Math.max(p, Math.abs(d[i] * gain));
    if (p > ceil) { const r = ceil / p; for (let k = Math.max(0, i - la); k <= i; k++) if (r < hold[k]) hold[k] = r; }
  }
  let env = 1;
  for (let i = 0; i < n; i++) {
    env = hold[i] < env ? hold[i] : 1 - (1 - env) * rel2;
    for (const d of ch) d[i] *= gain * env;
  }
}
