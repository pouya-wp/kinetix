import type { PathData, ShapeItem, ShapeKey, MergeGroup, BehaviorType, ShapesState } from '../core/state';
import { uid, EASES, type Ease } from '../core/math';
import { rectPath, ellipsePath, polygonPath, starPath, heartPath, blobPath, pathBounds } from './geometry';
import { defaultParams } from './engine';

export type FormId = 'circle' | 'square' | 'rounded' | 'triangle' | 'pentagon' | 'star' | 'burst' | 'heart' | 'blob' | 'pill' | 'diamond';
export const FORMS: { id: FormId; label: string }[] = [
  { id: 'circle', label: 'Circle' }, { id: 'square', label: 'Square' }, { id: 'rounded', label: 'Rounded' }, { id: 'pill', label: 'Pill' },
  { id: 'triangle', label: 'Triangle' }, { id: 'diamond', label: 'Diamond' }, { id: 'pentagon', label: 'Pentagon' }, { id: 'star', label: 'Star' },
  { id: 'burst', label: 'Burst' }, { id: 'heart', label: 'Heart' }, { id: 'blob', label: 'Blob' },
];

/** A form sized to fit a w×h box. */
export function formPath(id: FormId, w = 240, h = 240, seed = 1): PathData {
  const r = Math.min(w, h) / 2;
  switch (id) {
    case 'circle': return ellipsePath(w, h);
    case 'square': return rectPath(w, h, 0);
    case 'rounded': return rectPath(w, h, Math.min(w, h) * 0.22);
    case 'pill': return rectPath(w * 1.6, h * 0.62, h * 0.31);
    case 'triangle': return polygonPath(r * 1.1, 3, 0.25);
    case 'diamond': return polygonPath(r, 4, 0.12);
    case 'pentagon': return polygonPath(r, 5, 0.2);
    case 'star': return starPath(r, r * 0.45, 5, 0.18);
    case 'burst': return starPath(r, r * 0.72, 12, 0.3);
    case 'heart': return heartPath(r * 1.9);
    case 'blob': return blobPath(r, 5, seed, 0.22);
  }
}

export function makeKey(t: number, path: PathData, x: number, y: number, ease: Ease = EASES.snappy): ShapeKey {
  return { id: uid('k'), t, path, x, y, rot: 0, sx: 1, sy: 1, ease: [...ease] as Ease };
}

export function makeItem(name: string, color: string, path: PathData, x: number, y: number): ShapeItem {
  return { id: uid('shp'), name, color, stroke: '#ffffff', strokeW: 0, opacity: 100, visible: true, group: null, keys: [makeKey(0, path, x, y)], behaviors: [], morph: 'center', points: 128 };
}

export function makeGroup(n: number, color = '#d1fe17'): MergeGroup {
  return { id: uid('grp'), name: `Merge ${n}`, color, blend: 90, res: 5, smooth: 1, minArea: 40 };
}

export function behavior(type: BehaviorType, over: Record<string, number> = {}) {
  return { id: uid('bh'), type, on: true, p: { ...defaultParams(type), ...over } };
}

export function pathSize(p: PathData) { const b = pathBounds(p); return { w: b.w, h: b.h }; }

