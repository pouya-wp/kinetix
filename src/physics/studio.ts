import { h } from '../ui/kit';
import type { Studio } from '../main';

export class PhysicsStudio implements Studio {
  id = 'physics';
  el = h('div', { class: 'view' }, h('div', { class: 'page-main' }, 'Coming soon'));
  activate() {}
  deactivate() {}
}
