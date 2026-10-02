// Per-character / word / line text motions built on AE Text Animators.
// A motion describes the *hidden* state of a unit (amount = 100%); an
// Expression Selector drives the amount per unit from timing, order and ease.

import { easeExprFn, easeFn, type EaseDef } from '../animate/eases';

export type Unit = 'char' | 'word' | 'line';
export type Order = 'start' | 'end' | 'center' | 'edges' | 'random';
export type Dir = 'up' | 'down' | 'left' | 'right' | 'front' | 'back';

export interface TypeProps {
  pos?: [number, number, number];
  scale?: [number, number, number];
  rot?: number;
  rotX?: number;
  rotY?: number;
  opacity?: number;
  blur?: number;
  tracking?: number;
  skew?: number;
  charOffset?: number;
  fillHue?: number;
}
export interface Motion { id: string; label: string; group: string; dir?: boolean; props: (d: [number, number, number], k: number) => TypeProps; ease?: string; threeD?: boolean; stepped?: boolean; scramble?: boolean; glitch?: boolean }
export interface LoopMotion { id: string; label: string; props: TypeProps; amount: string }

export const DIRV: Record<Dir, [number, number, number]> = { up: [0, -1, 0], down: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0], front: [0, 0, -1], back: [0, 0, 1] };

const m = (id: string, label: string, group: string, props: Motion['props'], extra: Partial<Motion> = {}): Motion => ({ id, label, group, props, ...extra });
const off = (d: [number, number, number], s: number): [number, number, number] => [-d[0] * s, -d[1] * s, -d[2] * s * 6];

export const MOTIONS: Motion[] = [
  m('fade', 'Fade', 'Essential', () => ({ opacity: 0 })),
  m('fade-dir', 'Fade Slide', 'Essential', (d, k) => ({ opacity: 0, pos: off(d, 40 * k) }), { dir: true }),
  m('slide', 'Slide', 'Essential', (d, k) => ({ pos: off(d, 160 * k) }), { dir: true }),
  m('rise', 'Rise', 'Essential', (_, k) => ({ opacity: 0, pos: [0, 70 * k, 0] }), { ease: 'expoOut' }),
  m('drop', 'Drop', 'Essential', (_, k) => ({ opacity: 0, pos: [0, -120 * k, 0] }), { ease: 'bounceOut' }),
  m('pop', 'Pop', 'Scale', () => ({ scale: [0, 0, 100] }), { ease: 'overshoot' }),
  m('pop-up', 'Pop Up', 'Scale', (_, k) => ({ scale: [0, 0, 100], pos: [0, 40 * k, 0] }), { ease: 'backOut' }),
  m('zoom-out', 'Zoom Down', 'Scale', (_, k) => ({ scale: [100 + 250 * k, 100 + 250 * k, 100], opacity: 0 }), { ease: 'expoOut' }),
  m('stretch', 'Stretch', 'Scale', (_, k) => ({ scale: [100, 100 + 300 * k, 100], opacity: 0 }), { ease: 'expoOut' }),
  m('squash', 'Squash In', 'Scale', (_, k) => ({ scale: [100 + 120 * k, 20, 100], opacity: 0 }), { ease: 'springWobbly' }),
  m('jelly', 'Jelly', 'Scale', () => ({ scale: [0, 0, 100] }), { ease: 'springJelly' }),
  m('blur', 'Blur In', 'Blur', (_, k) => ({ blur: 40 * k, opacity: 0 })),
  m('blur-slide', 'Blur Slide', 'Blur', (d, k) => ({ blur: 30 * k, opacity: 0, pos: off(d, 90 * k) }), { dir: true }),
  m('blur-zoom', 'Blur Zoom', 'Blur', (_, k) => ({ blur: 30 * k, opacity: 0, scale: [160, 160, 100] })),
  m('rotate', 'Rotate In', 'Rotate', (_, k) => ({ rot: -90 * k, opacity: 0 }), { ease: 'backOut' }),
  m('spin', 'Spin', 'Rotate', (_, k) => ({ rot: 360 * k, scale: [0, 0, 100] })),
  m('swing', 'Swing', 'Rotate', (_, k) => ({ rot: 35 * k, pos: [0, -30 * k, 0], opacity: 0 }), { ease: 'springDefault' }),
  m('skew', 'Skew In', 'Rotate', (d, k) => ({ skew: 50 * k * (d[0] >= 0 ? 1 : -1), opacity: 0, pos: off(d, 50 * k) }), { dir: true }),
  m('flip-x', 'Flip X', '3D', (_, k) => ({ rotX: 90 * k, opacity: 0 }), { threeD: true, ease: 'backOut' }),
  m('flip-y', 'Flip Y', '3D', (_, k) => ({ rotY: -90 * k, opacity: 0 }), { threeD: true, ease: 'backOut' }),
  m('fly-depth', 'Fly From Depth', '3D', (_, k) => ({ pos: [0, 0, -900 * k], opacity: 0 }), { threeD: true, ease: 'expoOut' }),
  m('tumble', 'Tumble', '3D', (_, k) => ({ rotX: 120 * k, rotY: 60 * k, pos: [0, 0, -400 * k], opacity: 0 }), { threeD: true }),
  m('door', 'Door Open', '3D', (_, k) => ({ rotY: 90 * k }), { threeD: true, ease: 'springGentle' }),
  m('track-in', 'Tracking In', 'Spacing', (_, k) => ({ tracking: 80 * k, opacity: 0 })),
  m('track-tight', 'Compress', 'Spacing', (_, k) => ({ tracking: -40 * k, opacity: 0, blur: 10 })),
  m('typewriter', 'Typewriter', 'Digital', () => ({ opacity: 0 }), { stepped: true, ease: 'linear' }),
  m('scramble', 'Scramble', 'Digital', () => ({ charOffset: 26 }), { scramble: true, ease: 'linear' }),
  m('glitch', 'Glitch', 'Digital', (_, k) => ({ pos: [30 * k, 0, 0], opacity: 0 }), { glitch: true }),
  m('elastic-drop', 'Elastic Drop', 'Physics', (_, k) => ({ pos: [0, -200 * k, 0] }), { ease: 'elasticOut' }),
  m('bounce-in', 'Bounce In', 'Physics', (_, k) => ({ pos: [0, -160 * k, 0], opacity: 0 }), { ease: 'bounceOut' }),
  m('spring-scale', 'Spring Scale', 'Physics', () => ({ scale: [0, 0, 100] }), { ease: 'springBouncy' }),
  m('wave-rise', 'Wave Rise', 'Physics', (_, k) => ({ pos: [0, 80 * k, 0], rot: 12 * k, opacity: 0 }), { ease: 'springGentle' }),
];
export const MOTION_GROUPS = [...new Set(MOTIONS.map((x) => x.group))];

