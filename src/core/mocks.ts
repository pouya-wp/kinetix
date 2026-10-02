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
registerMock('textBegin', (p: any) => { console.log('[mock] textBegin', p.name); return { compId: ++mockComp }; });
registerMock('textLine', (_id: number, l: any) => { console.log('[mock] textLine', l.name, l.glyphs.length); return true; });
registerMock('textBaked', (_id: number, b: any) => { console.log('[mock] textBaked', b.name, b.paths.length); return true; });
registerMock('textBox', (_id: number, b: any) => { console.log('[mock] textBox', b.kind); return true; });
registerMock('textFinish', () => true);
