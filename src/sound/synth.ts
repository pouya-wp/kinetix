// Kinetix Sound Lab engine — every sound is synthesised (no samples).
// Sound-design approach: each sound = transient + body + tail layers, physically
// inspired models (Minnaert bubble for water, formant resonators for mouth pops,
// modal partials for mallets/glass), clean curved envelopes (no clicks), then a
// mastering chain: low cut, gentle air shelf, soft saturation, warm short room,
// micro stereo width, soft clip and -1 dBTP normalisation.

import { rng } from '../core/math';

export interface SoundParams {
  gen: string;
  length: number;   // seconds (body length; tails ring past it)
  pitch: number;    // semitones
  bright: number;   // 0..1 tone
  reverb: number;   // 0..1 room
  width: number;    // 0..1 stereo
  drive: number;    // 0..1 saturation / punch
  seed: number;
  volume: number;   // dB
}

type Ctx = OfflineAudioContext;
const SR = 48000;

// ───────── building blocks ─────────
interface Kit { ctx: Ctx; out: AudioNode; p: SoundParams; r: () => number; L: number; st: number; hz: (f: number) => number }

/** Smooth attack/decay envelope on a gain param: no clicks, exponential-ish tail. */
function adsr(g: AudioParam, t0: number, attack: number, peak: number, decay: number, curve = 4) {
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(peak, t0 + Math.max(0.0008, attack));
  g.setTargetAtTime(0, t0 + attack, Math.max(0.002, decay / curve));
}
function gain(k: Kit, v = 1) { const g = k.ctx.createGain(); g.gain.value = v; return g; }
function osc(k: Kit, type: OscillatorType, f: number) { const o = k.ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
function filt(k: Kit, type: BiquadFilterType, f: number, q = 0.7) { const b = k.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function pan(k: Kit, v: number) { const p = k.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, v)); return p; }

const noiseCache = new Map<string, AudioBuffer>();
function noise(k: Kit, secs: number, color: 'white' | 'pink' | 'brown' = 'white') {
  const key = color + Math.ceil(secs * 10) + ':' + (k.p.seed % 7);
  let b = noiseCache.get(key);
  if (!b || b.sampleRate !== k.ctx.sampleRate) {
    const n = Math.ceil(secs * SR) + 64;
    b = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: SR });
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c), r = rng(k.p.seed % 7 + c * 977 + 3);
      let b0 = 0, b1 = 0, b2 = 0, br = 0;
      for (let i = 0; i < n; i++) {
        const w = r() * 2 - 1;
        if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22; }
        else if (color === 'brown') { br = (br + 0.02 * w) / 1.02; d[i] = br * 3.5; }
        else d[i] = w;
      }
    }
    noiseCache.set(key, b);
  }
  const s = k.ctx.createBufferSource();
  s.buffer = b;
  return s;
}
const play = (src: AudioScheduledSourceNode, t0: number, dur: number) => { src.start(t0); src.stop(t0 + dur + 0.05); };

