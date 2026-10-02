import { h } from '../ui/kit';
import type { Studio } from '../main';

export class ShapesStudio implements Studio {
  id = 'shapes';
  el = h('div', { class: 'view' }, h('div', { class: 'stage' }, 'Coming soon'));
  activate() {}
  deactivate() {}
}
