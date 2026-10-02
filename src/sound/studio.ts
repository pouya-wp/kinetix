import { h } from '../ui/kit';
import type { Studio } from '../main';

export class SoundStudio implements Studio {
  id = 'sound';
  el = h('div', { class: 'view' }, h('div', { class: 'page-main' }, 'Coming soon'));
  activate() {}
  deactivate() {}
}