/** A decaying sine "partial" with an optional pitch glide (ratio over glideTime). */
function partial(k: Kit, f: number, t0: number, amp: number, decay: number, opts: { type?: OscillatorType; glide?: number; glideTime?: number; attack?: number; out?: AudioNode } = {}) {
  const o = osc(k, opts.type ?? 'sine', f), g = gain(k, 0);
  if (opts.glide) { o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f * opts.glide), t0 + (opts.glideTime ?? decay * 0.5)); }
  adsr(g.gain, t0, opts.attack ?? 0.0015, amp, decay);
  o.connect(g).connect(opts.out ?? k.out);
  play(o, t0, decay * 1.6 + 0.02);
}
/** Short filtered noise transient. */
function click(k: Kit, t0: number, f: number, q: number, amp: number, dur: number, type: BiquadFilterType = 'bandpass') {
  const n = noise(k, dur + 0.05), b = filt(k, type, f, q), g = gain(k, 0);
  adsr(g.gain, t0, 0.0004, amp, dur, 3);
  n.connect(b).connect(g).connect(k.out);
  play(n, t0, dur * 1.5);
}
/** Minnaert bubble: a sine whose pitch rises as the bubble collapses — the "bloop". */
function bubble(k: Kit, t0: number, f0: number, rise: number, dur: number, amp: number) {
  const o = osc(k, 'sine', f0), g = gain(k, 0), lp = filt(k, 'lowpass', 6000);
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(f0 * rise, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(amp, t0 + 0.003);
  g.gain.setTargetAtTime(0, t0 + dur * 0.35, dur * 0.28);
  o.connect(lp).connect(g).connect(k.out);
  play(o, t0, dur * 2);
}
/** Resonant formant "pok" (cheek / cork pop). */
function formantPop(k: Kit, t0: number, f: number, amp: number, dur: number) {
  const n = noise(k, 0.05), g0 = gain(k, 0);
  adsr(g0.gain, t0, 0.0005, 1, 0.004, 3);
  n.connect(g0);
  for (const [mul, q, a] of [[1, 14, 1], [2.3, 10, 0.45], [0.55, 8, 0.6]] as const) {
    const b = filt(k, 'bandpass', f * mul, q), g = gain(k, amp * a * 6);
    b.frequency.setValueAtTime(f * mul * 1.25, t0);
    b.frequency.exponentialRampToValueAtTime(f * mul * 0.82, t0 + dur);
    g0.connect(b).connect(g).connect(k.out);
  }
  play(n, t0, 0.02);
  partial(k, f * 0.9, t0, amp * 0.5, dur, { glide: 0.6, glideTime: dur * 0.6 });
}

// ───────── generators ─────────
type Gen = (k: Kit) => void;
interface GenDef { label: string; cat: string; len: [number, number]; gen: Gen; pitched?: boolean }

export const GENERATORS: Record<string, GenDef> = {
  // ── Pops & bloops (signature "ear-tickle" family)
  bloop: { label: 'Bloop', cat: 'Pops & Bloops', len: [0.08, 0.22], pitched: true, gen: (k) => {
    const f = k.hz(420 + k.p.bright * 380);
    bubble(k, 0, f, 1.9 + k.r() * 0.6, k.L, 0.9);
    click(k, 0, f * 4, 2, 0.08 + k.p.bright * 0.1, 0.004, 'highpass');
  } },
  pop: { label: 'Mouth Pop', cat: 'Pops & Bloops', len: [0.06, 0.16], pitched: true, gen: (k) => {
    formantPop(k, 0, k.hz(700 + k.p.bright * 600), 0.8, k.L);
    partial(k, k.hz(160), 0, 0.35 + k.p.drive * 0.4, 0.05, { glide: 0.5 });
  } },
  cork: { label: 'Cork Pop', cat: 'Pops & Bloops', len: [0.1, 0.25], gen: (k) => {
    click(k, 0, k.hz(1800), 1.2, 0.5, 0.008);
    formantPop(k, 0.002, k.hz(520 + k.p.bright * 300), 0.7, k.L);
    partial(k, k.hz(220), 0, 0.4, 0.09, { glide: 0.55 });
  } },
  bubblepop: { label: 'Bubble Pop', cat: 'Pops & Bloops', len: [0.04, 0.1], pitched: true, gen: (k) => {
    click(k, 0, k.hz(3500 + k.p.bright * 3000), 1.5, 0.35, 0.006);
    partial(k, k.hz(1600 + k.p.bright * 1400), 0, 0.5, k.L, { glide: 1.35, glideTime: k.L * 0.5 });
  } },
  boop: { label: 'Boop', cat: 'Pops & Bloops', len: [0.08, 0.2], pitched: true, gen: (k) => {
    const f = k.hz(330 + k.p.bright * 300);
    partial(k, f, 0, 0.9, k.L, { type: 'triangle', glide: 0.82, glideTime: k.L * 0.8, attack: 0.004 });
    partial(k, f * 2, 0, 0.15, k.L * 0.5);
  } },
  plip: { label: 'Plip', cat: 'Pops & Bloops', len: [0.04, 0.1], pitched: true, gen: (k) => {
    partial(k, k.hz(900 + k.p.bright * 900), 0, 0.7, k.L, { glide: 1.6, glideTime: k.L * 0.4 });
  } },
  doublepop: { label: 'Double Pop', cat: 'Pops & Bloops', len: [0.12, 0.25], pitched: true, gen: (k) => {
    const f = k.hz(500 + k.p.bright * 300);
    bubble(k, 0, f, 2, 0.09, 0.8);
    bubble(k, k.L * 0.45, f * 1.34, 2, 0.09, 0.65);
  } },
  // ── Water
  droplet: { label: 'Water Drop', cat: 'Water', len: [0.12, 0.35], pitched: true, gen: (k) => {
    const f = k.hz(700 + k.p.bright * 500);
    click(k, 0, 2500, 1, 0.12, 0.006);
    bubble(k, 0.004, f, 2.4, k.L * 0.55, 0.85);
    bubble(k, 0.02 + k.r() * 0.03, f * 1.7, 2, k.L * 0.3, 0.25);
  } },
  plop: { label: 'Plop', cat: 'Water', len: [0.15, 0.4], gen: (k) => {
    const f = k.hz(260 + k.p.bright * 220);
    click(k, 0, 900, 0.8, 0.25, 0.012, 'lowpass');
    bubble(k, 0.006, f, 1.8, k.L * 0.6, 0.9);
    for (let i = 0; i < 3; i++) bubble(k, 0.05 + k.r() * k.L * 0.5, f * (2 + k.r() * 2), 2.2, 0.05 + k.r() * 0.04, 0.12 + k.r() * 0.1);
  } },
  bubbles: { label: 'Bubbles', cat: 'Water', len: [0.4, 1.2], gen: (k) => {
    const n = 6 + Math.floor(k.r() * 8);
    for (let i = 0; i < n; i++) bubble(k, Math.pow(k.r(), 1.4) * k.L, k.hz(400 + k.r() * 900 + k.p.bright * 400), 1.8 + k.r(), 0.04 + k.r() * 0.07, 0.25 + k.r() * 0.4);
  } },
  splash: { label: 'Mini Splash', cat: 'Water', len: [0.25, 0.6], gen: (k) => {
    const n = noise(k, k.L, 'pink'), b = filt(k, 'bandpass', k.hz(2200), 0.7), g = gain(k, 0);
    adsr(g.gain, 0, 0.003, 0.55, k.L * 0.7, 4);
    n.connect(b).connect(g).connect(k.out); play(n, 0, k.L);
    GENERATORS.plop.gen({ ...k, L: k.L * 0.6 });
  } },
  // ── Mallets & glass
  mallet: { label: 'Soft Mallet', cat: 'Mallets & Glass', len: [0.25, 0.7], pitched: true, gen: (k) => {
    const f = k.hz(520);
    partial(k, f, 0, 0.8, k.L, { glide: 0.985, glideTime: 0.03, attack: 0.002 });
    partial(k, f * 4, 0, 0.18 + k.p.bright * 0.2, k.L * 0.25);
    partial(k, f * 9.9, 0, 0.05 * k.p.bright, k.L * 0.08);
    click(k, 0, f * 6, 2, 0.06, 0.003);
  } },
  kalimba: { label: 'Kalimba', cat: 'Mallets & Glass', len: [0.3, 0.9], pitched: true, gen: (k) => {
    const f = k.hz(660);
    partial(k, f, 0, 0.7, k.L, { attack: 0.001 });
    partial(k, f * 5.4, 0, 0.14 + k.p.bright * 0.12, k.L * 0.18);
    partial(k, f * 2.01, 0, 0.12, k.L * 0.4);
  } },
  glass: { label: 'Glass Plink', cat: 'Mallets & Glass', len: [0.25, 0.8], pitched: true, gen: (k) => {
    const f = k.hz(1700 + k.p.bright * 900);
    for (const [m, a, d] of [[1, 0.5, 1], [2.76, 0.22, 0.6], [5.4, 0.12, 0.35], [8.93, 0.06, 0.2]]) partial(k, f * m, 0, a, k.L * d, { attack: 0.001 });
  } },
  chime: { label: 'Soft Chime', cat: 'Mallets & Glass', len: [0.6, 1.5], pitched: true, gen: (k) => {
    [0, 4, 7, 12].forEach((s, i) => partial(k, k.hz(660) * Math.pow(2, s / 12), i * 0.06, 0.32, k.L * (1 - i * 0.12), { attack: 0.002 }));
  } },
  // ── Ticks & UI
  tick: { label: 'Soft Tick', cat: 'Ticks & UI', len: [0.02, 0.06], pitched: true, gen: (k) => {
    click(k, 0, k.hz(3200 + k.p.bright * 2500), 3, 0.5, 0.006);
    partial(k, k.hz(1250), 0, 0.3, k.L);
  } },
  tap: { label: 'Tap', cat: 'Ticks & UI', len: [0.03, 0.08], pitched: true, gen: (k) => {
    click(k, 0, k.hz(1400 + k.p.bright * 1000), 2, 0.45, 0.01, 'bandpass');
    partial(k, k.hz(420), 0, 0.35, k.L, { glide: 0.7 });
  } },
  toggle: { label: 'Toggle', cat: 'Ticks & UI', len: [0.06, 0.15], pitched: true, gen: (k) => {
    GENERATORS.tick.gen({ ...k, L: 0.03 });
    partial(k, k.hz(880), 0.035, 0.35, k.L, { glide: 1.12 });
  } },
  notify: { label: 'Notify', cat: 'Ticks & UI', len: [0.3, 0.7], pitched: true, gen: (k) => {
    partial(k, k.hz(880), 0, 0.45, k.L * 0.6, { attack: 0.002 });
    partial(k, k.hz(1318), 0.09, 0.4, k.L * 0.8, { attack: 0.002 });
  } },
  typing: { label: 'Typing', cat: 'Ticks & UI', len: [0.5, 1.6], gen: (k) => {
    let tt = 0;
    while (tt < k.L - 0.04) { click(k, tt, k.hz(2600 + k.r() * 1800), 3, 0.35 + k.r() * 0.2, 0.006); partial(k, k.hz(900 + k.r() * 500), tt, 0.18, 0.025); tt += 0.06 + k.r() * 0.11; }
  } },
  // ── Squish & goo
  squish: { label: 'Squish', cat: 'Squish & Goo', len: [0.15, 0.4], gen: (k) => {
    const n = noise(k, k.L, 'pink'), b = filt(k, 'bandpass', k.hz(500), 4), g = gain(k, 0);
    b.frequency.setValueAtTime(k.hz(350), 0); b.frequency.exponentialRampToValueAtTime(k.hz(1300 + k.p.bright * 900), k.L * 0.6); b.frequency.exponentialRampToValueAtTime(k.hz(600), k.L);
    adsr(g.gain, 0, k.L * 0.15, 1.1, k.L * 0.8, 3);
    n.connect(b).connect(g).connect(k.out); play(n, 0, k.L);
    bubble(k, k.L * 0.55, k.hz(300), 1.7, 0.08, 0.35);
  } },
  goo: { label: 'Goo Stretch', cat: 'Squish & Goo', len: [0.3, 0.8], gen: (k) => {
    const o = osc(k, 'sine', k.hz(140)), lfo = osc(k, 'sine', 22), lg = gain(k, k.hz(30)), g = gain(k, 0);
    lfo.connect(lg).connect(o.frequency);
    o.frequency.setValueAtTime(k.hz(140), 0); o.frequency.exponentialRampToValueAtTime(k.hz(260), k.L);
    adsr(g.gain, 0, 0.03, 0.5, k.L, 3);
    o.connect(g).connect(k.out); play(o, 0, k.L); play(lfo, 0, k.L);
    GENERATORS.squish.gen({ ...k, L: k.L * 0.6 });
  } },
  boing: { label: 'Soft Boing', cat: 'Squish & Goo', len: [0.25, 0.6], pitched: true, gen: (k) => {
    const o = osc(k, 'sine', k.hz(220)), lfo = osc(k, 'sine', 16), lg = gain(k, 0), g = gain(k, 0);
    lg.gain.setValueAtTime(k.hz(40), 0); lg.gain.setTargetAtTime(0, 0.02, k.L * 0.35);
    lfo.connect(lg).connect(o.frequency);
    o.frequency.setValueAtTime(k.hz(160), 0); o.frequency.exponentialRampToValueAtTime(k.hz(300), k.L * 0.4);
    adsr(g.gain, 0, 0.004, 0.6, k.L, 3.5);
    o.connect(g).connect(k.out); play(o, 0, k.L); play(lfo, 0, k.L);
  } },
  // ── Air & whoosh (smooth, never harsh)
  swish: { label: 'Soft Swish', cat: 'Whoosh', len: [0.12, 0.35], gen: (k) => airMove(k, 1800, 5200, 0.5) },
  whoosh: { label: 'Whoosh', cat: 'Whoosh', len: [0.35, 1.2], gen: (k) => airMove(k, 300, 2600, 0.55) },
  swoosh: { label: 'Swoosh', cat: 'Whoosh', len: [0.2, 0.6], gen: (k) => airMove(k, 700, 3800, 0.45) },
  zip: { label: 'Zip', cat: 'Whoosh', len: [0.08, 0.2], pitched: true, gen: (k) => { airMove(k, 2500, 7000, 0.6); partial(k, k.hz(600), 0, 0.2, k.L, { glide: 2.2 }); } },
  // ── Impact (round, not harsh)
  thump: { label: 'Soft Thump', cat: 'Impact', len: [0.15, 0.4], gen: (k) => {
    partial(k, k.hz(110), 0, 1, k.L, { glide: 0.55, glideTime: k.L * 0.4, attack: 0.002 });
    click(k, 0, 600, 0.7, 0.25, 0.012, 'lowpass');
  } },
  impact: { label: 'Impact', cat: 'Impact', len: [0.5, 1.6], gen: (k) => {
    partial(k, k.hz(120), 0, 1, k.L, { glide: 0.35, glideTime: 0.3, attack: 0.002 });
    const n = noise(k, 0.5, 'brown'), lp = filt(k, 'lowpass', 1200 + k.p.bright * 3000), g = gain(k, 0);
    adsr(g.gain, 0, 0.002, 0.8, 0.35, 4); n.connect(lp).connect(g).connect(k.out); play(n, 0, 0.5);
  } },
  boom: { label: 'Boom', cat: 'Impact', len: [1.5, 3.5], gen: (k) => {
    partial(k, k.hz(60), 0, 1, k.L, { glide: 0.5, glideTime: k.L, attack: 0.004 });
    const n = noise(k, k.L, 'brown'), lp = filt(k, 'lowpass', 500), g = gain(k, 0);
    adsr(g.gain, 0, 0.004, 0.7, k.L * 0.8, 5); n.connect(lp).connect(g).connect(k.out); play(n, 0, k.L);
  } },
  // ── Risers & transitions
  riser: { label: 'Riser', cat: 'Riser', len: [1, 4], gen: (k) => {
    const n = noise(k, k.L, 'pink'), b = filt(k, 'bandpass', 400, 1.2), g = gain(k, 0);
    b.frequency.setValueAtTime(k.hz(300), 0); b.frequency.exponentialRampToValueAtTime(k.hz(6000 + 4000 * k.p.bright), k.L);
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.6, k.L * 0.97); g.gain.linearRampToValueAtTime(0, k.L);
    n.connect(b).connect(g).connect(k.out); play(n, 0, k.L);
    for (const det of [0, 7, 12]) { const o = osc(k, 'triangle', k.hz(220) * Math.pow(2, det / 12)), og = gain(k, 0); o.frequency.exponentialRampToValueAtTime(k.hz(660) * Math.pow(2, det / 12), k.L); og.gain.setValueAtTime(0, 0); og.gain.linearRampToValueAtTime(0.08, k.L * 0.97); og.gain.linearRampToValueAtTime(0, k.L); o.connect(og).connect(k.out); play(o, 0, k.L); }
  } },
  reverse: { label: 'Reverse Swell', cat: 'Riser', len: [0.6, 2], gen: (k) => {
    const n = noise(k, k.L, 'pink'), hp = filt(k, 'highpass', 2500), g = gain(k, 0);
    g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.7, k.L * 0.96); g.gain.linearRampToValueAtTime(0, k.L);
    n.connect(hp).connect(g).connect(k.out); play(n, 0, k.L);
  } },
  sparkle: { label: 'Sparkle', cat: 'Magic', len: [0.6, 1.6], gen: (k) => {
    const n = 8 + Math.floor(k.r() * 10);
    for (let i = 0; i < n; i++) { const pn = pan(k, (k.r() * 2 - 1) * k.p.width); pn.connect(k.out); partial(k, k.hz(2000 + k.r() * 2600), Math.pow(k.r(), 1.3) * k.L * 0.7, 0.12, 0.18 + k.r() * 0.2, { out: pn }); }
  } },
  glitch: { label: 'Glitch', cat: 'Glitch', len: [0.15, 0.6], gen: (k) => {
    const steps = 5 + Math.floor(k.r() * 8);
    for (let i = 0; i < steps; i++) { const t0 = (i / steps) * k.L; if (k.r() < 0.5) partial(k, k.hz(200 + k.r() * 1800), t0, 0.25, k.L / steps, { type: 'square' }); else click(k, t0, k.hz(500 + k.r() * 5000), 2, 0.4, k.L / steps); }
  } },
};

