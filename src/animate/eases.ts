// Ease library. Every ease has a JS source body `f(t)` (t in 0..1) used both for the
// preview and verbatim inside After Effects expressions. Eases that are plain
// cubic-beziers also carry `bezier`, so they can be written as native AE keyframe
// ease (influence + speed) — lightweight and editable.

export type Bez = [number, number, number, number];
export interface EaseDef { id: string; label: string; group: string; src: string; bezier?: Bez }

const B = (id: string, label: string, group: string, b: Bez): EaseDef => ({
  id, label, group, bezier: b,
  src: `var x1=${b[0]},y1=${b[1]},x2=${b[2]},y2=${b[3]};var cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx,cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by;var u=t;for(var i=0;i<8;i++){var xx=((ax*u+bx)*u+cx)*u-t;var d=(3*ax*u+2*bx)*u+cx;if(Math.abs(xx)<1e-6||Math.abs(d)<1e-6)break;u-=xx/d;}return ((ay*u+by)*u+cy)*u;`,
});
const F = (id: string, label: string, group: string, src: string): EaseDef => ({ id, label, group, src });

// Penner families — bezier approximations from easings.net
const PENNER: [string, Bez, Bez, Bez][] = [
  ['Sine', [0.12, 0, 0.39, 0], [0.61, 1, 0.88, 1], [0.37, 0, 0.63, 1]],
  ['Quad', [0.11, 0, 0.5, 0], [0.5, 1, 0.89, 1], [0.45, 0, 0.55, 1]],
  ['Cubic', [0.32, 0, 0.67, 0], [0.33, 1, 0.68, 1], [0.65, 0, 0.35, 1]],
  ['Quart', [0.5, 0, 0.75, 0], [0.25, 1, 0.5, 1], [0.76, 0, 0.24, 1]],
  ['Quint', [0.64, 0, 0.78, 0], [0.22, 1, 0.36, 1], [0.83, 0, 0.17, 1]],
  ['Expo', [0.7, 0, 0.84, 0], [0.16, 1, 0.3, 1], [0.87, 0, 0.13, 1]],
  ['Circ', [0.55, 0, 1, 0.45], [0, 0.55, 0.45, 1], [0.85, 0, 0.15, 1]],
  ['Back', [0.36, 0, 0.66, -0.56], [0.34, 1.56, 0.64, 1], [0.68, -0.6, 0.32, 1.6]],
];

const list: EaseDef[] = [B('linear', 'Linear', 'Basic', [0, 0, 1, 1])];
for (const [n, i, o, io] of PENNER) {
  list.push(B(`${n.toLowerCase()}In`, `${n} In`, n, i), B(`${n.toLowerCase()}Out`, `${n} Out`, n, o), B(`${n.toLowerCase()}InOut`, `${n} In-Out`, n, io));
}

