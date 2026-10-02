// 3D layer arrangements, computed in the panel and written to AE in one go.

import { rng } from '../core/math';

export interface SceneLayer { index: number; name: string; threeD: boolean; pos: number[]; scale: number[]; w: number; h: number; sel: boolean; kind: string; rot: number[] }
export interface Placement { index: number; pos: [number, number, number]; scale?: [number, number, number]; rot?: [number, number, number] }

export type ArrangeId = 'grid' | 'ring' | 'carousel' | 'sphere' | 'helix' | 'tunnel' | 'wall' | 'stack' | 'stairs' | 'scatter' | 'line-z' | 'fan' | 'cylinder' | 'cube' | 'wave';
export const ARRANGES: { id: ArrangeId; label: string; sub: string }[] = [
  { id: 'line-z', label: 'Depth Line', sub: 'one behind the other' },
  { id: 'stack', label: 'Card Stack', sub: 'offset deck of cards' },
  { id: 'grid', label: 'Grid', sub: 'rows and columns' },
  { id: 'wall', label: 'Depth Wall', sub: 'grid with depth variation' },
  { id: 'ring', label: 'Ring', sub: 'circle facing the camera' },
  { id: 'carousel', label: 'Carousel', sub: 'circle around Y, facing out' },
  { id: 'cylinder', label: 'Cylinder', sub: 'stacked carousels' },
  { id: 'sphere', label: 'Sphere', sub: 'evenly on a globe' },
  { id: 'helix', label: 'Helix', sub: 'spiral staircase of layers' },
  { id: 'tunnel', label: 'Tunnel', sub: 'ring of layers along depth' },
  { id: 'stairs', label: 'Stairs', sub: 'diagonal steps into depth' },
  { id: 'fan', label: 'Fan', sub: 'cards spread like a hand' },
  { id: 'wave', label: 'Wave', sub: 'row rippling in depth' },
  { id: 'cube', label: 'Cube', sub: 'a 3D volume grid' },
  { id: 'scatter', label: 'Scatter', sub: 'random in a volume' },
];

export interface ArrangeOpts { spacing: number; radius: number; depth: number; center: [number, number, number]; seed: number; face: boolean }

const deg = (r: number) => (r * 180) / Math.PI;

