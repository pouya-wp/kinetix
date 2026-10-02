// Recorded sound library (public/sfx/lib): curated CC0 one-shots from Freesound and Kenney,
// trimmed, high-passed and loudness-matched offline (see scripts/sfx-curate notes in index).
import { nodeRequire, extensionRoot } from '../core/ae-bridge';

export interface LibSound {
  id: string;       // "water/single-water-drop"
  cat: string;      // water | bubble | pop | mallet | tick | goo | whoosh | impact | cartoon | magic | riser | ui | glitch
  name: string;
  file: string;
  dur: number;      // seconds
  cen: number;      // spectral centroid, Hz (brightness)
  f0: number;       // dominant pitch, Hz
  tonal: boolean;   // has a clear pitch → can be tuned
  score: number;    // curation score
  src: string;
  license: string;
}

export const LIB_CATS: { id: string; label: string }[] = [
  { id: 'pop', label: 'Pops' }, { id: 'water', label: 'Water' }, { id: 'bubble', label: 'Bubbles' }, { id: 'mallet', label: 'Mallets & Glass' },
  { id: 'tick', label: 'Ticks & Clicks' }, { id: 'ui', label: 'UI & Plucks' }, { id: 'goo', label: 'Squish & Goo' }, { id: 'whoosh', label: 'Whooshes' },
  { id: 'impact', label: 'Soft Impacts' }, { id: 'cartoon', label: 'Cartoon' }, { id: 'magic', label: 'Magic & Sparkle' }, { id: 'riser', label: 'Risers' },
  { id: 'glitch', label: 'Digital' },
];

let index: LibSound[] | null = null;
let indexP: Promise<LibSound[]> | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
let decodeCtx: OfflineAudioContext | null = null;

/** Folder that holds index.json — dist/sfx/lib inside AE, /sfx/lib on the dev server. */
function libDir(): string | null {
  const root = extensionRoot();
  const req = nodeRequire();
  if (!root || !req) return null;
  const path = req('path'), fs = req('fs');
  for (const d of [path.join(root, 'dist', 'sfx', 'lib'), path.join(root, 'sfx', 'lib'), path.join(root, 'public', 'sfx', 'lib')]) {
    if (fs.existsSync(path.join(d, 'index.json'))) return d;
  }
  return null;
}

async function readBytes(rel: string): Promise<ArrayBuffer> {
  const dir = libDir();
  if (dir) {
    const req = nodeRequire()!;
    const b: Uint8Array = req('fs').readFileSync(req('path').join(dir, rel));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  const r = await fetch('sfx/lib/' + rel);
  if (!r.ok) throw new Error(`Sound library missing (${rel})`);
  return r.arrayBuffer();
}

export function loadIndex(): Promise<LibSound[]> {
  if (index) return Promise.resolve(index);
  indexP ??= readBytes('index.json').then((b) => (index = JSON.parse(new TextDecoder().decode(b)) as LibSound[])).catch((e) => { indexP = null; throw e; });
  return indexP;
}
export const libIndex = () => index ?? [];

export function loadSound(s: LibSound): Promise<AudioBuffer> {
  let p = buffers.get(s.id);
  if (!p) {
    decodeCtx ??= new OfflineAudioContext(2, 1, 48000);
    p = readBytes(s.file).then((b) => decodeCtx!.decodeAudioData(b));
    p.catch(() => buffers.delete(s.id));
    buffers.set(s.id, p);
  }
  return p;
}

/** Time of the loudest 5 ms inside a buffer (for aligning whooshes to motion peaks). */
export function peakTime(b: AudioBuffer): number {
  const d = b.getChannelData(0), w = Math.max(1, Math.round(b.sampleRate * 0.005));
  let best = 0, bi = 0;
  for (let i = 0; i < d.length; i += w) {
    let s = 0; for (let k = i; k < Math.min(d.length, i + w); k++) s += d[k] * d[k];
    if (s > best) { best = s; bi = i; }
  }
  return bi / b.sampleRate;
}
