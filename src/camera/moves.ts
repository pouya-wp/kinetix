// Camera moves expressed as operations on the Kinetix camera rig controls.
// Targets map to sliders on "KX Camera Rig" (or the rig's position).

export type CamTarget = 'distance' | 'orbit' | 'tilt' | 'roll' | 'focal' | 'pan' | 'look' | 'rigX' | 'rigY' | 'rigZ';
export interface CamOp { target: CamTarget; op: 'add' | 'mul' | 'set'; value: number; from?: number }
export interface MoveDef { id: string; label: string; group: string; sub: string; ops: CamOp[]; ease?: string; dur?: number }

const M = (id: string, label: string, group: string, sub: string, ops: CamOp[], extra: Partial<MoveDef> = {}): MoveDef => ({ id, label, group, sub, ops, ...extra });
const op = (target: CamTarget, o: CamOp['op'], value: number, from?: number): CamOp => ({ target, op: o, value, from });

export const MOVES: MoveDef[] = [
  // Dolly
  M('push-in', 'Push In', 'Dolly', 'move closer to the subject', [op('distance', 'mul', 0.6)]),
  M('push-in-slow', 'Slow Push', 'Dolly', 'subtle cinematic creep', [op('distance', 'mul', 0.85)], { dur: 4 }),
  M('pull-out', 'Pull Out', 'Dolly', 'reveal the scene', [op('distance', 'mul', 1.7)]),
  M('crash-in', 'Crash Zoom', 'Dolly', 'fast aggressive push', [op('distance', 'mul', 0.35)], { ease: 'expoInOut', dur: 0.6 }),
  M('fly-through', 'Fly Through', 'Dolly', 'travel through the layers', [op('distance', 'add', -4000)], { dur: 3 }),
  M('vertigo-in', 'Dolly Zoom In', 'Dolly', 'Vertigo: background stretches', [op('distance', 'mul', 2.2), op('focal', 'mul', 2.2)], { dur: 3 }),
  M('vertigo-out', 'Dolly Zoom Out', 'Dolly', 'Vertigo: background squeezes', [op('distance', 'mul', 0.45), op('focal', 'mul', 0.45)], { dur: 3 }),
  // Orbit
  M('orbit-l', 'Orbit Left', 'Orbit', '45° around the target', [op('orbit', 'add', -45)]),
  M('orbit-r', 'Orbit Right', 'Orbit', '45° around the target', [op('orbit', 'add', 45)]),
  M('orbit-90', 'Orbit 90°', 'Orbit', 'quarter turn', [op('orbit', 'add', 90)], { dur: 3 }),
  M('orbit-180', 'Orbit 180°', 'Orbit', 'swing to the back', [op('orbit', 'add', 180)], { dur: 4 }),
  M('orbit-360', 'Orbit 360°', 'Orbit', 'full turntable', [op('orbit', 'add', 360)], { dur: 6, ease: 'linear' }),
  M('arc-up', 'Arc Up', 'Orbit', 'orbit while rising', [op('orbit', 'add', 35), op('tilt', 'add', 20)]),
  M('arc-down', 'Arc Down', 'Orbit', 'orbit while lowering', [op('orbit', 'add', -35), op('tilt', 'add', -15)]),
  M('spiral-in', 'Spiral In', 'Orbit', 'orbit + push in', [op('orbit', 'add', 120), op('distance', 'mul', 0.55)], { dur: 3 }),
  M('spiral-out', 'Spiral Out', 'Orbit', 'orbit + pull out', [op('orbit', 'add', -120), op('distance', 'mul', 1.8)], { dur: 3 }),
  // Crane / pedestal
  M('crane-up', 'Crane Up', 'Crane', 'rise and look down', [op('tilt', 'add', 35), op('rigY', 'add', -150)]),
  M('crane-down', 'Crane Down', 'Crane', 'descend to eye level', [op('tilt', 'add', -35), op('rigY', 'add', 150)]),
  M('pedestal-up', 'Pedestal Up', 'Crane', 'straight up', [op('rigY', 'add', -400)]),
  M('pedestal-down', 'Pedestal Down', 'Crane', 'straight down', [op('rigY', 'add', 400)]),
  M('rise-reveal', 'Rise Reveal', 'Crane', 'from below, tilt up to the subject', [op('tilt', 'set', 0, -40), op('rigY', 'add', -250)], { dur: 3 }),
  M('top-down', 'Top Down', 'Crane', 'swing to a bird’s-eye view', [op('tilt', 'set', 85)], { dur: 3 }),
  // Truck
  M('truck-l', 'Truck Left', 'Truck', 'slide sideways', [op('rigX', 'add', -600)]),
  M('truck-r', 'Truck Right', 'Truck', 'slide sideways', [op('rigX', 'add', 600)]),
  M('parallax-l', 'Parallax Left', 'Truck', 'slide + slight orbit', [op('rigX', 'add', -400), op('orbit', 'add', -8)], { dur: 4 }),
  M('parallax-r', 'Parallax Right', 'Truck', 'slide + slight orbit', [op('rigX', 'add', 400), op('orbit', 'add', 8)], { dur: 4 }),
  M('track-forward', 'Track Forward', 'Truck', 'move the whole rig forward', [op('rigZ', 'add', 1200)], { dur: 3 }),
  // Pan / tilt / roll (camera head)
  M('pan-l', 'Pan Left', 'Pan & Tilt', 'turn the camera head', [op('pan', 'add', -25)]),
  M('pan-r', 'Pan Right', 'Pan & Tilt', 'turn the camera head', [op('pan', 'add', 25)]),
  M('tilt-up', 'Tilt Up', 'Pan & Tilt', 'look up', [op('look', 'add', -18)]),
  M('tilt-down', 'Tilt Down', 'Pan & Tilt', 'look down', [op('look', 'add', 18)]),
  M('whip-l', 'Whip Pan Left', 'Pan & Tilt', 'super fast pan (use motion blur)', [op('pan', 'add', -80)], { ease: 'expoInOut', dur: 0.4 }),
  M('whip-r', 'Whip Pan Right', 'Pan & Tilt', 'super fast pan (use motion blur)', [op('pan', 'add', 80)], { ease: 'expoInOut', dur: 0.4 }),
  M('dutch-l', 'Dutch Left', 'Pan & Tilt', 'roll for tension', [op('roll', 'add', -14)]),
  M('dutch-r', 'Dutch Right', 'Pan & Tilt', 'roll for tension', [op('roll', 'add', 14)]),
  M('barrel-roll', 'Barrel Roll', 'Pan & Tilt', 'full 360° roll', [op('roll', 'add', 360)], { dur: 2 }),
  // Lens
  M('snap-zoom', 'Snap Zoom', 'Lens', 'quick lens zoom in', [op('focal', 'mul', 1.8)], { ease: 'expoOut', dur: 0.35 }),
  M('zoom-out-lens', 'Lens Zoom Out', 'Lens', 'widen the lens', [op('focal', 'mul', 0.6)]),
  M('lens-35-85', '35 → 85mm', 'Lens', 'portrait compression', [op('focal', 'set', 85, 35)], { dur: 3 }),
  M('lens-85-24', '85 → 24mm', 'Lens', 'open up wide', [op('focal', 'set', 24, 85)], { dur: 3 }),
  // Cinematic combos
  M('hero-reveal', 'Hero Reveal', 'Cinematic', 'orbit in, push and rise', [op('orbit', 'set', 0, -35), op('distance', 'mul', 0.7), op('tilt', 'add', 10)], { dur: 3.5 }),
  M('drone', 'Drone Flyover', 'Cinematic', 'high angle sweeping over', [op('tilt', 'set', 15, 55), op('rigZ', 'add', 1500), op('orbit', 'add', 20)], { dur: 5 }),
  M('dive', 'Tunnel Dive', 'Cinematic', 'dive deep into the scene', [op('rigZ', 'add', 3000), op('roll', 'add', 25)], { dur: 2.5, ease: 'expoIn' }),
  M('spin-in', 'Spin In', 'Cinematic', 'roll + push in', [op('roll', 'set', 0, 120), op('distance', 'mul', 0.6)], { dur: 2 }),
  M('float-around', 'Float Around', 'Cinematic', 'slow dreamy drift', [op('orbit', 'add', 12), op('tilt', 'add', 6), op('rigX', 'add', 120)], { dur: 6, ease: 'sineInOut' }),
  M('reveal-pull', 'Reveal Pull-Back', 'Cinematic', 'start tight, end wide & high', [op('distance', 'mul', 2.4), op('tilt', 'add', 18)], { dur: 4 }),
  M('product-turn', 'Product Turn', 'Cinematic', 'half orbit + push', [op('orbit', 'add', 160), op('distance', 'mul', 0.85)], { dur: 5 }),
  M('handoff', 'Look Away', 'Cinematic', 'pan off while trucking', [op('pan', 'add', 30), op('rigX', 'add', 300)], { dur: 2.5 }),
  M('establish', 'Establishing', 'Cinematic', 'high wide → eye level', [op('tilt', 'set', 0, 40), op('distance', 'mul', 0.6)], { dur: 4 }),
  M('reset', 'Reset Rig', 'Utility', 'back to straight-on', [op('orbit', 'set', 0), op('tilt', 'set', 0), op('roll', 'set', 0), op('pan', 'set', 0), op('look', 'set', 0)], { dur: 1.5 }),
];

