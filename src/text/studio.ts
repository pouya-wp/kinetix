import { h } from '../ui/kit';
import type { Studio } from '../main';

export class TextStudio implements Studio {
  id = 'text';
  el = h('div', { class: 'view' }, h('div', { class: 'stage' }, 'Coming soon'));
  activate() {}
  deactivate() {}
}
