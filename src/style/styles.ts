// One-click layer styles built from effect stacks. Each effect lists alternatives:
// the first one installed is used (e.g. Deep Glow 2 → AE Glow), so styles always work.

export interface FxSpec { match: string[]; name: string; props?: Record<string, any>; expr?: Record<string, string> }
export interface StyleDef { id: string; label: string; sub: string; group: string; fx: (c: Palette) => FxSpec[]; text?: (c: Palette) => { stroke?: [number[], number]; fill?: number[] }; extrude?: number }
export interface Palette { a: number[]; b: number[]; c: number[]; dark: number[]; light: number[] }

export const hex = (h: string): number[] => { const n = parseInt(h.replace('#', ''), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]; };

const GLOW = (name: string, radius: number, intensity: number, threshold = 60): FxSpec => ({
  match: ['Deep Glow 2', 'Deep Glow', 'ADBE Glo2'], name,
  props: { 'Radius': radius, 'Exposure': intensity * 0.6, 'Glow Radius': radius, 'Glow Intensity': intensity, 'Glow Threshold': threshold },
});
const FILL = (name: string, color: number[]): FxSpec => ({ match: ['ADBE Fill'], name, props: { 'Color': color } });
const RAMP = (name: string, c1: number[], c2: number[], radial = false): FxSpec => ({
  match: ['ADBE Ramp'], name, props: { 'Start Color': c1, 'End Color': c2, 'Ramp Shape': radial ? 2 : 1 },
  expr: { 'Start of Ramp': 'var r=sourceRectAtTime(time,false);[r.left+r.width/2,r.top];', 'End of Ramp': 'var r=sourceRectAtTime(time,false);[r.left+r.width/2,r.top+r.height];' },
});
const MATTE: FxSpec = { match: ['ADBE Set Matte3'], name: 'KX Style Matte', props: { 'Use For Matte': 4 }, expr: {} };
const BEVEL = (name: string, edge: number, intensity = 0.4, angle = -60): FxSpec => ({ match: ['ADBE Bevel Alpha'], name, props: { 'Edge Thickness': edge, 'Light Angle': angle, 'Light Intensity': intensity } });
const SHADOW = (name: string, color: number[], dist: number, soft: number, opacity: number, dir = 135): FxSpec => ({
  match: ['ADBE Drop Shadow'], name, props: { 'Shadow Color': color, 'Distance': dist, 'Softness': soft, 'Opacity': opacity * 2.55, 'Direction': dir },
});

