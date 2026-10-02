// Procedural motion (wiggles, floats, orbits…) and loop helpers as AE expressions.
// Every expression reads KX sliders so it stays tweakable in AE.

export interface WiggleDef { id: string; label: string; sub: string; body: string; preview: (t: number, f: number, a: number, seed: number, loop: number) => [number, number] }

const head = `// KX-WIGGLE
var f=effect("KX Wiggle Speed")("Slider"),a=effect("KX Wiggle Amount")("Slider"),sd=effect("KX Wiggle Seed")("Slider"),L=effect("KX Loop Length")("Slider");
function N(t,s){seedRandom(sd*97+s,true);var p=random(0,1000);return noise([t*f+p,s*13.1,sd]);}
function LN(t,s){if(L<=0)return N(t,s);var u=((t%L)+L)%L,w=u/L;return N(u,s)*(1-w)+N(u-L,s)*w;}
`;

// JS twins of the expressions for the panel preview
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
const vnoise = (x: number, s: number) => { const i = Math.floor(x), fr = x - i, u = fr * fr * (3 - 2 * fr); return (hash(i + s * 57) * (1 - u) + hash(i + 1 + s * 57) * u) * 2 - 1; };

export const WIGGLES: WiggleDef[] = [
  { id: 'smooth', label: 'Smooth Wiggle', sub: 'organic random drift', body: 'var x=LN(time,1)*a,y=LN(time,2)*a;', preview: (t, f, a, s) => [vnoise(t * f, s) * a, vnoise(t * f, s + 3) * a] },
  { id: 'loopable', label: 'Loopable Wiggle', sub: 'repeats every loop length', body: 'if(L<=0)L=4;var x=LN(time,1)*a,y=LN(time,2)*a;', preview: (t, f, a, s, L) => { L = L || 4; const u = t % L, w = u / L; return [(vnoise(u * f, s) * (1 - w) + vnoise((u - L) * f, s) * w) * a, (vnoise(u * f, s + 3) * (1 - w) + vnoise((u - L) * f, s + 3) * w) * a]; } },
  { id: 'decay', label: 'Decaying Shake', sub: 'strong at the in-point, settles', body: 'var d=Math.exp(-(time-inPoint)*2);var x=N(time,1)*a*2*d,y=N(time,2)*a*2*d;', preview: (t, f, a, s) => { const d = Math.exp(-(t % 3) * 2); return [vnoise(t * f * 3, s) * a * 2 * d, vnoise(t * f * 3, s + 3) * a * 2 * d]; } },
  { id: 'jumps', label: 'Random Jumps', sub: 'stepped, stop-motion feel', body: 'var st=Math.floor(time*f);seedRandom(sd*31+st,true);var x=random(-a,a),y=random(-a,a);', preview: (t, f, a, s) => { const st = Math.floor(t * f); return [(hash(st + s) * 2 - 1) * a, (hash(st + s + 99) * 2 - 1) * a]; } },
  { id: 'float', label: 'Float', sub: 'gentle hover up & down', body: 'var x=Math.sin(time*f*0.7*Math.PI)*a*0.25,y=Math.sin(time*f*Math.PI)*a;', preview: (t, f, a) => [Math.sin(t * f * 0.7 * Math.PI) * a * 0.25, Math.sin(t * f * Math.PI) * a] },
  { id: 'orbit', label: 'Orbit', sub: 'circles around its position', body: 'var x=Math.cos(time*f*2*Math.PI)*a,y=Math.sin(time*f*2*Math.PI)*a;', preview: (t, f, a) => [Math.cos(t * f * 2 * Math.PI) * a, Math.sin(t * f * 2 * Math.PI) * a] },
  { id: 'figure8', label: 'Figure 8', sub: 'lissajous loop', body: 'var x=Math.sin(time*f*Math.PI)*a,y=Math.sin(time*f*2*Math.PI)*a*0.5;', preview: (t, f, a) => [Math.sin(t * f * Math.PI) * a, Math.sin(t * f * 2 * Math.PI) * a * 0.5] },
  { id: 'pendulum', label: 'Pendulum', sub: 'decaying swing', body: 'var x=Math.sin((time-inPoint)*f*2*Math.PI)*a*Math.exp(-(time-inPoint)*0.8),y=0;', preview: (t, f, a) => [Math.sin((t % 4) * f * 2 * Math.PI) * a * Math.exp(-(t % 4) * 0.8), 0] },
  { id: 'heartbeat', label: 'Heartbeat', sub: 'double pulse', body: 'var p=(time*f)%1;var b=Math.exp(-p*14)*Math.sin(p*40)+Math.exp(-(p-0.25)*14)*Math.max(0,Math.sin((p-0.25)*40))*0.6;var x=b*a,y=b*a;', preview: (t, f, a) => { const p = (t * f) % 1; const b = Math.exp(-p * 14) * Math.sin(p * 40); return [b * a, b * a]; } },
  { id: 'handheld', label: 'Handheld', sub: 'camera-operator sway', body: 'var x=(N(time*0.6,1)+N(time*3,4)*0.15)*a,y=(N(time*0.5,2)+N(time*3,5)*0.15)*a;', preview: (t, f, a, s) => [(vnoise(t * f * 0.6, s) + vnoise(t * f * 3, s + 4) * 0.15) * a, (vnoise(t * f * 0.5, s + 2) + vnoise(t * f * 3, s + 5) * 0.15) * a] },
];

export function buildWiggle(id: string, prop: string) {
  const w = WIGGLES.find((x) => x.id === id) ?? WIGGLES[0];
  let tail: string;
  switch (prop) {
    case 'scale': tail = 'var s=1+(x/100);value instanceof Array?[value[0]*s,value[1]*s].concat(value.length>2?[value[2]*s]:[]):value*s;'; break;
    case 'rotation': tail = 'value+x*0.3;'; break;
    case 'opacity': tail = 'clamp(value+x*0.5,0,100);'; break;
    default: tail = 'value instanceof Array?(value.length>2?[value[0]+x,value[1]+y,value[2]]:[value[0]+x,value[1]+y]):value+x;';
  }
  return { label: w.label, expr: head + w.body + '\n' + tail, preview: w.preview };
}

export const LOOPS = [
  { id: 'cycle', label: 'Loop Cycle', sub: 'repeat keyframes', expr: '// KX-LOOP\nloopOut("cycle");' },
  { id: 'pingpong', label: 'Ping-Pong', sub: 'back and forth', expr: '// KX-LOOP\nloopOut("pingpong");' },
  { id: 'offset', label: 'Loop Offset', sub: 'keeps adding (stairs)', expr: '// KX-LOOP\nloopOut("offset");' },
  { id: 'continue', label: 'Continue', sub: 'keeps the last velocity', expr: '// KX-LOOP\nloopOut("continue");' },
  { id: 'inout', label: 'Loop In + Out', sub: 'cycles before and after', expr: '// KX-LOOP\nloopIn("cycle")+loopOut("cycle")-value;' },
  { id: 'seamless', label: 'Seamless Crossfade', sub: 'blends the end into the start', expr: '// KX-LOOP\nvar d=key(numKeys).time-key(1).time,b=Math.min(0.5,d*0.25);var t=key(1).time+((time-key(1).time)%d);if(t>key(numKeys).time-b){var w=(t-(key(numKeys).time-b))/b;var A=valueAtTime(t),B=valueAtTime(key(1).time+(t-(key(numKeys).time-b)));A instanceof Array?A.map(function(q,i){return q*(1-w)+B[i]*w;}):A*(1-w)+B*w;}else valueAtTime(t);' },
];
