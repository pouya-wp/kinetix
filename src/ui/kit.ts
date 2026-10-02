// Tiny DOM component kit. Controls read their value through a getter and are
// refreshed after every store change via `refreshAll()`, so the UI never drifts
// from state without needing a framework.

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, any>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K];
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement;
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') (el as any)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function svg(markup: string): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGElement;
}

// ───────── refresh registry ─────────
const refreshers = new Set<() => void>();
export function onRefresh(el: HTMLElement, fn: () => void) {
  const wrapped = () => {
    if (!el.isConnected) return;
    fn();
  };
  refreshers.add(wrapped);
  (el as any).__dispose = () => refreshers.delete(wrapped);
  fn();
}
export function refreshAll() {
  for (const fn of refreshers) fn();
}
export function dispose(root: Element) {
  root.querySelectorAll('*').forEach((n) => (n as any).__dispose?.());
  (root as any).__dispose?.();
}
export function clear(root: HTMLElement) {
  dispose(root);
  root.innerHTML = '';
}

// ───────── icons ─────────
export const I = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4.5" height="16" rx="1.2"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  bounce: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 20c2-12 6-12 8 0c1.5-7 4.5-7 6 0c1-3.5 3-3.5 4 0"/><circle cx="20" cy="5" r="2.2" fill="currentColor"/></svg>',
  shapes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8.5" cy="9" r="5.5"/><rect x="11" y="11" width="10" height="10" rx="3"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6V4h12v2M10 4v15M7 19h6"/><path d="M15 13h6M18 13v7" /></svg>',
  render: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>',
  ball: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/></svg>',
  cursor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 3l14 7-6 2-2 6z"/></svg>',
  rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>',
  rrect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="5"/></svg>',
  ellipse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="8" ry="6.5"/></svg>',
  polygon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/><circle cx="11" cy="11" r="2"/></svg>',
  draw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 17c3-6 5 2 8-3s5-7 10-4"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l10 10-10 10L2 12z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M4 3v5h5M20 21v-5h-5"/></svg>',
  wand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/></svg>',
  fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  merge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/></svg>',
  dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2" y="7" width="14" height="11" rx="2.5"/><path d="M16 11l6-3.5v10L16 14"/><circle cx="6" cy="4" r="1.6"/><circle cx="11" cy="4" r="1.6"/></svg>',
  animate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 20C9 20 8 4 21 4"/><circle cx="3" cy="20" r="1.6" fill="currentColor"/><circle cx="21" cy="4" r="1.6" fill="currentColor"/></svg>',
  type: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19l5-14h1l5 14M6.5 13h7"/><path d="M17 8l2-2 2 2M19 6v12"/></svg>',
  physics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="7" r="3.2"/><rect x="12.5" y="12.5" width="7" height="7" rx="1.5" transform="rotate(15 16 16)"/><path d="M3 21h18" stroke-linecap="round"/><path d="M9.5 9.5l3 3" stroke-dasharray="2 2"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h2M7 7v10M11 4v16M15 8v8M19 10v4M21 12h0"/></svg>',
  style: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.6-.9 1.2-1.8-.5-1.1.3-2.2 1.5-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.3" fill="currentColor"/><circle cx="10.5" cy="7" r="1.3" fill="currentColor"/><circle cx="15" cy="7.5" r="1.3" fill="currentColor"/></svg>',
  brand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2l2.6 5.6L20 9l-4 4 1 6-5-2.8L7 19l1-6-4-4 5.4-1.4z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.6 4.5c2.1 0 3.6 1.2 5.4 3.2 1.8-2 3.3-3.2 5.4-3.2 3.6 0 5.7 3.8 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>',

};

export const icon = (name: keyof typeof I) => svg(I[name]);

// ───────── components ─────────
export function Section(title: string, children: Child[], opts: { color?: string; collapsed?: boolean; extra?: Node } = {}) {
  const sec = h('div', { class: 'section' + (opts.collapsed ? ' collapsed' : '') });
  const head = h('div', { class: 'section-head' },
    h('span', { class: 'dot', style: opts.color ? { background: opts.color } : undefined }),
    title,
    opts.extra ? h('span', { class: 'head-extra', onclick: (e: Event) => e.stopPropagation() }, opts.extra) : null,
    svg(I.chev) as any,
  );
  (head.lastChild as Element).classList.add('chev');
  head.addEventListener('click', () => sec.classList.toggle('collapsed'));
  sec.append(head, h('div', { class: 'section-body' }, ...children));
  return sec;
}

export function Field(label: string, control: Node) {
  return h('div', { class: 'field' }, h('label', null, label), control);
}

export interface SliderOpts {
  label: string;
  get: () => number;
  set: (v: number, final: boolean) => void;
  begin?: () => void;
  min: number;
  max: number;
  step?: number;
  /** allowed typed range beyond slider range */
  hardMin?: number;
  hardMax?: number;
  unit?: string;
  decimals?: number;
  title?: string;
}

