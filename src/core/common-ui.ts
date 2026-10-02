import { store, migrate, type RootState } from './state';
import { Section, Field, NumInput, Toggle, Slider, Btn, ColorField, h, toast, pickFile, downloadText } from '../ui/kit';
import { call, inAE, chooseSaveFile, chooseOpenFile, writeTextFile, readTextFile } from './ae-bridge';
import { clock } from './clock';

const S = () => store.state;

// ───────── Scene IO ─────────
export async function saveScene() {
  const json = JSON.stringify({ kinetix: 1, ...S() }, null, 1);
  if (inAE) {
    const p = chooseSaveFile('Save Kinetix scene', 'scene.kinetix.json', 'json');
    if (!p) return;
    if (writeTextFile(p, json)) toast('Scene saved'); else toast('Could not write file', 'err');
    return;
  }
  downloadText('scene.kinetix.json', json);
  toast('Scene saved');
}

export async function loadScene() {
  let text: string | null = null;
  if (inAE) {
    const p = chooseOpenFile('Open Kinetix scene', ['json']);
    if (!p) return;
    text = readTextFile(p);
  } else {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    text = await f.text();
  }
  try {
    const s = migrate(JSON.parse(text ?? ''));
    if (!s) throw new Error('not a Kinetix scene');
    store.replace(s);
    toast('Scene loaded');
  } catch (e: any) {
    toast('Load failed: ' + e.message, 'err');
  }
}

export function SceneSection() {
  const undoB = Btn('Undo', () => store.undo(), { icon: 'undo', size: 'sm' });
  const redoB = Btn('Redo', () => store.redo(), { icon: 'redo', size: 'sm' });
  const sec = Section('Scene', [
    h('div', { class: 'row' }, Btn('Save scene', saveScene, { icon: 'save', size: 'sm' }), Btn('Load scene', loadScene, { icon: 'open', size: 'sm' })),
    h('div', { class: 'row' }, undoB, redoB),
  ]);
  store.subscribe(() => { undoB.disabled = !store.canUndo; redoB.disabled = !store.canRedo; });
  return sec;
}

// ───────── Comp ─────────
export async function syncCompFromAE(silent = false) {
  try {
    const c = await call<{ w: number; h: number; fps: number; duration: number; name: string } | null>('getActiveComp');
    if (!c) { if (!silent) toast('No active composition in AE', 'info'); return false; }
    store.set((s) => { s.comp.w = c.w; s.comp.h = c.h; s.comp.fps = c.fps; s.comp.duration = c.duration; s.comp.name = c.name; });
    if (!silent) toast(`Synced “${c.name}” · ${c.w}×${c.h} · ${+c.fps.toFixed(3)} fps`);
    return true;
  } catch (e: any) {
    if (!silent) toast(e.message, 'err');
    return false;
  }
}

export function CompSection(opts: { duration?: boolean; color?: string } = {}) {
  const setC = (k: keyof RootState['comp']) => (v: number) => store.set((s) => { (s.comp as any)[k] = v; });
  return Section('Comp', [
    h('div', { class: 'row' },
      Field('Width', NumInput({ get: () => S().comp.w, set: setC('w'), min: 4, max: 16384, int: true })),
      Field('Height', NumInput({ get: () => S().comp.h, set: setC('h'), min: 4, max: 16384, int: true })),
    ),
    h('div', { class: 'row' },
      Field('Frame rate', NumInput({ get: () => S().comp.fps, set: (v) => { setC('fps')(v); clock.fps = v; }, min: 1, max: 120 })),
      opts.duration ? Field('Duration (s)', NumInput({ get: () => S().comp.duration, set: setC('duration'), min: 0.1, max: 600, step: 0.5 })) : Field('Background', ColorField(() => S().comp.bg, (v, f) => store.set((s) => { s.comp.bg = v; }, f), () => store.begin())),
    ),
    opts.duration ? Field('Background', ColorField(() => S().comp.bg, (v, f) => store.set((s) => { s.comp.bg = v; }, f), () => store.begin())) : null,
    Btn('Get from active AE comp', () => syncCompFromAE(), { icon: 'sync', size: 'sm', variant: 'soft' }),
  ], { color: opts.color ?? 'var(--info)' });
}

export function ViewSection(extra: Node[] = []) {
  const tv = (k: 'dots' | 'grid' | 'trail' | 'heat') => [() => S().view[k], (v: boolean) => store.silent((s) => { s.view[k] = v; })] as const;
  return Section('View', [
    Toggle('Spacing dots', ...tv('dots')),
    Toggle('Show grid & rulers', ...tv('grid')),
    Slider({ label: 'Grid size (px)', min: 10, max: 400, step: 5, get: () => S().view.gridSize, set: (v) => store.silent((s) => { s.view.gridSize = v; }) }),
    ...extra,
  ], { color: 'var(--text-3)' });
}

export function GuideSection() {
  const sv = (k: 'guideOpacity' | 'guideX' | 'guideY' | 'guideScale') => (v: number, f: boolean) => store.set((s) => { s.view[k] = v; }, f);
  const name = h('div', { class: 'hint' });
  const sec = Section('Guide image', [
    h('div', { class: 'row' },
      Btn('Choose image', async () => {
        const f = await pickFile('image/*');
        if (!f) return;
        const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); });
        store.set((s) => { s.view.guide = url; });
        name.textContent = f.name;
      }, { size: 'sm', variant: 'soft' }),
      Btn('Clear', () => { store.set((s) => { s.view.guide = null; }); name.textContent = 'No image chosen'; }, { size: 'sm' }),
    ),
    name,
    Slider({ label: 'Opacity (%)', min: 0, max: 100, get: () => S().view.guideOpacity, set: sv('guideOpacity'), begin: () => store.begin() }),
    Slider({ label: 'Scale (%)', min: 5, max: 400, get: () => S().view.guideScale, set: sv('guideScale'), begin: () => store.begin() }),
    h('div', { class: 'row' },
      Field('X', NumInput({ get: () => S().view.guideX, set: (v) => sv('guideX')(v, true) })),
      Field('Y', NumInput({ get: () => S().view.guideY, set: (v) => sv('guideY')(v, true) })),
    ),
  ], { collapsed: true, color: 'var(--violet)' });
  name.textContent = S().view.guide ? 'Image loaded' : 'No image chosen';
  return sec;
}