export const LOOPS: LoopMotion[] = [
  { id: 'wave', label: 'Wave', props: { pos: [0, -24, 0] }, amount: 'Math.sin(time*S*4+i*0.55)*100' },
  { id: 'float', label: 'Float', props: { pos: [0, -14, 0], rot: 4 }, amount: 'Math.sin(time*S*2+i*1.3)*100' },
  { id: 'pulse', label: 'Pulse', props: { scale: [125, 125, 100] }, amount: 'Math.max(0,Math.sin(time*S*5-i*0.4))*100' },
  { id: 'jitter', label: 'Jitter', props: { pos: [6, 6, 0], rot: 6 }, amount: '(seedRandom(i+Math.floor(time*S*12),true),random(-100,100))' },
  { id: 'flicker', label: 'Flicker', props: { opacity: 15 }, amount: '(seedRandom(i*7+Math.floor(time*S*10),true),random(0,1)>0.85?100:0)' },
  { id: 'rainbow', label: 'Rainbow', props: { fillHue: 360 }, amount: '((i*6+time*S*40)%100)' },
  { id: 'breathe', label: 'Breathe', props: { tracking: 12 }, amount: '(Math.sin(time*S*1.6)*0.5+0.5)*100' },
  { id: 'shine', label: 'Shine Sweep', props: { scale: [112, 112, 100] }, amount: 'Math.max(0,1-Math.abs(((time*S*0.8)%2)*(n+6)-3-i)/3)*100' },
];

const BASED: Record<Unit, number> = { char: 2, word: 3, line: 4 };
const ORDER_FN: Record<Order, string> = {
  start: 'function O(i,n){return i;}',
  end: 'function O(i,n){return n-1-i;}',
  center: 'function O(i,n){return Math.abs(i-(n-1)/2);}',
  edges: 'function O(i,n){return (n-1)/2-Math.abs(i-(n-1)/2);}',
  random: 'function O(i,n){seedRandom(i*13+effect("KX Type Seed")("Slider"),true);return random(0,n-1);}',
};

export interface PhaseOpts { motion: Motion; dir: Dir; strength: number; unit: Unit; order: Order; ease: EaseDef }
export interface AnimatorSpec { name: string; basedOn: number; props: TypeProps; amount: string }
export interface TypeRecipe { animators: AnimatorSpec[]; controls: { name: string; value: number }[]; threeD: boolean; grouping: number }