/** Labelled lime slider with an editable value. Dragging the label scrubs like AE. */
export function Slider(o: SliderOpts) {
  const step = o.step ?? 1;
  const dec = o.decimals ?? (step < 1 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0);
  const fill = h('div', { class: 'slider-fill' });
  const thumb = h('div', { class: 'slider-thumb' });
  const track = h('div', { class: 'slider-track' }, fill, thumb);
  const val = h('input', { class: 'slider-val', spellcheck: false });
  const lbl = h('label', { title: o.title ?? '' }, o.label);
  const root = h('div', { class: 'slider' }, h('div', { class: 'slider-top' }, lbl, val), track);
  const hmin = o.hardMin ?? o.min, hmax = o.hardMax ?? o.max;
  const clampHard = (v: number) => Math.min(hmax, Math.max(hmin, v));
  const quant = (v: number) => Math.round(v / step) * step;
  const fmt = (v: number) => v.toFixed(dec) + (o.unit ? o.unit : '');

  const show = () => {
    const v = o.get();
    const p = Math.min(1, Math.max(0, (v - o.min) / (o.max - o.min)));
    fill.style.width = p * 100 + '%';
    thumb.style.left = p * 100 + '%';
    if (document.activeElement !== val) val.value = fmt(v);
  };

  const fromX = (clientX: number) => {
    const r = track.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return quant(o.min + p * (o.max - o.min));
  };
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId);
    root.classList.add('dragging');
    o.begin?.();
    o.set(fromX(e.clientX), false); show();
    const move = (ev: PointerEvent) => { o.set(fromX(ev.clientX), false); show(); };
    const up = (ev: PointerEvent) => {
      root.classList.remove('dragging');
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      o.set(fromX(ev.clientX), true);
      refreshAll();
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
  });
  // label scrub
  lbl.addEventListener('pointerdown', (e) => {
    lbl.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = o.get();
    const range = o.max - o.min;
    o.begin?.();
    const move = (ev: PointerEvent) => {
      const k = ev.shiftKey ? 0.1 : ev.ctrlKey ? 4 : 1;
      o.set(clampHard(quant(v0 + ((ev.clientX - x0) / 240) * range * k)), false);
      show();
    };
    const up = () => {
      lbl.removeEventListener('pointermove', move);
      lbl.removeEventListener('pointerup', up);
      o.set(o.get(), true);
      refreshAll();
    };
    lbl.addEventListener('pointermove', move);
    lbl.addEventListener('pointerup', up);
  });
  const commitText = () => {
    const n = parseFloat(val.value);
    if (!isNaN(n)) { o.begin?.(); o.set(clampHard(n), true); refreshAll(); }
    val.value = fmt(o.get());
  };
  val.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { commitText(); val.blur(); }
    if (e.key === 'Escape') { val.value = fmt(o.get()); val.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      o.begin?.();
      o.set(clampHard(quant(o.get() + d)), true);
      refreshAll();
      val.value = fmt(o.get());
    }
  });
  val.addEventListener('focus', () => { val.value = String(+o.get().toFixed(dec)); val.select(); });
  val.addEventListener('blur', commitText);
  onRefresh(root, show);
  return root;
}

export function NumInput(o: { get: () => number; set: (v: number) => void; min?: number; max?: number; step?: number; int?: boolean }) {
  const el = h('input', { class: 'input', type: 'text', spellcheck: false });
  const commit = () => {
    let n = parseFloat(el.value);
    if (isNaN(n)) { el.value = String(o.get()); return; }
    if (o.int) n = Math.round(n);
    if (o.min != null) n = Math.max(o.min, n);
    if (o.max != null) n = Math.min(o.max, n);
    o.set(n);
    el.value = String(o.get());
  };
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') el.blur();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      el.value = String((parseFloat(el.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (o.step ?? 1) * (e.shiftKey ? 10 : 1));
      commit();
    }
  });
  el.addEventListener('blur', commit);
  onRefresh(el, () => { if (document.activeElement !== el) el.value = String(o.get()); });
  return el;
}

export function TextInput(o: { get: () => string; set: (v: string) => void; placeholder?: string; area?: boolean }) {
  const el = h(o.area ? 'textarea' : 'input', { class: 'input', placeholder: o.placeholder ?? '', spellcheck: false }) as HTMLInputElement;
  el.addEventListener('keydown', (e) => { e.stopPropagation(); if (!o.area && e.key === 'Enter') el.blur(); });
  el.addEventListener('change', () => o.set(el.value));
  onRefresh(el, () => { if (document.activeElement !== el) el.value = o.get(); });
  return el;
}

export function Toggle(label: string, get: () => boolean, set: (v: boolean) => void) {
  const el = h('div', { class: 'toggle' }, h('span', null, label), h('span', { class: 'sw' }));
  el.addEventListener('click', () => { set(!get()); refreshAll(); });
  onRefresh(el, () => el.classList.toggle('on', get()));
  return el;
}

