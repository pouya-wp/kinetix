// Fake AE host used in browser preview mode.
import { registerMock } from './ae-bridge';

registerMock('getActiveComp', () => ({ w: 1920, h: 1080, fps: 30, duration: 10, name: 'Preview Comp' }));
registerMock('bounceExport', (p: any) => {
  console.log('[mock] bounceExport', p);
  return { layers: p.balls.map((b: any) => b.name) };
});
registerMock('shapesExport', (p: any) => {
  console.log('[mock] shapesExport', p.layer.name, p.layer.kind, p.layer.paths.map((x: any) => x.t.length));
  return { layer: p.layer.name };
});
let mockComp = 0;
registerMock('textBegin', (p: any) => { console.log('[mock] textBegin', p.name); return { compId: ++mockComp, srcId: ++mockComp }; });
registerMock('textLine', (_id: number, l: any) => { console.log('[mock] textLine', l.name, l.glyphs.length); return true; });
registerMock('textBaked', (_id: number, b: any) => { console.log('[mock] textBaked', b.name, b.paths.length); return true; });
registerMock('textBox', (_id: number, b: any) => { console.log('[mock] textBox', b.kind); return true; });
registerMock('textFinish', () => true);
registerMock('defaultRenderFolder', () => 'C:/Users/You/Videos/Kinetix Renders');
registerMock('listFonts', () => [
  { ps: 'Inter-Bold', family: 'Inter', style: 'Bold' }, { ps: 'Arial-BoldMT', family: 'Arial', style: 'Bold' },
  { ps: 'Georgia', family: 'Georgia', style: 'Regular' }, { ps: 'Impact', family: 'Impact', style: 'Regular' },
  { ps: 'Verdana-Bold', family: 'Verdana', style: 'Bold' }, { ps: 'CourierNewPS-BoldMT', family: 'Courier New', style: 'Bold' },
]);
registerMock('textApplyStyle', (st: any) => ({ layers: st.target === 'built' ? 12 : 3, comps: 1 }));

// ── camera / animate preview mocks
const mockScene = {
  comp: { w: 1920, h: 1080, fps: 30, time: 0, duration: 10, name: 'Preview Comp' },
  rig: { name: 'KX Camera Rig', pos: [960, 540, 0], distance: 2667, orbit: 0, tilt: 0, roll: 0, focal: 50, pan: 0, look: 0, overshoot: 0 },
  cameras: [{ index: 1, name: 'KX Camera Rig Cam', active: true }],
  cam: [960, 540, -2667],
  layers: [
    { index: 3, name: 'Background', threeD: true, pos: [960, 540, 1800], scale: [180, 180, 100], rot: [0, 0, 0], w: 1920, h: 1080, sel: false, kind: 'footage' },
    { index: 4, name: 'Mountains', threeD: true, pos: [960, 640, 900], scale: [120, 120, 100], rot: [0, 0, 0], w: 1920, h: 700, sel: true, kind: 'footage' },
    { index: 5, name: 'Title', threeD: true, pos: [960, 500, 0], scale: [100, 100, 100], rot: [0, 0, 0], w: 900, h: 160, sel: true, kind: 'text' },
    { index: 6, name: 'Foreground leaves', threeD: true, pos: [700, 760, -600], scale: [90, 90, 100], rot: [0, 15, 0], w: 1200, h: 500, sel: true, kind: 'footage' },
  ],
};
registerMock('camScene', () => JSON.parse(JSON.stringify(mockScene)));
registerMock('camLayout', (p: any) => { for (const it of p.items) { const l = mockScene.layers.find((x) => x.index === it.index); if (l) { l.pos = it.pos; if (it.scale) l.scale = it.scale; if (it.rot) l.rot = it.rot; } } return { layers: p.items.length }; });
registerMock('camSetRig', (p: any) => { Object.assign(mockScene.rig, p); return true; });
for (const n of ['camRig', 'camCreate', 'camKeys', 'camLens', 'camMake3D', 'camFocus', 'camShake', 'camFrame', 'camTour', 'camFollow', 'camDepthFx', 'camMotionBlur', 'camBake', 'camSmooth', 'camCuts'])
  registerMock(n, (p: any) => { console.log('[mock]', n, p); return { layers: 3, props: 2 }; });