/** Build the animators for in / out / loop phases. */
export function buildType(inP: PhaseOpts | null, outP: PhaseOpts | null, loop: { motion: LoopMotion; unit: Unit; strength: number } | null, timing: { inDur: number; outDur: number; stagger: number; autoFit: boolean; seed: number; speed: number }): TypeRecipe {
  const animators: AnimatorSpec[] = [];
  const amountExpr = (p: PhaseOpts, out: boolean) => {
    const st = p.motion.stepped, sc = p.motion.scramble, gl = p.motion.glitch;
    const durName = out ? 'KX Type Out Duration' : 'KX Type In Duration';
    return `// KX-TYPE ${out ? 'out' : 'in'}
${easeExprFn(p.ease, 'E')}
${ORDER_FN[p.order]}
var d=Math.max(0.001,effect("${durName}")("Slider")),s=effect("KX Type Stagger")("Slider"),fit=effect("KX Type Auto Fit")("Slider");
var i=textIndex-1,n=textTotal,mx=0;for(var q=0;q<n;q++)mx=Math.max(mx,O(q,n));
if(fit>0&&mx>0)s=Math.max(0,(fit-d)/mx);
var o=O(i,n),p;
${out ? 'var t0=outPoint-d-(mx-o)*s;p=clamp((time-t0)/d,0,1);' : 'var t0=inPoint+o*s;p=clamp((time-t0)/d,0,1);'}
${st ? 'p=p>0?1:0;' : ''}
var a=${out ? '100*E(p)' : '100*(1-E(p))'};
${sc ? `a=(${out ? 'p>0' : 'p<1'})?(seedRandom(i+Math.floor(time*24),true),random(10,100)):0;` : ''}
${gl ? `a=(${out ? 'p>0&&p<1' : 'p>0&&p<1'})?(seedRandom(i*3+Math.floor(time*20),true),random(-100,100)):a;` : ''}
[a,a,a];`;
  };
  if (inP) animators.push({ name: 'KX Type In', basedOn: BASED[inP.unit], props: inP.motion.props(DIRV[inP.dir], inP.strength), amount: amountExpr(inP, false) });
  if (outP) animators.push({ name: 'KX Type Out', basedOn: BASED[outP.unit], props: outP.motion.props(DIRV[outP.dir], outP.strength), amount: amountExpr(outP, true) });
  if (loop) {
    const pr = { ...loop.motion.props };
    const k = loop.strength;
    if (pr.pos) pr.pos = pr.pos.map((v) => v * k) as any;
    if (pr.rot) pr.rot *= k;
    if (pr.tracking) pr.tracking *= k;
    animators.push({ name: 'KX Type Loop', basedOn: BASED[loop.unit], props: pr, amount: `// KX-TYPE loop\nvar i=textIndex-1,n=textTotal,S=effect("KX Type Loop Speed")("Slider")/100;var a=${loop.motion.amount};[a,a,a];` });
  }
  const unit = inP?.unit ?? outP?.unit ?? loop?.unit ?? 'char';
  return {
    animators,
    controls: [
      { name: 'KX Type In Duration', value: timing.inDur }, { name: 'KX Type Out Duration', value: timing.outDur },
      { name: 'KX Type Stagger', value: timing.stagger }, { name: 'KX Type Auto Fit', value: timing.autoFit ? 1.2 : 0 },
      { name: 'KX Type Seed', value: timing.seed }, { name: 'KX Type Loop Speed', value: timing.speed },
    ],
    threeD: !!(inP?.motion.threeD || outP?.motion.threeD),
    grouping: unit === 'char' ? 1 : unit === 'word' ? 2 : 3,
  };
}

// ───────── preview (same math in JS) ─────────
export function previewAmount(p: PhaseOpts, out: boolean, idx: number, n: number, time: number, inPoint: number, outPoint: number, dur: number, stagger: number, seed: number) {
  const O = (i: number) => {
    switch (p.order) {
      case 'end': return n - 1 - i;
      case 'center': return Math.abs(i - (n - 1) / 2);
      case 'edges': return (n - 1) / 2 - Math.abs(i - (n - 1) / 2);
      case 'random': { const x = Math.sin((i * 13 + seed) * 12.9898) * 43758.5453; return (x - Math.floor(x)) * (n - 1); }
      default: return i;
    }
  };
  let mx = 0;
  for (let q = 0; q < n; q++) mx = Math.max(mx, O(q));
  const o = O(idx);
  const t0 = out ? outPoint - dur - (mx - o) * stagger : inPoint + o * stagger;
  let pr = Math.min(1, Math.max(0, (time - t0) / dur));
  if (p.motion.stepped) pr = pr > 0 ? 1 : 0;
  const E = easeFn(p.ease);
  let a = out ? 100 * E(pr) : 100 * (1 - E(pr));
  if (p.motion.scramble) a = (out ? pr > 0 : pr < 1) ? 50 : 0;
  return a;
}