export function Seg<T extends string>(options: { value: T; label: string; title?: string }[], get: () => T, set: (v: T) => void) {
  const el = h('div', { class: 'seg' });
  const btns = options.map((o) => {
    const b = h('button', { title: o.title ?? '' }, o.label);
    b.addEventListener('click', () => { set(o.value); refreshAll(); });
    el.appendChild(b);
    return b;
  });
  onRefresh(el, () => btns.forEach((b, i) => b.classList.toggle('on', options[i].value === get())));
  return el;
}

export function Chips<T extends string>(options: { value: T; label: string }[], get: () => T | T[], set: (v: T) => void) {
  const el = h('div', { class: 'chips' });
  const btns = options.map((o) => {
    const b = h('button', { class: 'chip' }, o.label);
    b.addEventListener('click', () => { set(o.value); refreshAll(); });
    el.appendChild(b);
    return b;
  });
  onRefresh(el, () => {
    const g = get();
    btns.forEach((b, i) => b.classList.toggle('on', Array.isArray(g) ? g.includes(options[i].value) : g === options[i].value));
  });
  return el;
}

export function Select<T extends string>(options: { value: T; label: string }[], get: () => T, set: (v: T) => void) {
  const el = h('select', { class: 'input' }, ...options.map((o) => h('option', { value: o.value }, o.label)));
  el.addEventListener('change', () => { set(el.value as T); refreshAll(); });
  onRefresh(el, () => { el.value = get(); });
  return el;
}

export const PALETTE = ['#d1fe17', '#ffffff', '#4cc9f0', '#b388ff', '#ff5a5f', '#ffb238', '#2ee59d', '#ff7ac6', '#1c1e20'];
/** Brand Kit colours lead the swatch palette everywhere. */
export function setPalette(colors: string[]) {
  const base = ['#d1fe17', '#ffffff', '#4cc9f0', '#b388ff', '#ff5a5f', '#ffb238', '#2ee59d', '#ff7ac6', '#1c1e20'];
  const merged = [...colors, ...base.filter((c) => !colors.includes(c))].slice(0, 9);
  PALETTE.splice(0, PALETTE.length, ...merged);
}

export function ColorField(get: () => string, set: (v: string, final: boolean) => void, begin?: () => void) {
  const pick = h('input', { type: 'color' });
  const txt = h('input', { type: 'text', spellcheck: false });
  pick.addEventListener('pointerdown', () => begin?.());
  pick.addEventListener('input', () => set(pick.value, false));
  pick.addEventListener('change', () => set(pick.value, true));
  txt.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') txt.blur(); });
  txt.addEventListener('change', () => {
    const v = txt.value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(v)) { begin?.(); set(v.startsWith('#') ? v : '#' + v, true); }
  });
  const el = h('div', { class: 'color' }, pick, txt);
  onRefresh(el, () => {
    pick.value = get();
    if (document.activeElement !== txt) txt.value = get();
  });
  return el;
}

export function Swatches(set: (v: string) => void) {
  return h('div', { class: 'swatches' }, ...PALETTE.map((c) => h('button', { style: { background: c }, title: c, onclick: () => set(c) })));
}

export function Btn(label: string | Node, onClick: (e: MouseEvent) => void, opts: { variant?: 'primary' | 'soft' | 'outline' | 'danger' | 'ghost'; size?: 'sm' | 'lg'; block?: boolean; icon?: keyof typeof I; title?: string } = {}) {
  const cls = ['btn'];
  if (opts.variant && opts.variant !== 'ghost') cls.push('btn-' + opts.variant);
  if (opts.size) cls.push('btn-' + opts.size);
  if (opts.block) cls.push('btn-block');
  if (opts.icon && label === '') cls.push('btn-icon');
  const b = h('button', { class: cls.join(' '), title: opts.title ?? '' }, opts.icon ? icon(opts.icon) : null, label);
  b.addEventListener('click', onClick);
  return b;
}

// ───────── toasts / modal ─────────
let toastRoot: HTMLElement | null = null;
export function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'ok', ms = 3200) {
  if (!toastRoot) { toastRoot = h('div', { class: 'toasts' }); document.body.appendChild(toastRoot); }
  const t = h('div', { class: 'toast ' + kind }, h('i'), h('div', null, msg));
  toastRoot.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, ms);
}

export function modal(build: (close: () => void) => Node) {
  const bg = h('div', { class: 'modal-bg' });
  const close = () => bg.remove();
  bg.addEventListener('pointerdown', (e) => { if (e.target === bg) close(); });
  bg.appendChild(h('div', { class: 'modal' }, build(close)));
  document.body.appendChild(bg);
  return close;
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { res(inp.files?.[0] ?? null); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

export function downloadText(name: string, text: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
