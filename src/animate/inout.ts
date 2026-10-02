// In / Out animation library for any layer. Each style is a set of small
// expression snippets per property: `v` is the current value, `e` the eased
// visibility (0 = gone, 1 = at rest), `r` the raw progress, `k` the strength
// (1 = 100%), `W`/`H` the layer's visible size and `CW`/`CH` the comp size.
// Snippets use add()/mul() so the very same code runs in AE and in the preview.

import { easeExprFn, type EaseDef } from './eases';

export type PropKey = 'position' | 'scale' | 'rotation' | 'opacity' | 'rotationX' | 'rotationY';
export interface FxDef { match: string; name: string; set?: Record<string, number | number[] | boolean>; expr: Record<string, string> }
export interface AnimDef { id: string; label: string; group: string; needs3D?: boolean; props: Partial<Record<PropKey, string>>; fx?: FxDef[] }

const D: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const DIRS = ['left', 'right', 'up', 'down'] as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const lib: AnimDef[] = [];
const add = (a: AnimDef) => lib.push(a);

// ── Basic
add({ id: 'fade', label: 'Fade', group: 'Basic', props: { opacity: 'return v*e;' } });
for (const d of DIRS) {
  const [x, y] = D[d];
  add({ id: 'fade-' + d, label: 'Fade ' + cap(d), group: 'Basic', props: { opacity: 'return v*e;', position: `return add(v,[${-x}*(1-e)*80*k, ${-y}*(1-e)*80*k]);` } });
  add({ id: 'slide-' + d, label: 'Slide ' + cap(d), group: 'Slide', props: { position: `return add(v,[${-x}*(1-e)*(CW*0.5+W)*k, ${-y}*(1-e)*(CH*0.5+H)*k]);` } });
  add({ id: 'push-' + d, label: 'Push ' + cap(d), group: 'Slide', props: { position: `return add(v,[${-x}*(1-e)*(W*0.6)*k, ${-y}*(1-e)*(H*0.6)*k]);`, opacity: 'return v*Math.min(1,e*1.8);' } });
  add({ id: 'blur-slide-' + d, label: 'Speed ' + cap(d), group: 'Blur', props: { position: `return add(v,[${-x}*(1-e)*(W*0.9)*k, ${-y}*(1-e)*(H*0.9)*k]);`, opacity: 'return v*Math.min(1,e*2);' },
    fx: [{ match: 'ADBE Motion Blur', name: 'KX Speed Blur', set: { 'Direction': x !== 0 ? 90 : 0 }, expr: { 'Blur Length': 'return Math.max(v,(1-e)*(1-e)*220*k);' } }] });
}
add({ id: 'zoom-in', label: 'Zoom In', group: 'Scale', props: { scale: 'return mul(v,0.2+0.8*e);', opacity: 'return v*Math.min(1,e*2);' } });
add({ id: 'zoom-out', label: 'Zoom Out', group: 'Scale', props: { scale: 'return mul(v,1+(1-e)*1.6*k);', opacity: 'return v*e;' } });
add({ id: 'pop', label: 'Pop', group: 'Scale', props: { scale: 'return mul(v,e);' } });
add({ id: 'squash-pop', label: 'Squash Pop', group: 'Scale', props: { scale: 'var s=e;var q=Math.sin(r*Math.PI)*0.25*k*(1-r);return [v[0]*s*(1+q),v[1]*s*(1-q)];' } });
add({ id: 'grow-x', label: 'Grow Horizontal', group: 'Scale', props: { scale: 'return [v[0]*e,v[1]];' } });
add({ id: 'grow-y', label: 'Grow Vertical', group: 'Scale', props: { scale: 'return [v[0],v[1]*e];' } });
add({ id: 'rotate-in', label: 'Rotate In', group: 'Rotate', props: { rotation: 'return v-(1-e)*90*k;', opacity: 'return v*e;', scale: 'return mul(v,0.6+0.4*e);' } });
add({ id: 'spin-in', label: 'Spin', group: 'Rotate', props: { rotation: 'return v-(1-e)*360*k;', scale: 'return mul(v,e);' } });
add({ id: 'swing', label: 'Swing', group: 'Rotate', props: { rotation: 'return v+Math.sin(r*Math.PI*3)*(1-r)*25*k;', opacity: 'return v*Math.min(1,r*4);' } });
add({ id: 'wobble', label: 'Wobble', group: 'Rotate', props: { rotation: 'return v+Math.sin(r*Math.PI*6)*(1-r)*12*k;', scale: 'return mul(v,1+Math.sin(r*Math.PI*5)*(1-r)*0.15*k);', opacity: 'return v*Math.min(1,r*5);' } });
add({ id: 'drop', label: 'Drop', group: 'Physics', props: { position: 'return add(v,[0,-(1-e)*(CH*0.6)*k]);', scale: 'var q=Math.max(0,1-Math.abs(r-0.72)*8)*0.25*k;return [v[0]*(1+q),v[1]*(1-q)];' } });
add({ id: 'rise', label: 'Rise', group: 'Physics', props: { position: 'return add(v,[0,(1-e)*(CH*0.6)*k]);', opacity: 'return v*Math.min(1,e*1.5);' } });
add({ id: 'shake-in', label: 'Shake', group: 'Physics', props: { position: 'return add(v,[Math.sin(r*80)*(1-r)*30*k,0]);', opacity: 'return v*Math.min(1,r*6);' } });
add({ id: 'jelly', label: 'Jelly', group: 'Physics', props: { scale: 'var a=Math.sin(r*Math.PI*4)*(1-r)*0.35*k;return [v[0]*e*(1+a),v[1]*e*(1-a)];' } });

