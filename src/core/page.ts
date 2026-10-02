// Shared layout for the tool-style sections (Camera, Animate, Type, Sound, Style, Brand…).
import { h } from '../ui/kit';

export function Page(o: { title: string; sub?: string; side?: Node[]; main: Node[]; right?: Node[]; extra?: Node }) {
  const head = h('div', { class: 'page-head' },
    h('div', { class: 'grow' }, h('div', { class: 'page-title' }, o.title), o.sub ? h('div', { class: 'page-sub' }, o.sub) : null),
    o.extra ?? null);
  const main = h('div', { class: 'page-main' }, head, ...o.main);
  const el = h('div', { class: 'view' },
    o.side ? h('div', { class: 'side' }, ...o.side) : null,
    main,
    o.right ? h('div', { class: 'side right' }, ...o.right) : null);
  return { el, main };
}

/** Grid of selectable preset tiles. */
export function Tiles<T extends { id: string; label: string; sub?: string }>(items: T[], opts: { onPick: (t: T) => void; isOn?: (t: T) => boolean; preview?: (t: T) => Node | null; min?: number }) {
  const grid = h('div', { class: 'tiles', style: { gridTemplateColumns: `repeat(auto-fill, minmax(${opts.min ?? 138}px, 1fr))` } });
  const els = items.map((t) => {
    const el = h('div', { class: 'tile', title: t.sub ?? t.label },
      opts.preview ? h('div', { class: 'tile-prev' }, opts.preview(t)) : null,
      h('div', { class: 'tile-label' }, t.label),
      t.sub ? h('div', { class: 'tile-sub' }, t.sub) : null);
    el.addEventListener('click', () => opts.onPick(t));
    grid.appendChild(el);
    return el;
  });
  const refresh = () => els.forEach((e, i) => e.classList.toggle('on', !!opts.isOn?.(items[i])));
  refresh();
  return { el: grid, refresh };
}

export function Group(title: string, children: Node[]) {
  return h('div', { class: 'stack', style: { gap: '10px' } }, h('div', { class: 'group-title' }, title), ...children);
}