export const STYLES: StyleDef[] = [
  { id: 'neon', label: 'Neon', sub: 'electric tube glow', group: 'Glow', fx: (c) => [FILL('KX Style Fill', c.light), GLOW('KX Style Glow', 30, 2.2), GLOW('KX Style Glow Wide', 120, 1.2, 40)], text: (c) => ({ stroke: [c.a, 3] }) },
  { id: 'soft-bloom', label: 'Soft Bloom', sub: 'dreamy highlight bloom', group: 'Glow', fx: () => [GLOW('KX Style Bloom', 160, 0.8, 30)] },
  { id: 'cyber', label: 'Cyber', sub: 'tinted glow + scanlines', group: 'Glow', fx: (c) => [FILL('KX Style Fill', c.a), GLOW('KX Style Glow', 40, 1.8), { match: ['ADBE Venetian Blinds'], name: 'KX Style Scanlines', props: { 'Transition Completion': 25, 'Direction': 0, 'Width': 4, 'Feather': 1 } }] },
  { id: 'hologram', label: 'Hologram', sub: 'cyan flicker projection', group: 'Glow', fx: () => [FILL('KX Style Fill', hex('#7df9ff')), GLOW('KX Style Glow', 50, 1.5),
    { match: ['ADBE Venetian Blinds'], name: 'KX Style Lines', props: { 'Transition Completion': 35, 'Direction': 0, 'Width': 6 } },
    { match: ['ADBE Exposure2'], name: 'KX Style Flicker', expr: { 'Exposure': 'seedRandom(Math.floor(time*12),true);random()>0.9?1.2:0;' } }] },
  { id: 'chrome', label: 'Chrome', sub: 'polished metal', group: 'Metal', fx: () => [RAMP('KX Style Ramp', hex('#ffffff'), hex('#6b7280')), MATTE, BEVEL('KX Style Bevel', 4, 0.6), { match: ['CC Light Sweep'], name: 'KX Style Shine', props: { 'Width': 60, 'Sweep Intensity': 70 } }] },
  { id: 'gold', label: 'Gold', sub: 'luxury gold leaf', group: 'Metal', fx: () => [RAMP('KX Style Ramp', hex('#f7e08a'), hex('#8e6a1f')), MATTE, BEVEL('KX Style Bevel', 3, 0.5), GLOW('KX Style Glow', 25, 0.6, 75)] },
  { id: 'rose-gold', label: 'Rose Gold', sub: 'soft pink metal', group: 'Metal', fx: () => [RAMP('KX Style Ramp', hex('#f9d3cf'), hex('#a0525c')), MATTE, BEVEL('KX Style Bevel', 3, 0.45)] },
  { id: 'emboss', label: 'Embossed', sub: 'pressed into the surface', group: 'Depth', fx: (c) => [BEVEL('KX Style Bevel', 2.5, 0.5), SHADOW('KX Style Shadow', c.dark, 4, 8, 35)] },
  { id: 'glass-btn', label: 'Glass Button', sub: 'glossy 3D button', group: 'Depth', fx: (c) => [BEVEL('KX Style Bevel', 6, 0.7), SHADOW('KX Style Shadow', c.dark, 12, 30, 40), GLOW('KX Style Glow', 20, 0.4, 80)] },
  { id: 'paper', label: 'Paper Cut', sub: 'layered paper depth', group: 'Depth', fx: (c) => [SHADOW('KX Style Shadow', c.dark, 6, 20, 45), BEVEL('KX Style Bevel', 1.5, 0.25)] },
  { id: 'long-shadow', label: 'Long Shadow', sub: 'flat design shadow', group: 'Shadow', fx: (c) => Array.from({ length: 8 }, (_, i) => SHADOW(`KX Style Long ${i + 1}`, c.dark, 6 + i * 8, 0, 100 - i * 9)) },
  { id: 'soft-shadow', label: 'Soft Shadow', sub: 'cinematic float', group: 'Shadow', fx: (c) => [SHADOW('KX Style Shadow', c.dark, 25, 70, 45, 160)] },
  { id: 'hard-shadow', label: 'Pop Shadow', sub: 'bold offset shadow', group: 'Shadow', fx: (c) => [SHADOW('KX Style Shadow', c.a, 14, 0, 100)] },
  { id: 'outline', label: 'Outline', sub: 'stroke on text', group: 'Stroke', fx: () => [], text: (c) => ({ stroke: [c.light, 6] }) },
  { id: 'double-outline', label: 'Double Outline', sub: 'stroke + offset shadow', group: 'Stroke', fx: (c) => [SHADOW('KX Style Shadow', c.a, 8, 0, 100)], text: (c) => ({ stroke: [c.dark, 8] }) },
  { id: 'retro', label: 'Retro 80s', sub: 'sunset chrome + hard shadow', group: 'Fun', fx: () => [RAMP('KX Style Ramp', hex('#ffd319'), hex('#ff2975')), MATTE, BEVEL('KX Style Bevel', 3, 0.5), SHADOW('KX Style Shadow', hex('#8c1eff'), 12, 0, 100), GLOW('KX Style Glow', 40, 0.7)] },
  { id: 'fire', label: 'Fire', sub: 'burning heat', group: 'Fun', fx: () => [RAMP('KX Style Ramp', hex('#fff200'), hex('#ff2a00')), MATTE, { match: ['ADBE Turbulent Displace'], name: 'KX Style Heat', props: { 'Amount': 12, 'Size': 18 }, expr: { 'Evolution': 'time*400;' } }, GLOW('KX Style Glow', 60, 1.4, 40)] },
  { id: 'glitch', label: 'Glitch', sub: 'digital tearing loop', group: 'Fun', fx: (): FxSpec[] => [{ match: ['ADBE Turbulent Displace'], name: 'KX Style Glitch', props: { 'Size': 4, 'Complexity': 1 }, expr: { 'Amount': 'seedRandom(Math.floor(time*10),true);random()>0.8?random(20,80):0;', 'Evolution': 'Math.floor(time*10)*90;' } }, { match: ['ADBE Motion Blur'], name: 'KX Style Smear', props: { 'Direction': 90 }, expr: { 'Blur Length': 'seedRandom(Math.floor(time*10)+7,true);random()>0.85?40:0;' } }] },
  { id: 'gradient-text', label: 'Brand Gradient', sub: 'brand colors top → bottom', group: 'Color', fx: (c) => [RAMP('KX Style Ramp', c.a, c.b), MATTE] },
  { id: 'duotone', label: 'Duotone', sub: 'two brand colors mapped', group: 'Color', fx: (c) => [{ match: ['ADBE Tint'], name: 'KX Style Duotone', props: { 'Map Black To': c.dark, 'Map White To': c.a } }] },
  { id: 'extrude', label: '3D Extrude', sub: 'real depth (Advanced 3D)', group: 'Depth', fx: () => [], extrude: 40 },
];
export const STYLE_GROUPS = [...new Set(STYLES.map((s) => s.group))];
