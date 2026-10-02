// Gradient library: a hand-tuned core set + harmonious generated families
// (built in OKLCH so every gradient stays smooth and vivid). 500+ total.

import { rng } from '../core/math';

export interface Stop { c: string; p: number }
export interface Gradient { id: string; name: string; cat: string; stops: Stop[]; angle: number; type: 'linear' | 'radial' | 'mesh' }

// ── OKLCH → sRGB hex
function oklchToHex(L: number, C: number, H: number) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = (x: number) => { x = Math.min(1, Math.max(0, x)); return Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255); };
  return '#' + [enc(r), enc(g), enc(bl)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

const CORE: [string, string, string[], number?][] = [
  ['Lime Pulse', 'Signature', ['#d1fe17', '#4cc9f0'], 135], ['Acid Night', 'Signature', ['#0f1113', '#d1fe17'], 160], ['Electric Mint', 'Signature', ['#d1fe17', '#2ee59d', '#4cc9f0']],
  ['Golden Hour', 'Sunset', ['#ff9a3c', '#ff5e62', '#7b2ff7']], ['Peach Fizz', 'Sunset', ['#ffd3a5', '#fd6585']], ['Miami', 'Sunset', ['#ff6a88', '#ff99ac', '#fcb69f']],
  ['Dusk Drive', 'Sunset', ['#2b5876', '#4e4376']], ['Tangerine', 'Sunset', ['#f83600', '#f9d423']], ['Sunrise Haze', 'Sunset', ['#ff512f', '#dd2476']],
  ['Deep Sea', 'Ocean', ['#00c6fb', '#005bea']], ['Lagoon', 'Ocean', ['#43e97b', '#38f9d7']], ['Glacier', 'Ocean', ['#e0eafc', '#cfdef3']], ['Abyss', 'Ocean', ['#0f2027', '#203a43', '#2c5364']],
  ['Hyperwave', 'Neon', ['#f72585', '#7209b7', '#3a0ca3', '#4361ee', '#4cc9f0']], ['Cyber Pink', 'Neon', ['#ff00cc', '#333399']], ['Laser', 'Neon', ['#12c2e9', '#c471ed', '#f64f59']], ['Toxic', 'Neon', ['#b3ff00', '#00ffb3']],
  ['Cotton Candy', 'Pastel', ['#fbc2eb', '#a6c1ee']], ['Mint Cream', 'Pastel', ['#d4fc79', '#96e6a1']], ['Lavender Mist', 'Pastel', ['#e0c3fc', '#8ec5fc']], ['Sorbet', 'Pastel', ['#fddb92', '#d1fdff']],
  ['Obsidian', 'Dark', ['#000000', '#434343']], ['Midnight', 'Dark', ['#232526', '#414345']], ['Royal Night', 'Dark', ['#141e30', '#243b55']], ['Eclipse', 'Dark', ['#0f0c29', '#302b63', '#24243e']],
  ['Chrome', 'Metallic', ['#e6e9f0', '#8e9eab', '#eef1f5', '#7b8794'], 90], ['Gold Leaf', 'Metallic', ['#9f8754', '#ead9a3', '#8e733a'], 45], ['Rose Gold', 'Metallic', ['#b76e79', '#f4c4c4', '#a0525c'], 45], ['Bronze', 'Metallic', ['#804a00', '#e8a85a', '#5c3500'], 45],
  ['Inferno', 'Fire', ['#f12711', '#f5af19']], ['Ember', 'Fire', ['#3a0000', '#c31432', '#f5af19']], ['Lava', 'Fire', ['#ff0000', '#ff7300', '#fffb00']],
  ['Aurora', 'Aurora', ['#00c9ff', '#92fe9d']], ['Borealis', 'Aurora', ['#43cea2', '#185a9d']], ['Polar Lights', 'Aurora', ['#3a1c71', '#d76d77', '#ffaf7b']],
  ['Forest Mist', 'Nature', ['#5a3f37', '#2c7744']], ['Moss', 'Nature', ['#134e5e', '#71b280']], ['Sandstone', 'Nature', ['#c79081', '#dfa579']],
];

const ADJ = ['Velvet', 'Silent', 'Electric', 'Golden', 'Frozen', 'Hidden', 'Neon', 'Soft', 'Cosmic', 'Wild', 'Crystal', 'Burning', 'Misty', 'Royal', 'Lunar', 'Solar', 'Candy', 'Urban', 'Retro', 'Dreamy', 'Toxic', 'Liquid', 'Paper', 'Smoky'];
const NOUN = ['Dusk', 'Bloom', 'Wave', 'Haze', 'Pulse', 'Drift', 'Glow', 'Orbit', 'Ember', 'Tide', 'Prism', 'Mirage', 'Nova', 'Echo', 'Flare', 'Dream', 'Storm', 'Garden', 'Signal', 'Horizon'];

function generated(): Gradient[] {
  const out: Gradient[] = [];
  const families: { cat: string; n: number; make: (r: () => number) => { stops: string[]; angle: number; type?: Gradient['type'] } }[] = [
    { cat: 'Vivid', n: 90, make: (r) => { const h = r() * 360, d = 40 + r() * 80; return { stops: [oklchToHex(0.72, 0.19, h), oklchToHex(0.62, 0.22, h + d)], angle: Math.round(r() * 8) * 45 }; } },
    { cat: 'Pastel', n: 50, make: (r) => { const h = r() * 360; return { stops: [oklchToHex(0.9, 0.07, h), oklchToHex(0.86, 0.09, h + 50 + r() * 70)], angle: 135 }; } },
    { cat: 'Neon', n: 50, make: (r) => { const h = r() * 360; return { stops: [oklchToHex(0.7, 0.3, h), oklchToHex(0.55, 0.28, h + 90 + r() * 60), oklchToHex(0.82, 0.22, h + 180)], angle: Math.round(r() * 4) * 45 }; } },
    { cat: 'Dark', n: 45, make: (r) => { const h = r() * 360; return { stops: [oklchToHex(0.18, 0.04, h), oklchToHex(0.32, 0.09, h + 30 + r() * 40)], angle: 160 }; } },
    { cat: 'Duotone', n: 45, make: (r) => { const h = r() * 360; return { stops: [oklchToHex(0.3, 0.12, h), oklchToHex(0.85, 0.15, h + 180)], angle: 90 }; } },
    { cat: 'Sunset', n: 35, make: (r) => { const h = 10 + r() * 50; return { stops: [oklchToHex(0.82, 0.15, h + 50), oklchToHex(0.66, 0.2, h), oklchToHex(0.45, 0.17, h - 50 + 360)], angle: 180 }; } },
    { cat: 'Ocean', n: 35, make: (r) => { const h = 180 + r() * 70; return { stops: [oklchToHex(0.85, 0.11, h - 20), oklchToHex(0.55, 0.15, h + 20), oklchToHex(0.3, 0.1, h + 40)], angle: 180 }; } },
    { cat: 'Monochrome', n: 30, make: (r) => { const h = r() * 360, c = 0.04 + r() * 0.14; return { stops: [oklchToHex(0.92, c * 0.6, h), oklchToHex(0.45, c, h)], angle: 135 }; } },
    { cat: 'Radial', n: 40, make: (r) => { const h = r() * 360; return { stops: [oklchToHex(0.85, 0.18, h), oklchToHex(0.5, 0.2, h + 40 + r() * 60), oklchToHex(0.2, 0.06, h + 90)], angle: 0, type: 'radial' }; } },
    { cat: 'Mesh', n: 55, make: (r) => { const h = r() * 360; return { stops: [0, 1, 2, 3].map((i) => oklchToHex(0.65 + r() * 0.2, 0.12 + r() * 0.12, h + i * (50 + r() * 40))), angle: 0, type: 'mesh' }; } },
  ];
  let id = 0;
  for (const f of families) {
    const r = rng(f.cat.length * 991 + 17);
    for (let i = 0; i < f.n; i++) {
      const g = f.make(r);
      const name = `${ADJ[Math.floor(r() * ADJ.length)]} ${NOUN[Math.floor(r() * NOUN.length)]}`;
      out.push({ id: 'g' + id++, name, cat: f.cat, stops: g.stops.map((c, k) => ({ c, p: k / (g.stops.length - 1) })), angle: g.angle, type: g.type ?? 'linear' });
    }
  }
  return out;
}

export const GRADIENTS: Gradient[] = [
  ...CORE.map(([name, cat, cs, angle], i) => ({ id: 'c' + i, name, cat, stops: cs.map((c, k) => ({ c, p: k / (cs.length - 1) })), angle: angle ?? 135, type: 'linear' as const })),
  ...generated(),
];
export const GRADIENT_CATS = [...new Set(GRADIENTS.map((g) => g.cat))];

export function cssOf(g: Gradient) {
  const st = g.stops.map((s) => `${s.c} ${Math.round(s.p * 100)}%`).join(', ');
  if (g.type === 'radial') return `radial-gradient(circle at 50% 45%, ${st})`;
  if (g.type === 'mesh') {
    const c = g.stops.map((s) => s.c);
    return `radial-gradient(at 0% 0%, ${c[0]} 0, transparent 60%), radial-gradient(at 100% 0%, ${c[1]} 0, transparent 60%), radial-gradient(at 100% 100%, ${c[2]} 0, transparent 60%), radial-gradient(at 0% 100%, ${c[3] ?? c[0]} 0, transparent 60%), ${c[0]}`;
  }
  return `linear-gradient(${g.angle}deg, ${st})`;
}

/** Render a gradient to PNG bytes (used for multi-stop / mesh gradients in AE). */
export function renderPng(g: Gradient, size = 2048): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d')!;
  const paint = (stops: Stop[], grad: CanvasGradient) => { stops.forEach((s) => grad.addColorStop(s.p, s.c)); return grad; };
  if (g.type === 'radial') {
    x.fillStyle = paint(g.stops, x.createRadialGradient(size / 2, size * 0.45, 0, size / 2, size * 0.45, size * 0.72));
    x.fillRect(0, 0, size, size);
  } else if (g.type === 'mesh') {
    const cs = g.stops.map((s) => s.c);
    x.fillStyle = cs[0]; x.fillRect(0, 0, size, size);
    const corners: [number, number][] = [[0, 0], [size, 0], [size, size], [0, size]];
    corners.forEach(([px, py], i) => {
      const rg = x.createRadialGradient(px, py, 0, px, py, size * 0.85);
      rg.addColorStop(0, cs[i] ?? cs[0]); rg.addColorStop(1, (cs[i] ?? cs[0]) + '00');
      x.fillStyle = rg; x.fillRect(0, 0, size, size);
    });
  } else {
    const a = ((g.angle - 90) * Math.PI) / 180, R = size * 0.75;
    x.fillStyle = paint(g.stops, x.createLinearGradient(size / 2 - Math.cos(a) * R, size / 2 - Math.sin(a) * R, size / 2 + Math.cos(a) * R, size / 2 + Math.sin(a) * R));
    x.fillRect(0, 0, size, size);
  }
  return new Promise((res) => c.toBlob((b) => b!.arrayBuffer().then((ab) => res(new Uint8Array(ab))), 'image/png'));
}
