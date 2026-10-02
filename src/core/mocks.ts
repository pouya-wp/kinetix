// Fake AE host used in browser preview mode.
import { registerMock } from './ae-bridge';

registerMock('getActiveComp', () => ({ w: 1920, h: 1080, fps: 30, duration: 10, name: 'Preview Comp' }));
registerMock('bounceExport', (p: any) => {
  console.log('[mock] bounceExport', p);
  return { layers: p.balls.map((b: any) => b.name) };
});
