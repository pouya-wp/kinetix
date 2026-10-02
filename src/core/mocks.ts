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
