// Kinetix Sound Lab: every sound is synthesised from scratch with the Web Audio
// API (OfflineAudioContext) — no samples, no licensing issues, endless variations.

import { rng } from '../core/math';

export interface SoundParams {
  gen: string;
  length: number;   // seconds
  pitch: number;    // semitones offset
  bright: number;   // 0..1 filter brightness
  reverb: number;   // 0..1 wet
  width: number;    // 0..1 stereo width / pan motion
  drive: number;    // 0..1 saturation
  seed: number;
  volume: number;   // dB
}

type Ctx = OfflineAudioContext;
const SR = 48000;

function noiseBuffer(ctx: Ctx, secs: number, seed: number, pink = false) {
  const n = Math.ceil(secs * SR);
  const b = ctx.createBuffer(2, n, SR);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c), r = rng(seed + c * 7919);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      if (pink) { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else d[i] = w;
    }
  }
  return b;
}

function impulse(ctx: Ctx, secs: number, decay: number, seed: number) {
  const n = Math.ceil(secs * SR), b = ctx.createBuffer(2, n, SR);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c), r = rng(seed + c * 31);
    for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return b;
}

function shaper(ctx: Ctx, amount: number) {
  const ws = ctx.createWaveShaper();
  const k = amount * 60 + 1, n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

interface Kit { ctx: Ctx; out: AudioNode; p: SoundParams; r: () => number; L: number; hz: (f: number) => number }
type Gen = (k: Kit) => void;

const env = (g: AudioParam, pts: [number, number][], curve: 'lin' | 'exp' = 'lin') => {
  g.setValueAtTime(pts[0][1], pts[0][0]);
  for (let i = 1; i < pts.length; i++) {
    const [t, v] = pts[i];
    if (curve === 'exp') g.exponentialRampToValueAtTime(Math.max(1e-4, v), t); else g.linearRampToValueAtTime(v, t);
  }
};

function noiseVoice(k: Kit, pink = true) {
  const s = k.ctx.createBufferSource();
  s.buffer = noiseBuffer(k.ctx, k.L + 0.1, k.p.seed, pink);
  return s;
}
function osc(k: Kit, type: OscillatorType, f: number) {
  const o = k.ctx.createOscillator();
  o.type = type; o.frequency.value = f;
  return o;
}
function panner(k: Kit, from: number, to: number) {
  const p = k.ctx.createStereoPanner();
  env(p.pan, [[0, from * k.p.width], [k.L, to * k.p.width]]);
  return p;
}

// ───────── generators ─────────
export const GENERATORS: Record<string, { label: string; cat: string; len: [number, number]; gen: Gen }> = {
  whoosh: { label: 'Whoosh', cat: 'Whoosh', len: [0.5, 1.6], gen: (k) => {
    const n = noiseVoice(k), bp = k.ctx.createBiquadFilter(), g = k.ctx.createGain(), pn = panner(k, -1, 1);
    bp.type = 'bandpass'; bp.Q.value = 1.2 + k.r() * 2;
    const lo = k.hz(250), hi = k.hz(1800 + k.p.bright * 4000);
    env(bp.frequency, [[0, lo], [k.L * 0.55, hi], [k.L, lo * 0.8]], 'exp');
    env(g.gain, [[0, 0.0001], [k.L * 0.55, 1], [k.L, 0.0001]], 'exp');
    n.connect(bp).connect(g).connect(pn).connect(k.out); n.start(0); n.stop(k.L);
  } },
  swoosh: { label: 'Swoosh', cat: 'Whoosh', len: [0.25, 0.6], gen: (k) => GENERATORS.whoosh.gen({ ...k }) },
  swish: { label: 'Swish', cat: 'Whoosh', len: [0.1, 0.3], gen: (k) => {
    const n = noiseVoice(k, false), hp = k.ctx.createBiquadFilter(), g = k.ctx.createGain();
    hp.type = 'highpass'; env(hp.frequency, [[0, k.hz(2000)], [k.L, k.hz(7000 + 4000 * k.p.bright)]], 'exp');
    env(g.gain, [[0, 0.0001], [k.L * 0.3, 0.9], [k.L, 0.0001]], 'exp');
    n.connect(hp).connect(g).connect(panner(k, 0.6, -0.6)).connect(k.out); n.start(0); n.stop(k.L);
  } },
  riser: { label: 'Riser', cat: 'Riser', len: [1.5, 5], gen: (k) => {
    const n = noiseVoice(k), lp = k.ctx.createBiquadFilter(), gn = k.ctx.createGain();
    lp.type = 'lowpass'; env(lp.frequency, [[0, k.hz(300)], [k.L, k.hz(9000 + 6000 * k.p.bright)]], 'exp');
    env(gn.gain, [[0, 0.0001], [k.L * 0.98, 0.7], [k.L, 0.0001]], 'exp');
    n.connect(lp).connect(gn).connect(k.out); n.start(0); n.stop(k.L);
    for (const det of [-7, 0, 7, 12]) {
      const o = osc(k, 'sawtooth', k.hz(110) * Math.pow(2, det / 12)), og = k.ctx.createGain(), f = k.ctx.createBiquadFilter();
      env(o.frequency, [[0, k.hz(110) * Math.pow(2, det / 12)], [k.L, k.hz(440) * Math.pow(2, det / 12)]], 'exp');
      f.type = 'lowpass'; env(f.frequency, [[0, 400], [k.L, 6000]], 'exp');
      env(og.gain, [[0, 0.0001], [k.L * 0.98, 0.12], [k.L, 0.0001]], 'exp');
      o.connect(f).connect(og).connect(k.out); o.start(0); o.stop(k.L);
    }
  } },
  downer: { label: 'Downer', cat: 'Riser', len: [0.8, 3], gen: (k) => {
    for (const det of [0, 5, 12]) {
      const o = osc(k, 'sawtooth', k.hz(600)), og = k.ctx.createGain(), f = k.ctx.createBiquadFilter();
      env(o.frequency, [[0, k.hz(600) * Math.pow(2, det / 12)], [k.L, k.hz(60)]], 'exp');
      f.type = 'lowpass'; env(f.frequency, [[0, 5000 * (0.5 + k.p.bright)], [k.L, 200]], 'exp');
      env(og.gain, [[0, 0.2], [k.L, 0.0001]], 'exp');
      o.connect(f).connect(og).connect(k.out); o.start(0); o.stop(k.L);
    }
  } },
  impact: { label: 'Impact', cat: 'Impact', len: [0.8, 2.5], gen: (k) => {
    const o = osc(k, 'sine', k.hz(120)), g = k.ctx.createGain(), d = shaper(k.ctx, 0.3 + k.p.drive);
    env(o.frequency, [[0, k.hz(140)], [0.25, k.hz(42)]], 'exp');
    env(g.gain, [[0, 1], [k.L, 0.0001]], 'exp');
    o.connect(d).connect(g).connect(k.out); o.start(0); o.stop(k.L);
    const n = noiseVoice(k), lp = k.ctx.createBiquadFilter(), ng = k.ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = k.hz(1500 + 5000 * k.p.bright);
    env(ng.gain, [[0, 0.8], [0.35, 0.0001]], 'exp');
    n.connect(lp).connect(ng).connect(k.out); n.start(0); n.stop(0.4);
  } },
  boom: { label: 'Cinematic Boom', cat: 'Impact', len: [2, 5], gen: (k) => {
    const o = osc(k, 'sine', k.hz(55)), g = k.ctx.createGain();
    env(o.frequency, [[0, k.hz(70)], [k.L, k.hz(30)]], 'exp');
    env(g.gain, [[0, 1], [k.L, 0.0001]], 'exp');
    o.connect(shaper(k.ctx, 0.2 + k.p.drive)).connect(g).connect(k.out); o.start(0); o.stop(k.L);
    const n = noiseVoice(k), lp = k.ctx.createBiquadFilter(), ng = k.ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = k.hz(400 + 900 * k.p.bright);
    env(ng.gain, [[0, 0.9], [k.L, 0.0001]], 'exp');
    n.connect(lp).connect(ng).connect(k.out); n.start(0); n.stop(k.L);
  } },
  hit: { label: 'Punch Hit', cat: 'Impact', len: [0.25, 0.7], gen: (k) => {
    const o = osc(k, 'sine', k.hz(180)), g = k.ctx.createGain();
    env(o.frequency, [[0, k.hz(220)], [0.08, k.hz(60)]], 'exp');
    env(g.gain, [[0, 1], [k.L, 0.0001]], 'exp');
    o.connect(shaper(k.ctx, 0.4 + k.p.drive)).connect(g).connect(k.out); o.start(0); o.stop(k.L);
    const n = noiseVoice(k, false), hp = k.ctx.createBiquadFilter(), ng = k.ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = k.hz(2000);
    env(ng.gain, [[0, 0.6 * (0.4 + k.p.bright)], [0.04, 0.0001]], 'exp');
    n.connect(hp).connect(ng).connect(k.out); n.start(0); n.stop(0.05);
  } },
  subdrop: { label: 'Sub Drop', cat: 'Impact', len: [1.2, 4], gen: (k) => {
    const o = osc(k, 'sine', k.hz(90)), g = k.ctx.createGain();
    env(o.frequency, [[0, k.hz(90)], [k.L, k.hz(25)]], 'exp');
    env(g.gain, [[0, 1], [k.L, 0.0001]], 'exp');
    o.connect(shaper(k.ctx, 0.1 + k.p.drive * 0.5)).connect(g).connect(k.out); o.start(0); o.stop(k.L);
  } },
  pop: { label: 'Pop', cat: 'Pop & Click', len: [0.06, 0.2], gen: (k) => {
    const o = osc(k, 'sine', k.hz(400)), g = k.ctx.createGain();
    env(o.frequency, [[0, k.hz(300 + 400 * k.p.bright)], [k.L * 0.5, k.hz(900 + 900 * k.p.bright)], [k.L, k.hz(500)]], 'exp');
    env(g.gain, [[0, 0.0001], [0.004, 0.9], [k.L, 0.0001]], 'exp');
    o.connect(g).connect(k.out); o.start(0); o.stop(k.L);
  } },
  bubble: { label: 'Bubble', cat: 'Pop & Click', len: [0.1, 0.35], gen: (k) => {
    const o = osc(k, 'sine', k.hz(300)), g = k.ctx.createGain();
    env(o.frequency, [[0, k.hz(250)], [k.L, k.hz(1400 + 1200 * k.p.bright)]], 'exp');
    env(g.gain, [[0, 0.0001], [0.01, 0.7], [k.L, 0.0001]], 'exp');
    o.connect(g).connect(k.out); o.start(0); o.stop(k.L);
  } },
  click: { label: 'Click', cat: 'Pop & Click', len: [0.02, 0.08], gen: (k) => {
    const n = noiseVoice(k, false), bp = k.ctx.createBiquadFilter(), g = k.ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = k.hz(2500 + 4000 * k.p.bright); bp.Q.value = 4;
    env(g.gain, [[0, 1], [k.L, 0.0001]], 'exp');
    n.connect(bp).connect(g).connect(k.out); n.start(0); n.stop(k.L);
  } },
  ui: { label: 'UI Blip', cat: 'UI', len: [0.12, 0.4], gen: (k) => {
    const notes = [0, 7, 12].slice(0, 2 + Math.floor(k.r() * 2));
    notes.forEach((st, i) => {
      const t0 = (i * k.L) / notes.length, o = osc(k, k.r() > 0.5 ? 'sine' : 'triangle', k.hz(880) * Math.pow(2, st / 12)), g = k.ctx.createGain();
      env(g.gain, [[t0, 0.0001], [t0 + 0.005, 0.5], [t0 + k.L / notes.length, 0.0001]], 'exp');
      o.connect(g).connect(k.out); o.start(t0); o.stop(t0 + k.L / notes.length + 0.02);
    });
  } },
  success: { label: 'Success Chime', cat: 'UI', len: [0.5, 1.2], gen: (k) => {
    [0, 4, 7, 12].forEach((st, i) => {
      const t0 = i * 0.07, o = osc(k, 'sine', k.hz(660) * Math.pow(2, st / 12)), g = k.ctx.createGain();
      env(g.gain, [[t0, 0.0001], [t0 + 0.01, 0.35], [k.L, 0.0001]], 'exp');
      o.connect(g).connect(k.out); o.start(t0); o.stop(k.L);
    });
  } },
  error: { label: 'Error Buzz', cat: 'UI', len: [0.2, 0.5], gen: (k) => {
    const o = osc(k, 'square', k.hz(140)), g = k.ctx.createGain(), f = k.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1200 + 2000 * k.p.bright;
    env(g.gain, [[0, 0.3], [k.L * 0.45, 0.3], [k.L * 0.5, 0.0001], [k.L * 0.55, 0.3], [k.L, 0.0001]]);
    o.connect(f).connect(g).connect(k.out); o.start(0); o.stop(k.L);
  } },
  glitch: { label: 'Glitch', cat: 'Glitch', len: [0.2, 0.9], gen: (k) => {
    const steps = 6 + Math.floor(k.r() * 10);
    for (let i = 0; i < steps; i++) {
      const t0 = (i / steps) * k.L, d = (k.L / steps) * (0.4 + k.r() * 0.6);
      if (k.r() < 0.5) {
        const o = osc(k, k.r() > 0.5 ? 'square' : 'sawtooth', k.hz(100 + k.r() * 2000)), g = k.ctx.createGain();
        env(g.gain, [[t0, 0.25], [t0 + d, 0.25], [t0 + d + 0.002, 0]]);
        o.connect(g).connect(k.out); o.start(t0); o.stop(t0 + d + 0.01);
      } else {
        const n = noiseVoice(k, false), g = k.ctx.createGain(), f = k.ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = k.hz(500 + k.r() * 6000);
        env(g.gain, [[t0, 0.6], [t0 + d, 0.6], [t0 + d + 0.002, 0]]);
        n.connect(f).connect(g).connect(k.out); n.start(t0); n.stop(t0 + d + 0.01);
      }
    }
  } },
  sparkle: { label: 'Sparkle', cat: 'Magic', len: [0.8, 2], gen: (k) => {
    const count = 10 + Math.floor(k.r() * 12);
    for (let i = 0; i < count; i++) {
      const t0 = k.r() * k.L * 0.7, o = osc(k, 'sine', k.hz(1800 + k.r() * 3200)), g = k.ctx.createGain(), p = k.ctx.createStereoPanner();
      p.pan.value = (k.r() * 2 - 1) * k.p.width;
      env(g.gain, [[t0, 0.0001], [t0 + 0.005, 0.12], [t0 + 0.25, 0.0001]], 'exp');
      o.connect(g).connect(p).connect(k.out); o.start(t0); o.stop(t0 + 0.3);
    }
  } },
  magic: { label: 'Magic Swell', cat: 'Magic', len: [1, 3], gen: (k) => {
    [0, 4, 7, 11, 14].forEach((st) => {
      const o = osc(k, 'triangle', k.hz(440) * Math.pow(2, st / 12)), g = k.ctx.createGain();
      env(g.gain, [[0, 0.0001], [k.L * 0.6, 0.1], [k.L, 0.0001]], 'exp');
      o.connect(g).connect(k.out); o.start(0); o.stop(k.L);
    });
    GENERATORS.sparkle.gen(k);
  } },
  typing: { label: 'Typing', cat: 'Foley', len: [0.6, 2], gen: (k) => {
    let t = 0;
    while (t < k.L - 0.05) {
      const n = noiseVoice(k, false), bp = k.ctx.createBiquadFilter(), g = k.ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = k.hz(1800 + k.r() * 2500); bp.Q.value = 3;
      env(g.gain, [[t, 0.8], [t + 0.03, 0.0001]], 'exp');
      n.connect(bp).connect(g).connect(k.out); n.start(t); n.stop(t + 0.04);
      t += 0.06 + k.r() * 0.12;
    }
  } },
  shutter: { label: 'Camera Shutter', cat: 'Foley', len: [0.15, 0.3], gen: (k) => {
    for (const t0 of [0, k.L * 0.55]) {
      const n = noiseVoice(k, false), bp = k.ctx.createBiquadFilter(), g = k.ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = k.hz(3000); bp.Q.value = 1.5;
      env(g.gain, [[t0, 1], [t0 + 0.035, 0.0001]], 'exp');
      n.connect(bp).connect(g).connect(k.out); n.start(t0); n.stop(t0 + 0.05);
    }
  } },
  heartbeat: { label: 'Heartbeat', cat: 'Foley', len: [0.7, 1.2], gen: (k) => {
    for (const [t0, a] of [[0, 1], [0.22, 0.7]] as const) {
      const o = osc(k, 'sine', k.hz(60)), g = k.ctx.createGain();
      env(o.frequency, [[t0, k.hz(80)], [t0 + 0.12, k.hz(40)]], 'exp');
      env(g.gain, [[t0, 0.0001], [t0 + 0.01, a], [t0 + 0.25, 0.0001]], 'exp');
      o.connect(g).connect(k.out); o.start(t0); o.stop(t0 + 0.3);
    }
  } },
  sweep: { label: 'Transition Sweep', cat: 'Transition', len: [1, 3], gen: (k) => {
    const n = noiseVoice(k), bp = k.ctx.createBiquadFilter(), g = k.ctx.createGain();
    bp.type = 'bandpass'; bp.Q.value = 6;
    env(bp.frequency, [[0, k.hz(200)], [k.L, k.hz(8000 * (0.5 + k.p.bright))]], 'exp');
    env(g.gain, [[0, 0.0001], [k.L * 0.8, 1], [k.L, 0.0001]], 'exp');
    n.connect(bp).connect(g).connect(panner(k, -1, 1)).connect(k.out); n.start(0); n.stop(k.L);
  } },
  revcymbal: { label: 'Reverse Cymbal', cat: 'Transition', len: [1, 3], gen: (k) => {
    const n = noiseVoice(k, false), hp = k.ctx.createBiquadFilter(), g = k.ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = k.hz(4000 + 3000 * k.p.bright);
    env(g.gain, [[0, 0.0001], [k.L * 0.97, 0.8], [k.L, 0.0001]], 'exp');
    n.connect(hp).connect(g).connect(k.out); n.start(0); n.stop(k.L);
  } },
  tick: { label: 'Tick', cat: 'Pop & Click', len: [0.03, 0.06], gen: (k) => {
    const o = osc(k, 'square', k.hz(2400)), g = k.ctx.createGain();
    env(g.gain, [[0, 0.4], [k.L, 0.0001]], 'exp');
    o.connect(g).connect(k.out); o.start(0); o.stop(k.L);
  } },
  laser: { label: 'Laser Zap', cat: 'Glitch', len: [0.15, 0.5], gen: (k) => {
    const o = osc(k, 'sawtooth', k.hz(3000)), g = k.ctx.createGain();
    env(o.frequency, [[0, k.hz(3000)], [k.L, k.hz(150)]], 'exp');
    env(g.gain, [[0, 0.35], [k.L, 0.0001]], 'exp');
    o.connect(g).connect(k.out); o.start(0); o.stop(k.L);
  } },
  swell: { label: 'Tension Swell', cat: 'Riser', len: [2, 6], gen: (k) => {
    [0, 1, 7].forEach((st) => {
      const o = osc(k, 'sawtooth', k.hz(70) * Math.pow(2, st / 12)), og = k.ctx.createGain(), f = k.ctx.createBiquadFilter();
      f.type = 'lowpass'; env(f.frequency, [[0, 150], [k.L, 2500 * (0.5 + k.p.bright)]], 'exp');
      env(og.gain, [[0, 0.0001], [k.L * 0.97, 0.2], [k.L, 0.0001]], 'exp');
      o.connect(f).connect(og).connect(k.out); o.start(0); o.stop(k.L);
    });
  } },
};

export const CATEGORIES = [...new Set(Object.values(GENERATORS).map((g) => g.cat))];

/** Render a sound to an AudioBuffer. */
export async function render(p: SoundParams): Promise<AudioBuffer> {
  const L = Math.max(0.02, p.length);
  const tail = p.reverb > 0.01 ? 1.2 + p.reverb * 1.5 : 0.05;
  const ctx = new OfflineAudioContext(2, Math.ceil((L + tail) * SR), SR);
  const master = ctx.createGain();
  master.gain.value = Math.pow(10, p.volume / 20);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
  const dry = ctx.createGain();
  const bus = ctx.createGain();
  if (p.drive > 0.02) { const d = shaper(ctx, p.drive * 0.6); bus.connect(d).connect(dry); } else bus.connect(dry);
  dry.connect(master);
  if (p.reverb > 0.01) {
    const cv = ctx.createConvolver();
    cv.buffer = impulse(ctx, 1 + p.reverb * 2, 2.5, p.seed);
    const wet = ctx.createGain(); wet.gain.value = p.reverb * 0.6;
    bus.connect(cv).connect(wet).connect(master);
  }
  master.connect(comp).connect(ctx.destination);
  const r = rng(p.seed * 7 + 3);
  const semis = Math.pow(2, p.pitch / 12);
  GENERATORS[p.gen].gen({ ctx, out: bus, p, r, L, hz: (f) => f * semis });
  const buf = await ctx.startRendering();
  // normalise peaks to -1 dBFS (then apply the user volume again)
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
  const target = Math.pow(10, (-1 + Math.min(0, p.volume)) / 20);
  if (peak > 0) for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); const k = target / peak; for (let i = 0; i < d.length; i++) d[i] *= k; }
  return buf;
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
    const s = Math.max(-1, Math.min(1, data[c][i]));
    const x = Math.round(s * 8388607);
    v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255);
    o += 3;
  }
  return out;
}