/** Smooth air movement (two band-passed pink noise streams with a skewed swell). */
function airMove(k: Kit, f0: number, f1: number, peakAt: number) {
  for (const side of [-1, 1]) {
    const n = noise(k, k.L + 0.1, 'pink'), b = filt(k, 'bandpass', f0, 0.9), lp = filt(k, 'lowpass', 9000), g = gain(k, 0), p = pan(k, side * 0.35 * k.p.width);
    const lo = k.hz(f0 * (0.9 + 0.2 * k.p.bright)), hi = k.hz(f1 * (0.7 + 0.5 * k.p.bright)) * (side > 0 ? 1.08 : 0.94);
    b.frequency.setValueAtTime(lo, 0);
    b.frequency.exponentialRampToValueAtTime(hi, k.L * peakAt);
    b.frequency.exponentialRampToValueAtTime(lo * 0.8, k.L);
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.7, k.L * peakAt);
    g.gain.exponentialRampToValueAtTime(0.0001, k.L);
    n.connect(b).connect(lp).connect(g).connect(p).connect(k.out);
    play(n, 0, k.L);
  }
}

export const CATEGORIES = [...new Set(Object.values(GENERATORS).map((g) => g.cat))];

// ───────── mastering ─────────
function room(ctx: Ctx, secs: number, seed: number) {
  const n = Math.ceil(secs * SR), b = ctx.createBuffer(2, n, SR);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c), r = rng(seed + c * 31);
    // a few early reflections + a soft, darkening diffuse tail
    for (const [t, a] of [[0.007, 0.5], [0.013, 0.35], [0.021, 0.3], [0.029, 0.2]]) d[Math.floor((t + c * 0.0013) * SR)] += a;
    let lp = 0;
    for (let i = Math.floor(0.012 * SR); i < n; i++) { lp += ((r() * 2 - 1) - lp) * (0.35 - 0.25 * (i / n)); d[i] += lp * Math.pow(1 - i / n, 3) * 0.6; }
  }
  return b;
}

