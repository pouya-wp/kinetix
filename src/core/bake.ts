// Bake Kinetix motion expressions (In/Out, loops, wiggles, shakes) into keyframes.
import { call } from './ae-bridge';
import { toast } from '../ui/kit';
import { registerCommands } from './commands';

export async function bakeSelected(all = false) {
  try {
    const r = await call<{ props: number; keys: number; skipped: number }>('bakeKX', { all });
    if (!r.props) toast('Nothing to bake — no Kinetix motion expressions on ' + (all ? 'this comp' : 'the selected layers'), 'info');
    else toast(`Baked ${r.props} propert${r.props === 1 ? 'y' : 'ies'} into ${r.keys} keyframes` + (r.skipped ? ` · ${r.skipped} per-letter selector(s) stay live` : ''));
  } catch (e: any) { toast(e.message, 'err'); }
}

registerCommands([
  { id: 'bake.sel', label: 'Bake Kinetix expressions → keyframes (selected layers)', group: 'Tools', run: () => bakeSelected() },
  { id: 'bake.all', label: 'Bake Kinetix expressions → keyframes (whole comp)', group: 'Tools', run: () => bakeSelected(true) },
]);
