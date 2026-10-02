import { h } from '../ui/kit';
import type { Studio } from '../main';

export class RenderStudio implements Studio {
  id = 'render';
  el = h('div', { class: 'view' }, h('div', { class: 'stage' }, 'Coming soon'));
  activate() {}
  deactivate() {}
}