export const MOVE_GROUPS = [...new Set(MOVES.map((m) => m.group))];

// ───────── shakes (expressions on the KX Camera Shake null) ─────────
export interface ShakeDef { id: string; label: string; sub: string; pos: [number, number, number]; rot: [number, number, number]; freq: number; oct: number; bob?: number; decay?: number; step?: number }

export const SHAKES: ShakeDef[] = [
  { id: 'handheld', label: 'Handheld', sub: 'natural operator sway', pos: [6, 5, 3], rot: [0.5, 0.6, 0.35], freq: 0.9, oct: 2 },
  { id: 'handheld-tense', label: 'Handheld Tense', sub: 'nervous documentary', pos: [10, 9, 5], rot: [0.9, 1, 0.6], freq: 1.6, oct: 3 },
  { id: 'breathing', label: 'Breathing', sub: 'very slow float', pos: [3, 6, 2], rot: [0.25, 0.2, 0.15], freq: 0.25, oct: 1 },
  { id: 'walk', label: 'Walk', sub: 'step bob + sway', pos: [5, 4, 2], rot: [0.4, 0.5, 0.6], freq: 0.8, oct: 2, bob: 9 },
  { id: 'run', label: 'Run', sub: 'heavy fast steps', pos: [10, 8, 4], rot: [1.2, 1, 1.4], freq: 1.6, oct: 2, bob: 22 },
  { id: 'steadicam', label: 'Steadicam', sub: 'smooth glide drift', pos: [8, 4, 6], rot: [0.2, 0.3, 0.2], freq: 0.35, oct: 1 },
  { id: 'drone', label: 'Drone Hover', sub: 'wind buffeting', pos: [12, 10, 8], rot: [0.3, 0.4, 0.8], freq: 0.5, oct: 3 },
  { id: 'vehicle', label: 'Vehicle', sub: 'engine vibration + bumps', pos: [3, 6, 2], rot: [0.3, 0.2, 0.25], freq: 7, oct: 2 },
  { id: 'helicopter', label: 'Helicopter', sub: 'rotor buzz', pos: [4, 7, 3], rot: [0.25, 0.2, 0.4], freq: 11, oct: 1 },
  { id: 'earthquake', label: 'Earthquake', sub: 'violent rumble', pos: [35, 40, 10], rot: [2.5, 2, 3], freq: 6, oct: 3 },
  { id: 'impact', label: 'Impact Hit', sub: 'one hit that settles', pos: [40, 45, 15], rot: [3, 2, 4], freq: 9, oct: 2, decay: 5 },
  { id: 'explosion', label: 'Explosion', sub: 'huge hit + long rumble', pos: [70, 80, 30], rot: [5, 4, 6], freq: 8, oct: 3, decay: 2.2 },
  { id: 'heartbeat', label: 'Heartbeat', sub: 'thump pulse', pos: [0, 6, 14], rot: [0.4, 0, 0], freq: 1.2, oct: 1, step: 1 },
  { id: 'glitch', label: 'Digital Glitch', sub: 'stepped jumps', pos: [18, 12, 0], rot: [0, 0, 1.5], freq: 6, oct: 1, step: 1 },
  { id: 'underwater', label: 'Underwater', sub: 'slow heavy sway', pos: [10, 14, 6], rot: [0.8, 0.6, 1.4], freq: 0.18, oct: 2 },
  { id: 'boat', label: 'Boat', sub: 'rolling waves', pos: [4, 18, 4], rot: [1.5, 0.4, 4], freq: 0.22, oct: 1 },
  { id: 'drunk', label: 'Dizzy', sub: 'woozy rotation', pos: [15, 10, 10], rot: [2, 3, 5], freq: 0.3, oct: 2 },
  { id: 'subtle', label: 'Subtle Life', sub: 'barely there', pos: [2, 2, 1], rot: [0.15, 0.15, 0.1], freq: 0.6, oct: 1 },
];