export function arrange(id: ArrangeId, L: SceneLayer[], o: ArrangeOpts): Placement[] {
  const n = L.length;
  const [cx, cy, cz] = o.center;
  const size = Math.max(...L.map((l) => Math.max(l.w * Math.abs(l.scale[0] / 100), l.h * Math.abs(l.scale[1] / 100))), 100);
  const sp = size * o.spacing;
  const out: Placement[] = [];
  const R = o.radius;
  const rand = rng(o.seed);
  L.forEach((l, i) => {
    const u = n > 1 ? i / (n - 1) : 0.5;
    const a = (i / n) * Math.PI * 2;
    let p: [number, number, number] = [cx, cy, cz];
    let rot: [number, number, number] | undefined;
    switch (id) {
      case 'line-z': p = [cx, cy, cz + i * o.depth]; break;
      case 'stack': p = [cx + i * sp * 0.06, cy - i * sp * 0.04, cz + i * o.depth * 0.25]; rot = [0, 0, (i - (n - 1) / 2) * 2.5]; break;
      case 'grid': {
        const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
        p = [cx + ((i % cols) - (cols - 1) / 2) * sp, cy + (Math.floor(i / cols) - (rows - 1) / 2) * sp, cz];
        break;
      }
      case 'wall': {
        const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
        p = [cx + ((i % cols) - (cols - 1) / 2) * sp, cy + (Math.floor(i / cols) - (rows - 1) / 2) * sp, cz + (rand() - 0.5) * o.depth];
        break;
      }
      case 'ring': p = [cx + Math.cos(a - Math.PI / 2) * R, cy + Math.sin(a - Math.PI / 2) * R, cz]; break;
      case 'carousel': p = [cx + Math.sin(a) * R, cy, cz - Math.cos(a) * R]; rot = [0, -deg(a), 0]; break;
      case 'cylinder': {
        const per = Math.max(3, Math.ceil(n / 3)), ring = Math.floor(i / per), b = ((i % per) / per) * Math.PI * 2 + ring * 0.4;
        p = [cx + Math.sin(b) * R, cy + (ring - (Math.ceil(n / per) - 1) / 2) * sp, cz - Math.cos(b) * R];
        rot = [0, -deg(b), 0];
        break;
      }
      case 'sphere': {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / n), th = Math.PI * (1 + Math.sqrt(5)) * i;
        const x = Math.cos(th) * Math.sin(phi), y = Math.cos(phi), z = Math.sin(th) * Math.sin(phi);
        p = [cx + x * R, cy + y * R, cz + z * R];
        rot = [deg(Math.asin(y)), -deg(Math.atan2(x, -z)), 0];
        break;
      }
      case 'helix': p = [cx + Math.sin(a * 2) * R, cy + (u - 0.5) * sp * n * 0.35, cz - Math.cos(a * 2) * R]; rot = [0, -deg(a * 2), 0]; break;
      case 'tunnel': {
        const b = i * 2.399;
        p = [cx + Math.cos(b) * R, cy + Math.sin(b) * R, cz + i * o.depth * 0.5];
        rot = [deg(Math.sin(b)) * 0.6, -deg(Math.cos(b)) * 0.6, deg(b) + 90];
        break;
      }
      case 'stairs': p = [cx + (i - (n - 1) / 2) * sp * 0.5, cy + (i - (n - 1) / 2) * sp * 0.3, cz + i * o.depth * 0.5]; break;
      case 'fan': p = [cx + (u - 0.5) * sp * 1.5, cy + Math.abs(u - 0.5) * sp * 0.3, cz + i * 4]; rot = [0, 0, (u - 0.5) * 50]; break;
      case 'wave': p = [cx + (i - (n - 1) / 2) * sp * 0.8, cy, cz + Math.sin(u * Math.PI * 2) * o.depth * 0.5]; rot = [0, deg(Math.cos(u * Math.PI * 2)) * 0.3, 0]; break;
      case 'cube': {
        const s = Math.ceil(Math.cbrt(n));
        const x = i % s, y = Math.floor(i / s) % s, z = Math.floor(i / (s * s));
        p = [cx + (x - (s - 1) / 2) * sp, cy + (y - (s - 1) / 2) * sp, cz + (z - (s - 1) / 2) * sp];
        break;
      }
      case 'scatter': p = [cx + (rand() - 0.5) * R * 2, cy + (rand() - 0.5) * R * 1.2, cz + (rand() - 0.5) * o.depth * 2]; rot = [(rand() - 0.5) * 20, (rand() - 0.5) * 30, (rand() - 0.5) * 30]; break;
    }
    out.push({ index: l.index, pos: p, rot: o.face ? undefined : rot });
  });
  return out;
}

export type DepthMode = 'linear' | 'exp' | 'reverse' | 'random' | 'center';
export const DEPTH_MODES: { id: DepthMode; label: string }[] = [
  { id: 'linear', label: 'Even' }, { id: 'exp', label: 'Exponential' }, { id: 'reverse', label: 'Reverse' }, { id: 'center', label: 'From center' }, { id: 'random', label: 'Random' },
];

/** Spread Z between near and far (keeps X/Y). With compensation, apparent size stays the same. */
export function distributeDepth(L: SceneLayer[], mode: DepthMode, near: number, far: number, compensate: boolean, cam: number[], seed: number): Placement[] {
  const camZ = cam[2];
  const n = L.length, rand = rng(seed);
  return L.map((l, i) => {
    let u = n > 1 ? i / (n - 1) : 0;
    if (mode === 'exp') u = u * u;
    if (mode === 'reverse') u = 1 - u;
    if (mode === 'center') u = Math.abs(u - 0.5) * 2;
    if (mode === 'random') u = rand();
    const z = near + (far - near) * u;
    const z0 = l.pos[2] ?? 0;
    const pl: Placement = { index: l.index, pos: [l.pos[0], l.pos[1], z] };
    if (compensate) {
      // same apparent size *and* screen position: scale everything about the camera axis
      const k = (z - camZ) / Math.max(1, z0 - camZ);
      pl.scale = [l.scale[0] * k, l.scale[1] * k, (l.scale[2] ?? 100) * k];
      pl.pos = [cam[0] + (l.pos[0] - cam[0]) * k, cam[1] + (l.pos[1] - cam[1]) * k, z];
    }
    return pl;
  });
}