export async function render(p: SoundParams): Promise<AudioBuffer> {
  const G = GENERATORS[p.gen] ?? GENERATORS.bloop;
  const L = Math.max(0.02, p.length);
  const tail = 0.08 + p.reverb * 0.9;
  const ctx = new OfflineAudioContext(2, Math.ceil((L * 1.6 + tail + 0.05) * SR), SR);
  const bus = ctx.createGain();
  // master: low cut → air shelf → saturation → (room) → compressor
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = 0.7;
  const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = 1.5 + p.bright * 2;
  const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 320; mud.Q.value = 0.9; mud.gain.value = -2;
  const sat = ctx.createWaveShaper();
  const k = 1 + p.drive * 4, curve = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) { const x = (i / 2047) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
  sat.curve = curve; sat.oversample = '4x';
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 2.5; comp.attack.value = 0.004; comp.release.value = 0.12; comp.knee.value = 8;
  bus.connect(hp).connect(mud).connect(air).connect(sat);
  const dry = ctx.createGain(); sat.connect(dry).connect(comp);
  if (p.reverb > 0.01) {
    const cv = ctx.createConvolver(); cv.buffer = room(ctx, 0.25 + p.reverb * 1.1, p.seed);
    const wet = ctx.createGain(); wet.gain.value = p.reverb * 0.45;
    const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 5500;
    sat.connect(cv).connect(wlp).connect(wet).connect(comp);
  }
  // micro stereo width: Haas delay on one side
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2), dl = ctx.createDelay(0.01);
  dl.delayTime.value = 0.0004 + p.width * 0.0006;
  comp.connect(split); split.connect(merge, 0, 0); split.connect(dl, 1).connect(merge, 0, 1);
  merge.connect(ctx.destination);
  const r = rng(p.seed * 7 + 3);
  const semis = Math.pow(2, p.pitch / 12);
  G.gen({ ctx, out: bus, p, r, L, st: semis, hz: (f) => f * semis });
  const buf = await ctx.startRendering();
  // soft clip + 2 ms fades + normalise to -1 dBTP (then user volume)
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c), f = Math.floor(0.002 * SR);
    for (let i = 0; i < d.length; i++) { d[i] = Math.tanh(d[i] * 1.1) / Math.tanh(1.1); if (i < 24) d[i] *= i / 24; if (i > d.length - f) d[i] *= (d.length - i) / f; peak = Math.max(peak, Math.abs(d[i])); }
  }
  const target = Math.pow(10, (-1 + Math.min(0, p.volume)) / 20);
  if (peak > 0) for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c), g = target / peak; for (let i = 0; i < d.length; i++) d[i] *= g; }
  return trimSilence(buf);
}

