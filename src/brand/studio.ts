import { h } from '../ui/kit';
import type { Studio } from '../main';

export class BrandStudio implements Studio {
  id = 'brand';
  el = h('div', { class: 'view' }, h('div', { class: 'page-main' }, 'Coming soon'));
  activate() {}
  deactivate() {}
}