// ───────── preset bank (520+) ─────────
const FLAVORS = ['Airy', 'Dark', 'Bright', 'Punchy', 'Soft', 'Wide', 'Tight', 'Heavy', 'Crisp', 'Warm', 'Cold', 'Gritty', 'Clean', 'Deep', 'Tiny', 'Huge', 'Lush', 'Dry', 'Smooth', 'Sharp', 'Vintage', 'Modern', 'Cinematic', 'Glassy'];

export interface Preset { id: string; name: string; cat: string; p: SoundParams }
export function presetBank(): Preset[] {
  const out: Preset[] = [];
  const keys = Object.keys(GENERATORS);
  const per = Math.ceil(520 / keys.length);
  keys.forEach((gen, gi) => {
    const G = GENERATORS[gen];
    for (let i = 0; i < per; i++) {
      const r = rng(gi * 1000 + i * 17 + 5);
      const fl = FLAVORS[(i + gi * 3) % FLAVORS.length];
      const bright = fl === 'Dark' || fl === 'Warm' || fl === 'Deep' ? 0.15 + r() * 0.2 : fl === 'Bright' || fl === 'Crisp' || fl === 'Glassy' || fl === 'Sharp' ? 0.75 + r() * 0.25 : r();
      const reverb = fl === 'Dry' || fl === 'Tight' ? 0 : fl === 'Lush' || fl === 'Cinematic' || fl === 'Huge' ? 0.5 + r() * 0.4 : r() * 0.35;
      const len = G.len[0] + (G.len[1] - G.len[0]) * (fl === 'Tiny' || fl === 'Tight' ? r() * 0.3 : fl === 'Huge' || fl === 'Cinematic' ? 0.7 + r() * 0.3 : r());
      out.push({
        id: `${gen}-${i}`, name: `${G.label} · ${fl} ${i + 1}`, cat: G.cat,
        p: { gen, length: +len.toFixed(2), pitch: Math.round((r() - 0.5) * (fl === 'Deep' || fl === 'Heavy' ? 14 : 8)) - (fl === 'Deep' ? 5 : 0), bright: +bright.toFixed(2), reverb: +reverb.toFixed(2), width: fl === 'Wide' ? 1 : 0.3 + r() * 0.6, drive: fl === 'Gritty' || fl === 'Punchy' ? 0.4 + r() * 0.4 : r() * 0.15, seed: gi * 100 + i, volume: -3 },
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