registerMock('easeApplyKeys', () => ({ keys: 4, props: 2 }));
registerMock('exprApply', () => ({ props: 2 }));
registerMock('animApply', (r: any) => { console.log('[mock] animApply', r); return { layers: 2, warnings: [] }; });
registerMock('animClear', () => ({ layers: 2 }));
registerMock('bakeKX', () => ({ props: 3, keys: 42, skipped: 0 }));
registerMock('typeApply', (r: any) => { console.log('[mock] typeApply', r); return { layers: 1 }; });
registerMock('typeClear', () => ({ layers: 1 }));
registerMock('physScene', () => ({ comp: { w: 1920, h: 1080, fps: 30, time: 0 }, layers: [] }));
registerMock('physBake', (p: any) => { console.log('[mock] physBake', p); return { layers: p.items.length }; });
registerMock('sfxFolder', () => null);
registerMock('sfxScan', () => [{ t: 0.5, dur: 0, kind: 'hit', strength: 0.8, x: 0.3, layer: 'Ball' }, { t: 1.2, dur: 0.8, kind: 'cam', strength: 0.6, x: 0.5, layer: 'Rig' }, { t: 2, dur: 0.3, kind: 'in', strength: 0.6, x: 0.7, layer: 'Title' }]);
registerMock('sfxPlace', (p: any) => ({ layers: p.files.length }));
registerMock('styleApply', (p: any) => { console.log('[mock] styleApply', p); return { layers: 1, missing: p.fx.some((f: any) => f.match[0].startsWith('Deep')) ? ['Deep Glow 2'] : [] }; });
registerMock('gradApply', (p: any) => { console.log('[mock] gradApply', p); return { layers: 1 }; });
registerMock('physScene2', () => ({ comp: { w: 1920, h: 1080, fps: 30, time: 0 }, layers: [] }));
const mockPose = { rig: 'KX Camera Rig', t: 0, fps: 30, duration: 10, keys: [0, 2.5], values: { distance: 2667, orbit: 0, tilt: 0, roll: 0, pan: 0, look: 0, focal: 50, position: [960, 540, 0] }, dof: { on: true, focus: 2667, aperture: 950, blur: 100, auto: false } };
registerMock('camPose', () => JSON.parse(JSON.stringify(mockPose)));
registerMock('camLive', (p: any) => { Object.assign(mockPose.values, p); return true; });
registerMock('camKeyPose', () => { if (!mockPose.keys.includes(mockPose.t)) mockPose.keys.push(mockPose.t); mockPose.keys.sort((a, b) => a - b); return { t: mockPose.t }; });
registerMock('camDeleteKey', () => { mockPose.keys = mockPose.keys.filter((k) => Math.abs(k - mockPose.t) > 0.01); return true; });
registerMock('camClearKeys', () => { mockPose.keys = []; return true; });
registerMock('camSetTime', (p: any) => { mockPose.t = p.t; return p.t; });
registerMock('camDOF', () => true);
registerMock('camSpread', () => ({ layers: 3 }));
registerMock('sfxSample', () => {
  const fps = 30, n = 120;
  const ball = Array.from({ length: n }, (_, f) => { const t = f / fps; const y = t < 1 ? 200 + 700 * t * t : 900 - Math.abs(Math.sin((t - 1) * 3)) * 250 * Math.exp(-(t - 1) * 1.5); return [400 + t * 200, Math.min(900, y)]; });
  const sc = Array.from({ length: n }, (_, f) => (f < 45 ? 0 : Math.min(100, (f - 45) * 12)));
  const op = Array.from({ length: n }, (_, f) => (f < 60 ? 0 : Math.min(100, (f - 60) * 20)));
  return { fps, t0: 0, end: 4, comp: { w: 1920, h: 1080 }, layers: [
    { name: 'Ball', index: 1, inPoint: 0, outPoint: 4, size: [120, 120], pos: ball, textKeys: [], pathKeys: [], markers: [] },
    { name: 'Badge', index: 2, inPoint: 0, outPoint: 4, size: [300, 300], scale: sc, textKeys: [], pathKeys: [], markers: [] },
    { name: 'Title', index: 3, inPoint: 0, outPoint: 4, size: [800, 120], op, textKeys: [2.4, 2.5, 2.6], pathKeys: [], markers: [] },
  ] };
});
// Auto-SFX v3 demo scene: a bouncing ball, three cards popping in, a slide-in panel, typed title, fade-out.
registerMock('sfxSample3', () => {
  const fps = 30, n = 165, T = (f: number) => f / fps;
  const blank = () => ({ x: [] as number[], y: [] as number[], s: [] as number[], r: [] as number[], o: [] as number[], markers: [], textKeys: [], pathKeys: [], type: null as any, inout: null, inner: false, inPoint: 0, outPoint: 5.5 });
  const ball = { ...blank(), name: 'Ball', kind: 'shape' };
  const cards = [0, 1, 2].map((i) => ({ ...blank(), name: 'Card ' + (i + 1), kind: 'solid' }));
  const panel = { ...blank(), name: 'Panel', kind: 'shape' };
  const title = { ...blank(), name: 'Title', kind: 'text', type: { text: 'Hello Kinetix', basedOn: 1, hasIn: true, hasOut: false, inDur: 0.25, outDur: null, stagger: 0.05, fit: 0, inT: 3.3, outT: 5.5 } };
  const back = (p: number) => { const c = 2.2; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
  for (let f = 0; f < n; f++) {
    const t = T(f);
    // ball: fall, then decaying bounces
    let y: number;
    if (t < 0.6) y = 150 + 750 * (t / 0.6) ** 2;
    else { const k = t - 0.6, per = [0.5, 0.35, 0.25], hts = [300, 140, 60]; let acc = 0, i = 0; while (i < 3 && k > acc + per[i]) { acc += per[i]; i++; } if (i >= 3) y = 900; else { const u = (k - acc) / per[i]; y = 900 - hts[i] * 4 * u * (1 - u); } }
    ball.x.push(300 + Math.min(t, 1.8) * 120); ball.y.push(y); ball.s.push(110); ball.r.push(0); ball.o.push(100);
    cards.forEach((c, i) => { const p = Math.max(0, Math.min(1, (t - 1.9 - i * 0.12) / 0.35)); c.x.push(700 + i * 300); c.y.push(300); c.s.push(p <= 0 ? 0 : 260 * back(p)); c.r.push(0); c.o.push(p > 0 ? 100 : 0); });
    const q = Math.max(0, Math.min(1, (t - 2.7) / 0.45)), e = 1 - Math.pow(1 - q, 4);
    panel.x.push(-400 + e * 1360); panel.y.push(760); panel.s.push(500); panel.r.push(0); panel.o.push(t > 4.8 ? Math.max(0, 100 - (t - 4.8) * 300) : 100);
    title.x.push(960); title.y.push(160); title.s.push(t >= 3.3 ? 400 : 0); title.r.push(0); title.o.push(t >= 3.3 ? 100 : 0);
  }
  return { fps, t0: 0, end: 5.5, comp: { w: 1920, h: 1080 }, layers: [ball, ...cards, panel, title] };
});
registerMock('sfxPlaceMix', (p: any) => ({ layers: p.files.length }));