// UI / design system curves
const DESIGN: [string, string, Bez][] = [
  ['easyEase', 'AE Easy Ease (33%)', [0.33, 0, 0.67, 1]], ['easyEase75', 'Easy Ease 75%', [0.75, 0, 0.25, 1]], ['easyEase90', 'Easy Ease 90%', [0.9, 0, 0.1, 1]],
  ['cssEase', 'CSS ease', [0.25, 0.1, 0.25, 1]], ['cssIn', 'CSS ease-in', [0.42, 0, 1, 1]], ['cssOut', 'CSS ease-out', [0, 0, 0.58, 1]], ['cssInOut', 'CSS ease-in-out', [0.42, 0, 0.58, 1]],
  ['mdStandard', 'Material Standard', [0.2, 0, 0, 1]], ['mdDecel', 'Material Decelerate', [0, 0, 0, 1]], ['mdAccel', 'Material Accelerate', [0.3, 0, 1, 1]], ['mdEmph', 'Material Emphasized', [0.05, 0.7, 0.1, 1]],
  ['apple', 'Apple Default', [0.25, 0.1, 0.25, 1]], ['appleSpring', 'Apple Snappy', [0.32, 0.72, 0, 1]], ['ios', 'iOS Sheet', [0.2, 0.9, 0.2, 1]],
  ['swift', 'Swift Out', [0.55, 0, 0.1, 1]], ['snap', 'Snap', [0.9, 0, 0.1, 1]], ['glide', 'Glide', [0.1, 0.5, 0.2, 1]], ['silk', 'Silk', [0.45, 0.05, 0.15, 1]],
  ['flow', 'Flow', [0.6, 0.05, 0.25, 1]], ['punch', 'Punch', [0.8, -0.2, 0.2, 1]], ['whip', 'Whip', [0.95, 0, 0.05, 1]], ['drift', 'Drift', [0.15, 0.35, 0.35, 1]],
  ['anticipate', 'Anticipate', [0.6, -0.35, 0.4, 1]], ['anticipateStrong', 'Anticipate Strong', [0.7, -0.6, 0.35, 1]],
  ['overshoot', 'Overshoot', [0.3, 0, 0.2, 1.4]], ['overshootSoft', 'Overshoot Soft', [0.25, 0, 0.25, 1.2]], ['overshootBig', 'Overshoot Big', [0.3, 0, 0.15, 1.7]],
  ['backInOutSoft', 'Back In-Out Soft', [0.6, -0.25, 0.4, 1.25]], ['cinematic', 'Cinematic', [0.77, 0, 0.18, 1]], ['camera', 'Camera Move', [0.65, 0, 0.25, 1]], ['dolly', 'Dolly', [0.45, 0, 0.2, 1]],
  ['lazy', 'Lazy', [0.7, 0, 0.6, 1]], ['rush', 'Rush', [0.2, 0.8, 0.4, 1]], ['brake', 'Brake', [0, 0.9, 0.3, 1]], ['launch', 'Launch', [0.8, 0, 1, 0.6]],
];
for (const [id, label, b] of DESIGN) list.push(B(id, label, 'Design', b));

