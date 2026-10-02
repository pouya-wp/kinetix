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
