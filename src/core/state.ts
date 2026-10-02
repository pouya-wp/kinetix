import { Store } from './store';
import type { Ease, Vec } from './math';
import { uid } from './math';

// ───────── Comp / view ─────────
export interface Comp { w: number; h: number; fps: number; duration: number; bg: string; name: string }
export interface ViewOpts {
  dots: boolean;
  grid: boolean;
  gridSize: number;
  trail: boolean;
  onion: number;
  heat: boolean;
  guide: string | null;
  guideOpacity: number;
  guideX: number;
  guideY: number;
  guideScale: number;
}

// ───────── Bounce ─────────
export interface Bounce {
  id: string;
  x: number;
  y: number;
  /** apex height in px above the higher endpoint */
  arc: number;
  travel: number;
  hang: number;
  follow: boolean;
  hangEase: number;
  squash: number;
  stretch: number;
  squashTime: number;
}
export interface Collider { id: string; a: Vec; b: Vec }
export interface BallObj {
  id: string;
  name: string;
  color: string;
  radius: number;
  visible: boolean;
  mode: 'keyed' | 'physics';
  delay: number;
  start: Vec | null;
  bounces: Bounce[];
  phys: {
    vx: number; vy: number; gravity: number; restitution: number; friction: number;
    drag: number; duration: number; walls: boolean; floor: boolean; ceiling: boolean; squash: number; squashTime: number;
  };
  colliders: Collider[];
  rot: { mode: 'none' | 'roll' | 'spin'; spin: number; decay: number };
  deform: { align: boolean; volume: boolean; recover: number; anticipate: number };
  profile: 'physical' | 'curve';
  curve: Ease;
}
export interface BounceState { objects: BallObj[]; sel: string | null; selBounce: number; defaults: Omit<Bounce, 'id' | 'x' | 'y'> }

// ───────── Shapes ─────────
export interface PathData { v: Vec[]; i: Vec[]; o: Vec[]; closed: boolean }
export interface ShapeKey { id: string; t: number; path: PathData; x: number; y: number; rot: number; sx: number; sy: number; ease: Ease }
export type BehaviorType = 'jiggle' | 'breathe' | 'noise' | 'wave' | 'orbit' | 'drift' | 'spin' | 'pulse';
export interface Behavior { id: string; type: BehaviorType; on: boolean; p: Record<string, number> }
export interface ShapeItem {
  id: string;
  name: string;
  color: string;
  stroke: string;
  strokeW: number;
  opacity: number;
  visible: boolean;
  group: string | null;
  keys: ShapeKey[];
  behaviors: Behavior[];
  morph: 'linear' | 'center' | 'twist';
  points: number;
}
export interface MergeGroup { id: string; name: string; color: string; blend: number; res: number; smooth: number; minArea: number }
export interface ShapesState { items: ShapeItem[]; groups: MergeGroup[]; sel: string | null; selKey: string | null; loop: boolean }

// ───────── Text ─────────
export interface TextLine {
  id: string;
  layer: number;
  name: string;
  text: string;
  t0: number;
  t1: number;
  font: string;
  size: number;
  color: string;
  x: number;
  y: number;
  justify: 'left' | 'center' | 'right';
}
export type GapPolicy = 'fill' | 'close' | 'center' | 'keep';
export type TextStyle = 'magic' | 'liquid' | 'scramble' | 'wave' | 'elastic' | 'split' | 'typewriter';
export type BoxStyle = 'spring' | 'elastic' | 'liquid' | 'squash' | 'corners' | 'pill' | 'wipe' | 'pop';
export interface TextState {
  lines: TextLine[];
  sel: string | null;
  policy: GapPolicy;
  dur: number;
  minDur: number;
  maxDur: number;
  style: TextStyle;
  randomize: boolean;
  stagger: number;
  travel: 'arc' | 'straight' | 'spring';
  overshoot: number;
  seed: number;
  boxOn: boolean;
  box: {
    style: BoxStyle; padX: number; padY: number; radius: number; pill: boolean; minW: number;
    color: string; opacity: number; stiffness: number; damping: number; intensity: number; lag: number;
  };
  textColor: string;
  output: 'shapes' | 'live';
  disableOriginals: boolean;
}

