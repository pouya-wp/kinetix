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