/** Cut trailing silence (keeps files small and timelines tidy). */
function trimSilence(buf: AudioBuffer) {
  let end = buf.length;
  const th = 0.0008;
  outer: for (let i = buf.length - 1; i > 0; i--) for (let c = 0; c < buf.numberOfChannels; c++) if (Math.abs(buf.getChannelData(c)[i]) > th) { end = i + 1; break outer; }
  const n = Math.min(buf.length, end + Math.floor(0.01 * buf.sampleRate));
  if (n >= buf.length) return buf;
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: n, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(0, n), c);
  return out;
}

/** 24-bit PCM WAV encoder. */
export function toWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels, n = buf.length, bps = 3;
  const out = new ArrayBuffer(44 + n * ch * bps);
  const v = new DataView(out);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * bps, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, 24, true);
  w(36, 'data'); v.setUint32(40, n * ch * bps, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const x = Math.round(Math.max(-1, Math.min(1, data[c][i])) * 8388607);
    v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255);
    o += 3;
  }
  return out;
}

// ───────── preset bank ─────────
const FLAVORS = ['Soft', 'Round', 'Juicy', 'Tiny', 'Bubbly', 'Warm', 'Crisp', 'Velvet', 'Wet', 'Plump', 'Airy', 'Cute', 'Deep', 'Glassy', 'Cozy', 'Clean', 'Silky', 'Bouncy', 'Glossy', 'Mellow'];
export interface Preset { id: string; name: string; cat: string; p: SoundParams }
export function presetBank(): Preset[] {
  const out: Preset[] = [];
  const keys = Object.keys(GENERATORS);
  const heavy = new Set(['Pops & Bloops', 'Water', 'Mallets & Glass', 'Ticks & UI', 'Squish & Goo']);
  keys.forEach((gen, gi) => {
    const G = GENERATORS[gen];
    const per = heavy.has(G.cat) ? 24 : 12;
    for (let i = 0; i < per; i++) {
      const r = rng(gi * 1000 + i * 17 + 5);
      const fl = FLAVORS[(i + gi * 3) % FLAVORS.length];
      const bright = fl === 'Deep' || fl === 'Warm' || fl === 'Mellow' || fl === 'Velvet' ? 0.15 + r() * 0.2 : fl === 'Crisp' || fl === 'Glassy' || fl === 'Glossy' || fl === 'Tiny' ? 0.7 + r() * 0.3 : 0.35 + r() * 0.35;
      const len = G.len[0] + (G.len[1] - G.len[0]) * (fl === 'Tiny' ? r() * 0.3 : fl === 'Plump' || fl === 'Deep' ? 0.6 + r() * 0.4 : r());
      out.push({
        id: `${gen}-${i}`, name: `${G.label} · ${fl} ${i + 1}`, cat: G.cat,
        p: { gen, length: +len.toFixed(3), pitch: Math.round((r() - 0.5) * 10) - (fl === 'Deep' ? 5 : 0) + (fl === 'Tiny' || fl === 'Cute' ? 4 : 0), bright: +bright.toFixed(2),
          reverb: fl === 'Wet' || fl === 'Cozy' ? 0.35 + r() * 0.2 : 0.08 + r() * 0.18, width: 0.4 + r() * 0.5, drive: fl === 'Juicy' || fl === 'Plump' ? 0.3 + r() * 0.3 : r() * 0.15, seed: gi * 100 + i, volume: -3 },
      });
    }
  });
  return out;
}

export function drawWave(buf: AudioBuffer, c: HTMLCanvasElement, color = '#d1fe17') {
  const r = c.getBoundingClientRect(), W = Math.max(60, r.width || 130), H = Math.max(30, r.height || 56);
  const dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / W));
  g.fillStyle = color;
  for (let x = 0; x < W; x++) {
    let mx = 0;
    for (let i = x * step; i < (x + 1) * step && i < d.length; i++) mx = Math.max(mx, Math.abs(d[i]));
    const hh = Math.max(1, mx * (H - 6));
    g.fillRect(x, (H - hh) / 2, 1, hh);
  }
}

export const isPitched = (gen: string) => !!GENERATORS[gen]?.pitched;