// ── Blur & light
add({ id: 'blur-in', label: 'Blur In', group: 'Blur', props: { opacity: 'return v*Math.min(1,e*1.4);' }, fx: [{ match: 'ADBE Box Blur2', name: 'KX Blur', set: { 'Iterations': 3 }, expr: { 'Blur Radius': 'return Math.max(v,(1-e)*60*k);' } }] });
add({ id: 'blur-zoom', label: 'Blur Zoom', group: 'Blur', props: { scale: 'return mul(v,1+(1-e)*0.5*k);', opacity: 'return v*e;' }, fx: [{ match: 'ADBE Box Blur2', name: 'KX Blur', set: { 'Iterations': 3 }, expr: { 'Blur Radius': 'return Math.max(v,(1-e)*40*k);' } }] });
add({ id: 'focus-pull', label: 'Focus Pull', group: 'Blur', props: { scale: 'return mul(v,0.92+0.08*e);' }, fx: [{ match: 'ADBE Box Blur2', name: 'KX Blur', set: { 'Iterations': 3 }, expr: { 'Blur Radius': 'return Math.max(v,(1-e)*(1-e)*30*k);' } }] });
add({ id: 'flash', label: 'Flash', group: 'Light', props: { opacity: 'return v*Math.min(1,r*5);' }, fx: [{ match: 'ADBE Exposure2', name: 'KX Flash', expr: { 'Exposure': 'return v+(1-e)*4*k;' } }] });
add({ id: 'light-sweep', label: 'Light Sweep', group: 'Light', props: { opacity: 'return v*Math.min(1,r*3);' }, fx: [{ match: 'CC Light Sweep', name: 'KX Sweep', set: { 'Width': 80, 'Sweep Intensity': 60 }, expr: { 'Center': 'var R=sourceRectAtTime(time,false);return [R.left-R.width*0.3+(R.width*1.6)*r,R.top+R.height/2];' } }] });
add({ id: 'glow-in', label: 'Glow Burst', group: 'Light', props: { opacity: 'return v*e;' }, fx: [{ match: 'ADBE Glo2', name: 'KX Glow', set: { 'Glow Radius': 60 }, expr: { 'Glow Intensity': 'return (1-e)*4*k;' } }] });

// ── 3D
add({ id: 'flip-x', label: 'Flip X', group: '3D', needs3D: true, props: { rotationX: 'return v+(1-e)*90*k;', opacity: 'return v*Math.min(1,e*2);' } });
add({ id: 'flip-y', label: 'Flip Y', group: '3D', needs3D: true, props: { rotationY: 'return v+(1-e)*90*k;', opacity: 'return v*Math.min(1,e*2);' } });
add({ id: 'tumble', label: 'Tumble', group: '3D', needs3D: true, props: { rotationX: 'return v+(1-e)*120*k;', rotationY: 'return v-(1-e)*60*k;', scale: 'return mul(v,0.5+0.5*e);', opacity: 'return v*e;' } });
add({ id: 'card-swing', label: 'Card Swing', group: '3D', needs3D: true, props: { rotationY: 'return v+Math.cos(r*Math.PI*2.5)*(1-r)*80*k;', opacity: 'return v*Math.min(1,r*3);' } });
add({ id: 'fly-depth', label: 'Fly From Depth', group: '3D', needs3D: true, props: { position: 'return add(v,[0,0,(1-e)*2500*k]);', opacity: 'return v*Math.min(1,e*2);' } });

