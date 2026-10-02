import { h } from '../ui/kit';
import type { Studio } from '../main';

export class StyleStudio implements Studio {
  id = 'style';
  el = h('div', { class: 'view' }, h('div', { class: 'page-main' }, 'Coming soon'));
  activate() {}
  deactivate() {}
}