/** Expression for position (kind = 'pos') or rotation axis (kind='rx'|'ry'|'rz') on the shake null. */
export function shakeExpr(s: ShakeDef, kind: 'pos' | 'rx' | 'ry' | 'rz') {
  const axis = kind === 'pos' ? -1 : kind === 'rx' ? 0 : kind === 'ry' ? 1 : 2;
  const head = `// KX-SHAKE ${s.id}
var A=effect("KX Shake Amount")("Slider")/100,S=effect("KX Shake Speed")("Slider")/100,sd=effect("KX Shake Seed")("Slider");
var t=time*S*${s.freq};
function n(o){var v=0,amp=1,fr=1;for(var i=0;i<${s.oct};i++){v+=noise([t*fr+o*17.3+sd*3.1,o*7.7+i*11.3,sd])*amp;amp*=0.5;fr*=2.1;}return v;}
${s.step ? 'function st(o){seedRandom(Math.floor(t*4)+o*101+sd*7,true);return random(-1,1);}' : ''}
var env=${s.decay ? `Math.exp(-Math.max(0,time-inPoint)*${s.decay})` : '1'};
`;
  const comp = (o: number, amp: number) => (s.step ? `st(${o})*${amp}` : `n(${o})*${amp}`);
  if (axis < 0) {
    const bob = s.bob ? `+Math.abs(Math.sin(t*Math.PI*2))*${s.bob}` : '';
    return `${head}[${comp(1, s.pos[0])}*A*env, (${comp(2, s.pos[1])}${bob})*A*env, ${comp(3, s.pos[2])}*A*env];`;
  }
  return `${head}value+${comp(10 + axis, (s.rot as number[])[axis])}*A*env;`;
}

export const LENSES = [14, 18, 24, 28, 35, 50, 70, 85, 105, 135, 200];