// ── Wipes & reveals (native transition effects)
for (const [d, ang] of [['left', 270], ['right', 90], ['up', 0], ['down', 180]] as const) {
  add({ id: 'wipe-' + d, label: 'Wipe ' + cap(d), group: 'Wipe', props: {}, fx: [{ match: 'ADBE Linear Wipe', name: 'KX Wipe', set: { 'Wipe Angle': ang, 'Feather': 40 }, expr: { 'Transition Completion': 'return Math.max(v,(1-e)*100);' } }] });
}
add({ id: 'radial-wipe', label: 'Clock Wipe', group: 'Wipe', props: {}, fx: [{ match: 'ADBE Radial Wipe', name: 'KX Radial', set: { 'Feather': 20 }, expr: { 'Transition Completion': 'return Math.max(v,(1-e)*100);' } }] });
add({ id: 'blinds', label: 'Blinds', group: 'Wipe', props: {}, fx: [{ match: 'ADBE Venetian Blinds', name: 'KX Blinds', set: { 'Width': 40 }, expr: { 'Transition Completion': 'return Math.max(v,(1-e)*100);' } }] });
add({ id: 'dissolve', label: 'Block Dissolve', group: 'Wipe', props: {}, fx: [{ match: 'ADBE Block Dissolve', name: 'KX Dissolve', set: { 'Block Width': 12, 'Block Height': 12, 'Feather': 6 }, expr: { 'Transition Completion': 'return Math.max(v,(1-e)*100);' } }] });
add({ id: 'pixelate', label: 'Pixelate', group: 'Wipe', props: { opacity: 'return v*Math.min(1,e*3);' }, fx: [{ match: 'ADBE Mosaic', name: 'KX Pixels', expr: { 'Horizontal Blocks': 'return Math.max(2,Math.round(4+e*e*400));', 'Vertical Blocks': 'return Math.max(2,Math.round(4+e*e*400));' } }] });

// ── Glitch & digital
add({ id: 'glitch', label: 'Glitch', group: 'Glitch', props: { position: 'var s=Math.floor(time*24);var n=Math.sin(s*91.7)*43758.5;n=n-Math.floor(n);return add(v,[(n-0.5)*80*k*(1-e),0]);', opacity: 'var s=Math.floor(time*30);var n=Math.sin(s*12.9)*4375.5;n=n-Math.floor(n);return v*(e>0.98?1:(n>0.35?e:0));' } });
add({ id: 'rgb-split', label: 'RGB Split', group: 'Glitch', props: { opacity: 'return v*Math.min(1,e*2);' }, fx: [{ match: 'ADBE Motion Blur', name: 'KX Smear', set: { 'Direction': 90 }, expr: { 'Blur Length': 'return (1-e)*120*k;' } }, { match: 'ADBE Exposure2', name: 'KX Hot', expr: { 'Exposure': 'return v+(1-e)*1.5*k;' } }] });
add({ id: 'flicker', label: 'Flicker', group: 'Glitch', props: { opacity: 'var s=Math.floor(time*20);var n=Math.sin(s*78.2)*4375.8;n=n-Math.floor(n);return v*(e>=1?1:(n<e?1:0.1));' } });

// ── Liquid
add({ id: 'melt', label: 'Melt', group: 'Liquid', props: { position: 'return add(v,[0,(1-e)*(1-e)*H*0.35*k]);', opacity: 'return v*Math.min(1,e*1.6);' },
  fx: [{ match: 'ADBE Wave Warp', name: 'KX Melt', set: { 'Wave Type': 9, 'Wave Width': 70, 'Direction': 180, 'Wave Speed': 0.6, 'Pinning': 7 }, expr: { 'Wave Height': 'return (1-e)*90*k;' } },
    { match: 'ADBE Motion Blur', name: 'KX Drip', set: { 'Direction': 0 }, expr: { 'Blur Length': 'return (1-e)*(1-e)*60*k;' } }] });
add({ id: 'ripple', label: 'Ripple', group: 'Liquid', props: { opacity: 'return v*Math.min(1,e*2);' }, fx: [{ match: 'ADBE Wave Warp', name: 'KX Ripple', set: { 'Wave Type': 1, 'Wave Width': 60, 'Direction': 90, 'Wave Speed': 1.5 }, expr: { 'Wave Height': 'return (1-e)*40*k;' } }] });
add({ id: 'liquify', label: 'Liquid Turbulence', group: 'Liquid', props: { opacity: 'return v*Math.min(1,e*1.5);' }, fx: [{ match: 'ADBE Turbulent Displace', name: 'KX Liquid', set: { 'Size': 80, 'Complexity': 2 }, expr: { 'Amount': 'return (1-e)*180*k;' } }] });
add({ id: 'twist', label: 'Twirl', group: 'Liquid', props: { opacity: 'return v*Math.min(1,e*2);' }, fx: [{ match: 'ADBE Twirl', name: 'KX Twirl', expr: { 'Angle': 'return (1-e)*360*k;', 'Twirl Radius': 'return 70;' } }] });