// Physical / functional eases (expression-only)
const springSrc = (k: number, z: number) => `var w=${k},z=${z};if(t<=0)return 0;if(t>=1)return 1;var wd=w*Math.sqrt(1-z*z);var e=1-Math.exp(-z*w*t)*(Math.cos(wd*t)+(z*w/wd)*Math.sin(wd*t));var e1=1-Math.exp(-z*w)*(Math.cos(wd)+(z*w/wd)*Math.sin(wd));return e+(1-e1)*t;`;
list.push(
  F('elasticOut', 'Elastic Out', 'Elastic', 'if(t<=0)return 0;if(t>=1)return 1;return Math.pow(2,-10*t)*Math.sin((t*10-0.75)*(2*Math.PI)/3)+1;'),
  F('elasticIn', 'Elastic In', 'Elastic', 'if(t<=0)return 0;if(t>=1)return 1;return -Math.pow(2,10*t-10)*Math.sin((t*10-10.75)*(2*Math.PI)/3);'),
  F('elasticInOut', 'Elastic In-Out', 'Elastic', 'if(t<=0)return 0;if(t>=1)return 1;var c=(2*Math.PI)/4.5;return t<0.5?-(Math.pow(2,20*t-10)*Math.sin((20*t-11.125)*c))/2:(Math.pow(2,-20*t+10)*Math.sin((20*t-11.125)*c))/2+1;'),
  F('elasticSoft', 'Elastic Soft', 'Elastic', 'if(t<=0)return 0;if(t>=1)return 1;return Math.pow(2,-8*t)*Math.sin((t*6-0.75)*(2*Math.PI)/3)*0.6+1-0.6*Math.pow(2,-8);'),
  F('elasticWild', 'Elastic Wild', 'Elastic', 'if(t<=0)return 0;if(t>=1)return 1;return Math.pow(2,-7*t)*Math.sin((t*16-0.75)*(2*Math.PI)/3)*1.2+1;'),
  F('bounceOut', 'Bounce Out', 'Bounce', 'var n=7.5625,d=2.75;if(t<1/d)return n*t*t;if(t<2/d){t-=1.5/d;return n*t*t+0.75;}if(t<2.5/d){t-=2.25/d;return n*t*t+0.9375;}t-=2.625/d;return n*t*t+0.984375;'),
  F('bounceIn', 'Bounce In', 'Bounce', 'var s=1-t,n=7.5625,d=2.75,r;if(s<1/d)r=n*s*s;else if(s<2/d){s-=1.5/d;r=n*s*s+0.75;}else if(s<2.5/d){s-=2.25/d;r=n*s*s+0.9375;}else{s-=2.625/d;r=n*s*s+0.984375;}return 1-r;'),
  F('bounceInOut', 'Bounce In-Out', 'Bounce', 'function o(x){var n=7.5625,d=2.75;if(x<1/d)return n*x*x;if(x<2/d){x-=1.5/d;return n*x*x+0.75;}if(x<2.5/d){x-=2.25/d;return n*x*x+0.9375;}x-=2.625/d;return n*x*x+0.984375;}return t<0.5?(1-o(1-2*t))/2:(1+o(2*t-1))/2;'),
  F('bounceSoft', 'Bounce Soft (2 hops)', 'Bounce', 'if(t<0.6){var a=t/0.6;return a*a;}var b=(t-0.6)/0.4;return 1-Math.sin(b*Math.PI)*0.12*(1-b);'),
  F('smoothstep', 'Smooth Step', 'Smooth', 'return t*t*(3-2*t);'),
  F('smootherstep', 'Smoother Step', 'Smooth', 'return t*t*t*(t*(t*6-15)+10);'),
  F('steps4', 'Steps ×4', 'Steps', 'return Math.min(1,Math.floor(t*4+1e-6)/4+(t>=1?0:0));'),
  F('steps8', 'Steps ×8', 'Steps', 'return Math.min(1,Math.floor(t*8+1e-6)/8);'),
  F('steps12', 'Steps ×12 (stop motion)', 'Steps', 'return Math.min(1,Math.floor(t*12+1e-6)/12);'),
  F('wobble', 'Wobble Settle', 'Fun', 'return 1-Math.cos(t*Math.PI*4.5)*Math.pow(1-t,2.2);'),
  F('jitterIn', 'Jitter In', 'Fun', 'return t+Math.sin(t*90)*0.03*(1-t);'),
  F('rubber', 'Rubber Band', 'Fun', 'return 1-Math.pow(1-t,3)*Math.cos(t*Math.PI*3);'),
  F('slowMo', 'Slow-mo Middle', 'Fun', 'var a=0.7,p=0.7;var s=(1-a)/2;if(t<s){var u=t/s;return u*u*u*s;}if(t>1-s){var v=(t-1+s)/s;return 1-s+ (1-Math.pow(1-v,3))*s;}return s+(t-s)*(1-2*s)/(1-2*s);'),
  F('heartbeat', 'Heartbeat', 'Fun', 'var p=Math.sin(t*Math.PI*2*2)*Math.exp(-t*4)*0.15;return t+p;'),
  F('glitchSteps', 'Glitch', 'Fun', 'var s=Math.floor(t*10);var r=Math.sin(s*12.9898)*43758.5453;r=r-Math.floor(r);return t>=1?1:Math.min(1,Math.max(0,t+(r-0.5)*0.18*(1-t)));'),
);
const SPRINGS: [string, string, number, number][] = [
  ['springGentle', 'Spring Gentle', 9, 0.7], ['springDefault', 'Spring Default', 12, 0.45], ['springWobbly', 'Spring Wobbly', 14, 0.25],
  ['springStiff', 'Spring Stiff', 18, 0.6], ['springSlow', 'Spring Slow', 7, 0.5], ['springMolasses', 'Spring Molasses', 6, 0.9],
  ['springBouncy', 'Spring Bouncy', 16, 0.18], ['springSnappy', 'Spring Snappy', 22, 0.5], ['springJelly', 'Spring Jelly', 20, 0.12], ['springHeavy', 'Spring Heavy', 10, 0.35],
];
for (const [id, label, k, z] of SPRINGS) list.push(F(id, label, 'Spring', springSrc(k, z)));