// ───────── demo scenes ─────────
export const PRESETS: { id: string; label: string; build: (W: number, H: number, D: number) => Partial<ShapesState> }[] = [
  {
    id: 'lava', label: 'Lava lamp',
    build: (W, H) => {
      const g = makeGroup(1, '#d1fe17');
      g.blend = 140; g.res = 6;
      const cols = [[0.38, 0.45, 260], [0.6, 0.55, 210], [0.5, 0.3, 150], [0.45, 0.7, 180]];
      const items = cols.map(([x, y, s], i) => {
        const it = makeItem(`Blob ${i + 1}`, '#d1fe17', formPath('circle', s, s), W * x, H * y);
        it.group = g.id;
        it.behaviors = [behavior('drift', { amp: 220 + i * 40, speed: 0.18 + i * 0.04, seed: i * 11 + 2 }), behavior('breathe', { amp: 0.12, speed: 0.3 + i * 0.07, phase: i * 0.25 })];
        return it;
      });
      return { items, groups: [g], loop: true };
    },
  },
  {
    id: 'morph', label: 'Morph loop',
    build: (W, H, D) => {
      const forms: FormId[] = ['circle', 'star', 'rounded', 'heart', 'burst', 'circle'];
      const it = makeItem('Morpher', '#d1fe17', formPath('circle', 320, 320), W / 2, H / 2);
      it.keys = forms.map((f, i) => makeKey((i / (forms.length - 1)) * D, formPath(f, 320, 320), W / 2, H / 2, EASES.expo));
      it.keys.forEach((k, i) => { k.rot = i * 72; });
      it.behaviors = [behavior('jiggle', { amount: 1, stiffness: 160, damping: 6 })];
      return { items: [it], groups: [], loop: true };
    },
  },
  {
    id: 'split', label: 'Split & merge',
    build: (W, H, D) => {
      const g = makeGroup(1, '#4cc9f0');
      g.blend = 160;
      const mk = (name: string, dir: number) => {
        const it = makeItem(name, '#4cc9f0', formPath('circle', 260, 260), W / 2, H / 2);
        it.group = g.id;
        it.keys = [makeKey(0, formPath('circle', 260, 260), W / 2, H / 2, EASES.smooth), makeKey(D * 0.45, formPath('circle', 200, 200), W / 2 + dir * W * 0.26, H / 2, EASES.smooth), makeKey(D * 0.9, formPath('circle', 260, 260), W / 2, H / 2, EASES.smooth)];
        it.behaviors = [behavior('jiggle', { amount: 0.8 })];
        return it;
      };
      return { items: [mk('Left', -1), mk('Right', 1)], groups: [g], loop: true };
    },
  },
  {
    id: 'jelly', label: 'Jelly drop',
    build: (W, H, D) => {
      const it = makeItem('Jelly', '#ff7ac6', formPath('rounded', 280, 280), W / 2, H * 0.2);
      const f = formPath('rounded', 280, 280);
      it.keys = [makeKey(0, f, W / 2, H * 0.2, EASES.easeIn), makeKey(D * 0.3, f, W / 2, H * 0.62, EASES.snappy), makeKey(D * 0.6, f, W / 2, H * 0.55, EASES.smooth), makeKey(D, f, W / 2, H * 0.62, EASES.smooth)];
      it.behaviors = [behavior('jiggle', { amount: 1.4, stiffness: 140, damping: 5, inertia: 1.2 })];
      return { items: [it], groups: [], loop: false };
    },
  },
  {
    id: 'wobble', label: 'Wobbly blob',
    build: (W, H) => {
      const it = makeItem('Wobble', '#b388ff', formPath('blob', 420, 420, 4), W / 2, H / 2);
      it.behaviors = [behavior('noise', { amp: 26, freq: 5, speed: 0.6 }), behavior('wave', { amp: 6, count: 9, speed: 0.4 }), behavior('spin', { speed: 20 })];
      return { items: [it], groups: [], loop: true };
    },
  },
  {
    id: 'orbit', label: 'Orbit goo',
    build: (W, H) => {
      const g = makeGroup(1, '#ffb238');
      g.blend = 120;
      const core = makeItem('Core', '#ffb238', formPath('circle', 300, 300), W / 2, H / 2);
      core.group = g.id;
      core.behaviors = [behavior('breathe', { amp: 0.08, speed: 0.5 })];
      const sats = [0, 1, 2].map((i) => {
        const s = makeItem(`Moon ${i + 1}`, '#ffb238', formPath('circle', 110, 110), W / 2 + 260, H / 2);
        s.group = g.id;
        s.behaviors = [behavior('orbit', { radius: 250 + i * 30, speed: 0.17 * (i % 2 ? -1 : 1) * (1 + i * 0.5), phase: i / 3 })];
        // orbit offsets are relative to the key position, so start on the ring
        const R = 250 + i * 30, a = (i / 3) * Math.PI * 2;
        s.keys[0].x = W / 2 + Math.cos(a) * R;
        s.keys[0].y = H / 2 + Math.sin(a) * R;
        return s;
      });
      return { items: [core, ...sats], groups: [g], loop: true };
    },
  },
];
