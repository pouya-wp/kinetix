// Brand Kit storage. The active brand feeds colours, gradients, fonts and the
// default ease into every Kinetix section.

export interface Brand {
  id: string;
  name: string;
  colors: string[];
  gradients: string[]; // gradient ids from the library
  heading: { ps: string; family: string };
  body: { ps: string; family: string };
  logo: string | null; // data URL
  ease: string;
}

const LS = 'kinetix.brands';
const DEFAULT: Brand = {
  id: 'kinetix', name: 'Kinetix Default', colors: ['#d1fe17', '#4cc9f0', '#b388ff', '#0f1113', '#f7f7f8', '#ff5a5f'],
  gradients: ['c0', 'c1'], heading: { ps: '', family: '' }, body: { ps: '', family: '' }, logo: null, ease: 'easyEase',
};

type Listener = () => void;
const listeners = new Set<Listener>();
let state: { brands: Brand[]; active: string } = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS) || 'null');
    if (s?.brands?.length) return s;
  } catch { /* */ }
  return { brands: [structuredClone(DEFAULT)], active: DEFAULT.id };
}
function save() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch { /* */ } listeners.forEach((l) => l()); }

export const brands = () => state.brands;
export const activeBrand = (): Brand => state.brands.find((b) => b.id === state.active) ?? state.brands[0];
export function setActive(id: string) { state.active = id; save(); }
export function updateBrand(fn: (b: Brand) => void) { fn(activeBrand()); save(); }
export function addBrand(name: string) {
  const b = { ...structuredClone(activeBrand()), id: 'b' + Date.now().toString(36), name };
  state.brands.push(b); state.active = b.id; save();
  return b;
}
export function removeBrand(id: string) {
  if (state.brands.length < 2) return;
  state.brands = state.brands.filter((b) => b.id !== id);
  state.active = state.brands[0].id; save();
}
export function importBrands(json: string) {
  const data = JSON.parse(json);
  const list: Brand[] = Array.isArray(data) ? data : data.brands ?? [data];
  for (const b of list) { if (!b?.colors) continue; b.id = 'b' + Math.random().toString(36).slice(2, 8); state.brands.push({ ...structuredClone(DEFAULT), ...b }); }
  save();
}
export const exportBrands = () => JSON.stringify({ kinetixBrands: 1, brands: state.brands }, null, 1);
export function onBrand(fn: Listener) { listeners.add(fn); return () => listeners.delete(fn); }

/** k-means palette extraction from an image (data URL). */
export async function extractPalette(src: string, k = 6): Promise<string[]> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  const s = 96;
  c.width = s; c.height = s;
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0, s, s);
  const d = x.getImageData(0, 0, s, s).data;
  const px: number[][] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2]]);
  if (!px.length) return [];
  let cent = Array.from({ length: k }, (_, i) => px[Math.floor((i / k) * px.length)].slice());
  for (let it = 0; it < 12; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      cent.forEach((q, j) => { const dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (dd < bd) { bd = dd; bi = j; } });
      sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; sum[bi][3]++;
    }
    cent = sum.map((s2, j) => (s2[3] ? [s2[0] / s2[3], s2[1] / s2[3], s2[2] / s2[3]] : cent[j]));
  }
  const counts = cent.map((q) => px.filter((p) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 < 900).length);
  return cent.map((q, i) => ({ q, n: counts[i] })).sort((a, b) => b.n - a.n)
    .map(({ q }) => '#' + q.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
}
