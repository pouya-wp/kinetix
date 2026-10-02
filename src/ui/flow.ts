// Simple, consistent page pattern used by every tool section:
//   title + one line  →  numbered steps (pick → adjust)  →  "More options" (closed)
//   and a sticky action bar that always says what will happen in After Effects.
import { h, svg, I, Btn, toast } from './kit';
import { call, inAE } from '../core/ae-bridge';

export interface Sel { comp: string | null; layers: number; text: number; shape: number; keys: number; camera: boolean }
const EMPTY: Sel = { comp: null, layers: 0, text: 0, shape: 0, keys: 0, camera: false };
let sel: Sel = inAE ? EMPTY : { comp: 'Preview Comp', layers: 2, text: 1, shape: 1, keys: 4, camera: false };
const subs = new Set<(s: Sel) => void>();
let hover = false, timer = 0, busy = false;

export async function refreshSel() {
  if (!inAE || busy) { subs.forEach((f) => f(sel)); return sel; }
  busy = true;
  try { sel = (await call<Sel>('selInfo')) ?? EMPTY; } catch { sel = EMPTY; }
  busy = false;
  subs.forEach((f) => f(sel));
  return sel;
}
export const currentSel = () => sel;

/** Poll AE only while the pointer is over the panel (a script call would stop a RAM preview). */
function startPolling() {
  if (timer) return;
  document.addEventListener('mouseenter', () => { hover = true; refreshSel(); });
  document.addEventListener('mouseleave', () => { hover = false; });
  window.addEventListener('focus', () => refreshSel());
  timer = window.setInterval(() => { if (hover && !document.hidden) refreshSel(); }, 1500);
}

export type Need = 'layers' | 'text' | 'keys' | 'comp' | 'none';
function status(s: Sel, need: Need): { ok: boolean; msg: string } {
  if (need === 'none') return { ok: true, msg: s.comp ? `Comp: ${s.comp}` : 'Ready' };
  if (!s.comp) return { ok: false, msg: 'Open a composition in After Effects' };
  if (need === 'comp') return { ok: true, msg: `Comp: ${s.comp}` };
  if (need === 'keys') return s.keys >= 2 ? { ok: true, msg: `${s.keys} keyframes selected` } : { ok: false, msg: 'Select 2+ keyframes in the timeline' };
  if (need === 'text') return s.text ? { ok: true, msg: `${s.text} text layer${s.text > 1 ? 's' : ''} selected` } : { ok: false, msg: 'Select text layers in After Effects' };
  return s.layers ? { ok: true, msg: `${s.layers} layer${s.layers > 1 ? 's' : ''} selected` } : { ok: false, msg: 'Select layers in After Effects' };
}

/** Live "what will this affect" chip. */
export function SelChip(need: Need | (() => Need)) {
  startPolling();
  const el = h('div', { class: 'selchip' }, h('i'), h('span'));
  const upd = (s: Sel) => {
    const st = status(s, typeof need === 'function' ? need() : need);
    el.classList.toggle('ok', st.ok);
    (el.lastChild as HTMLElement).textContent = st.msg;
  };
  subs.add(upd);
  upd(sel);
  return el;
}

export interface Action { label: string; run: () => unknown; icon?: keyof typeof I; need?: Need | (() => Need); secondary?: Node[] }

/** Sticky bottom bar: selection status + one big button. */
export function ActionBar(a: Action) {
  const btn = Btn(a.label, async () => {
    const st = status(await refreshSel(), typeof a.need === 'function' ? a.need() : a.need ?? 'none');
    if (!st.ok && inAE) { toast(st.msg, 'info'); return; }
    btn.classList.add('busy');
    try { await a.run(); } finally { btn.classList.remove('busy'); refreshSel(); }
  }, { variant: 'primary', size: 'lg', icon: a.icon });
  btn.classList.add('action-main');
  return h('div', { class: 'actionbar' }, SelChip(a.need ?? 'none'), h('div', { class: 'grow' }), ...(a.secondary ?? []), btn);
}

/** Numbered step card. */
export function Step(n: number | null, title: string, body: Node[], hint?: string) {
  return h('div', { class: 'step' },
    h('div', { class: 'step-head' }, n !== null ? h('span', { class: 'step-n' }, String(n)) : null, h('span', { class: 'step-title' }, title), hint ? h('span', { class: 'step-hint' }, hint) : null),
    h('div', { class: 'step-body' }, ...body));
}

/** Collapsed-by-default advanced options; remembers if the user opened it. */
export function More(key: string, body: Node[], title = 'More options') {
  const LS = 'kinetix.more.' + key;
  let open = false;
  try { open = localStorage.getItem(LS) === '1'; } catch { /* storage blocked */ }
  const el = h('div', { class: 'more' + (open ? ' open' : '') });
  const head = h('button', { class: 'more-head' }, svg(I.chev) as any, h('span', null, title));
  head.addEventListener('click', () => { el.classList.toggle('open'); try { localStorage.setItem(LS, el.classList.contains('open') ? '1' : '0'); } catch { /* */ } });
  el.append(head, h('div', { class: 'more-body' }, ...body));
  return el;
}

/** Single-column page with an optional sticky action bar. */
export function Flow(o: { title: string; sub: string; body: Node[]; action?: Action; tabs?: Node }) {
  const scroll = h('div', { class: 'flow-scroll' },
    h('div', { class: 'flow' },
      h('div', { class: 'flow-head' }, h('div', { class: 'page-title' }, o.title), h('div', { class: 'page-sub' }, o.sub)),
      o.tabs ?? null,
      ...o.body));
  const el = h('div', { class: 'view flow-view' }, scroll, o.action ? ActionBar(o.action) : null);
  return { el, scroll };
}

/** Big segmented tabs for a section's modes. */
export function Tabs<T extends string>(items: { id: T; label: string }[], get: () => T, set: (v: T) => void) {
  const el = h('div', { class: 'flow-tabs' });
  const draw = () => {
    el.replaceChildren(...items.map((it) => {
      const b = h('button', { class: 'flow-tab' + (get() === it.id ? ' on' : '') }, it.label);
      b.addEventListener('click', () => { set(it.id); draw(); });
      return b;
    }));
  };
  draw();
  return el;
}

/** Big pickable tiles; `multi` lets several be on at once. Returns a refresh function. */
export function Picks<T extends { id: string; label: string; sub?: string }>(items: T[], o: { isOn: (t: T) => boolean; onPick: (t: T) => void; preview?: (t: T) => Node | null; extra?: (t: T) => Node | null; min?: number }) {
  const el = h('div', { class: 'big-tiles' });
  if (o.min) el.style.setProperty('--min', o.min + 'px');
  const tiles = items.map((t) => {
    const tile = h('div', { class: 'pick', title: t.sub ?? '' },
      h('span', { class: 'pick-check' }, '✓'),
      o.preview ? o.preview(t) : null,
      h('div', { class: 'pick-label' }, t.label),
      t.sub ? h('div', { class: 'pick-sub' }, t.sub) : null,
      o.extra ? o.extra(t) : null);
    tile.addEventListener('click', () => { o.onPick(t); refresh(); });
    el.appendChild(tile);
    return tile;
  });
  const refresh = () => tiles.forEach((x, i) => x.classList.toggle('on', o.isOn(items[i])));
  refresh();
  return { el, refresh };
}