// ───────── Render ─────────
export interface RenderState {
  preset: string;
  over: Record<string, number | string | boolean>;
  outDir: string;
  ffmpeg: string;
  engine: 'ffmpeg' | 'native' | 'ame';
  reframe: 'fit' | 'fill' | 'blur';
  batch: string[];
  keepIntermediate: boolean;
  useWorkArea: boolean;
}

export interface RootState {
  v: number;
  comp: Comp;
  view: ViewOpts;
  bounce: BounceState;
  shapes: ShapesState;
  text: TextState;
  render: RenderState;
}

export const defaultBounce = (): Omit<Bounce, 'id' | 'x' | 'y'> => ({
  arc: 260, travel: 0.42, hang: 0.06, follow: true, hangEase: 35, squash: 0.35, stretch: 0.2, squashTime: 0.08,
});

export function newBall(n: number, color = '#d1fe17'): BallObj {
  return {
    id: uid('ball'), name: `Ball ${n}`, color, radius: 48, visible: true, mode: 'keyed', delay: 0, start: null, bounces: [],
    phys: { vx: 520, vy: -300, gravity: 2400, restitution: 0.72, friction: 0.08, drag: 0.05, duration: 4, walls: true, floor: true, ceiling: false, squash: 0.35, squashTime: 0.08 },
    colliders: [],
    rot: { mode: 'none', spin: 360, decay: 0.4 },
    deform: { align: true, volume: true, recover: 0.5, anticipate: 0 },
    profile: 'physical',
    curve: [0.33, 0, 0.67, 1],
  };
}

export function initialState(): RootState {
  return {
    v: 1,
    comp: { w: 1920, h: 1080, fps: 30, duration: 6, bg: '#2b2d2f', name: 'Kinetix' },
    view: { dots: true, grid: true, gridSize: 60, trail: false, onion: 0, heat: false, guide: null, guideOpacity: 50, guideX: 0, guideY: 0, guideScale: 100 },
    bounce: { objects: [newBall(1)], sel: null, selBounce: -1, defaults: defaultBounce() },
    shapes: { items: [], groups: [], sel: null, selKey: null, loop: true },
    text: {
      lines: [], sel: null, policy: 'fill', dur: 0.45, minDur: 0.15, maxDur: 0.8, style: 'magic', randomize: false,
      stagger: 0.25, travel: 'arc', overshoot: 0.35, seed: 7, boxOn: true,
      box: { style: 'spring', padX: 36, padY: 20, radius: 22, pill: false, minW: 0, color: '#ffffff', opacity: 100, stiffness: 220, damping: 16, intensity: 1, lag: 0.04 },
      textColor: '#111111', output: 'shapes', disableOriginals: true,
    },
    render: { preset: 'yt-4k', over: {}, outDir: '', ffmpeg: '', engine: 'ffmpeg', reframe: 'blur', batch: [], keepIntermediate: false, useWorkArea: false },
  };
}

export const store = new Store<RootState>(initialState());
if (typeof window !== "undefined") (window as any).__kx = store;

// Persist the last scene so reopening the panel restores work.
const LS = 'kinetix.scene.v1';
export function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return;
    const s = migrate(JSON.parse(raw));
    if (s) store.replace(s, false);
  } catch { /* ignore */ }
}
let saveTimer: any = 0;
store.subscribe(() => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS, JSON.stringify(store.state)); } catch { /* quota */ }
  }, 400);
});

/** Merge a loaded scene over defaults so older files gain new fields. */
export function migrate(raw: any): RootState | null {
  if (!raw || typeof raw !== 'object' || !raw.comp) return null;
  const d = initialState();
  const deep = (base: any, over: any): any => {
    if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
    if (base && typeof base === 'object' && over && typeof over === 'object') {
      const o: any = { ...base };
      for (const k in over) o[k] = k in base ? deep(base[k], over[k]) : over[k];
      return o;
    }
    return over === undefined ? base : over;
  };
  const s = deep(d, raw) as RootState;
  s.bounce.objects = s.bounce.objects.map((o) => deep(newBall(1), o));
  return s;
}