// a few dozen more bezier variations so designers can pick exact feels
const VARIANTS: [string, Bez][] = [
  ['Ease 10/90', [0.1, 0, 0.9, 1]], ['Ease 20/80', [0.2, 0, 0.8, 1]], ['Ease 40/60', [0.4, 0, 0.6, 1]], ['Ease 60/40', [0.6, 0, 0.4, 1]], ['Ease 80/20', [0.8, 0, 0.2, 1]],
  ['Out 50', [0, 0, 0.5, 1]], ['Out 70', [0, 0, 0.3, 1]], ['Out 90', [0, 0, 0.1, 1]], ['In 50', [0.5, 0, 1, 1]], ['In 70', [0.7, 0, 1, 1]], ['In 90', [0.9, 0, 1, 1]],
  ['Late Start', [0.85, 0, 0.6, 1]], ['Early Stop', [0.4, 0, 0.15, 1]], ['Soft Land', [0.3, 0, 0, 1]], ['Hard Land', [0.6, 0, 0.9, 1]],
  ['Pull Back', [0.5, -0.2, 0.5, 1]], ['Push Past', [0.5, 0, 0.5, 1.2]], ['Tiny Overshoot', [0.3, 0, 0.3, 1.08]], ['Tiny Anticipate', [0.6, -0.08, 0.5, 1]],
  ['Lift', [0.3, 0.2, 0.2, 1]], ['Settle', [0.1, 0.9, 0.2, 1]], ['Spark', [0.9, 0.1, 0.1, 0.9]], ['Hesitate', [0.2, 0.7, 0.8, 0.3]], ['Stutter', [0.9, 0.3, 0.1, 0.7]],
];
VARIANTS.forEach(([label, b], i) => list.push(B('var' + i, label, 'Variations', b)));

export const EASE_LIBRARY = list;
export const EASE_GROUPS = [...new Set(list.map((e) => e.group))];

const fnCache = new Map<string, (t: number) => number>();
export function easeFn(e: EaseDef): (t: number) => number {
  let f = fnCache.get(e.id);
  if (!f) {
    // eslint-disable-next-line no-new-func
    f = new Function('t', e.src) as (t: number) => number;
    fnCache.set(e.id, f);
  }
  return f;
}
export const easeById = (id: string) => EASE_LIBRARY.find((e) => e.id === id) ?? EASE_LIBRARY[0];

/** Small curve thumbnail for preset tiles. */
export function easeThumb(e: EaseDef, w = 120, h = 56): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const f = easeFn(e);
  let lo = 0, hi = 1;
  for (let i = 0; i <= 60; i++) { const v = f(i / 60); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = 8, Y = (v: number) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2);
  g.strokeStyle = 'rgba(255,255,255,.08)';
  g.beginPath(); g.moveTo(pad, Y(0)); g.lineTo(w - pad, Y(0)); g.moveTo(pad, Y(1)); g.lineTo(w - pad, Y(1)); g.stroke();
  g.strokeStyle = '#d1fe17'; g.lineWidth = 2; g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i <= 80; i++) { const x = pad + (i / 80) * (w - pad * 2), y = Y(f(i / 80)); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  return c;
}

/** Expression snippet defining function E(t) for the given ease. */
export const easeExprFn = (e: EaseDef, name = 'E') => `function ${name}(t){${e.src}}`;