export const ANIM_LIBRARY = lib;
export const ANIM_GROUPS = [...new Set(lib.map((a) => a.group))];
export const animById = (id: string | null) => lib.find((a) => a.id === id) ?? null;

// ───────── recipe → AE ─────────
export interface AnimRecipe {
  needs3D: boolean;
  controls: { name: string; value: number }[];
  props: { key: PropKey; expr: string }[];
  fx: { match: string; name: string; set: Record<string, number | number[] | boolean>; expr: Record<string, string> }[];
}

const HEAD = (ein: EaseDef, eout: EaseDef) => `// KX-ANIM
${easeExprFn(ein, 'EI')}
${easeExprFn(eout, 'EO')}
var inD=effect("KX In Duration")("Slider"),outD=effect("KX Out Duration")("Slider"),k=effect("KX Strength")("Slider")/100;
var ri=inD>0?clamp((time-inPoint)/inD,0,1):1,ro=outD>0?clamp((outPoint-time)/outD,0,1):1;
var ei=EI(ri),eo=EO(ro);
var R=sourceRectAtTime(time,false),W=R.width*Math.abs(transform.scale[0])/100,H=R.height*Math.abs(transform.scale[1])/100,CW=thisComp.width,CH=thisComp.height;
`;

const wrap = (snip: string | undefined) => (snip ? `(function(v,e,r){${snip}})` : '(function(v,e,r){return v;})');

export function buildRecipe(inA: AnimDef | null, outA: AnimDef | null, ein: EaseDef, eout: EaseDef, inDur: number, outDur: number, strength: number): AnimRecipe {
  const keys = new Set<PropKey>();
  for (const a of [inA, outA]) if (a) (Object.keys(a.props) as PropKey[]).forEach((p) => keys.add(p));
  const head = HEAD(ein, eout);
  const props = [...keys].map((key) => ({
    key,
    expr: `${head}var v=value;\nv=${wrap(inA?.props[key])}(v,ei,ri);\nv=${wrap(outA?.props[key])}(v,eo,ro);\nv;`,
  }));
  // effects: merge by matchName, combining in/out snippets per parameter
  const fxMap = new Map<string, AnimRecipe['fx'][number]>();
  for (const [a, which] of [[inA, 'in'], [outA, 'out']] as const) {
    for (const f of a?.fx ?? []) {
      let m = fxMap.get(f.match);
      if (!m) { m = { match: f.match, name: f.name, set: { ...(f.set ?? {}) }, expr: {} }; fxMap.set(f.match, m); }
      for (const [p, snip] of Object.entries(f.expr)) {
        const prev = (m.expr as any)['__' + p] ?? { in: undefined, out: undefined };
        prev[which] = snip;
        (m.expr as any)['__' + p] = prev;
      }
    }
  }
  const fx = [...fxMap.values()].map((m) => {
    const expr: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.expr as any)) {
      if (!k.startsWith('__')) continue;
      const p = k.slice(2), pair = v as { in?: string; out?: string };
      expr[p] = `${head}var v=value;\nv=${wrap(pair.in)}(v,ei,ri);\nv=${wrap(pair.out)}(v,eo,ro);\nv;`;
    }
    return { match: m.match, name: m.name, set: m.set, expr };
  });
  return {
    needs3D: !!(inA?.needs3D || outA?.needs3D),
    controls: [{ name: 'KX In Duration', value: inA ? inDur : 0 }, { name: 'KX Out Duration', value: outA ? outDur : 0 }, { name: 'KX Strength', value: strength * 100 }],
    props,
    fx,
  };
}

// ───────── preview evaluation (same snippets, JS side) ─────────
const vadd = (a: any, b: any) => (Array.isArray(a) ? a.map((x: number, i: number) => x + (b[i] ?? 0)) : a + b);
const vmul = (a: any, s: number) => (Array.isArray(a) ? a.map((x: number) => x * s) : a * s);
const fnCache = new Map<string, Function>();
export function evalSnippet(snip: string | undefined, v: any, e: number, r: number, env: { k: number; W: number; H: number; CW: number; CH: number; time: number }) {
  if (!snip) return v;
  let f = fnCache.get(snip);
  if (!f) {
    // eslint-disable-next-line no-new-func
    f = new Function('v', 'e', 'r', 'k', 'W', 'H', 'CW', 'CH', 'time', 'add', 'mul', 'clamp', 'sourceRectAtTime', snip);
    fnCache.set(snip, f);
  }
  try {
    return f(v, e, r, env.k, env.W, env.H, env.CW, env.CH, env.time, vadd, vmul, (x: number, a: number, b: number) => Math.min(b, Math.max(a, x)), () => ({ left: -env.W / 2, top: -env.H / 2, width: env.W, height: env.H }));
  } catch { return v; }
}
