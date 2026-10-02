import '@fontsource-variable/inter';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './styles/app.css';
import { h, svg, I, toast } from './ui/kit';
import { store, loadPersisted } from './core/state';
import { clock } from './core/clock';
import { inAE } from './core/ae-bridge';
import { syncCompFromAE } from './core/common-ui';
import './core/mocks';
import { BounceStudio } from './bounce/studio';
import { ShapesStudio } from './shapes/studio';
import { TextStudio } from './text/studio';
import { RenderStudio } from './render/studio';

export interface Studio {
  id: string;
  el: HTMLElement;
  activate(): void;
  deactivate(): void;
  onKey?(e: KeyboardEvent): boolean;
}

const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 4v16"/><path d="M18 4l-8 8 8 8"/><circle cx="18" cy="12" r="1.6" fill="#1a1a1a" stroke="none"/></svg>`;

function boot() {
  loadPersisted();
  clock.fps = store.state.comp.fps;

  const studios: Studio[] = [new BounceStudio(), new ShapesStudio(), new TextStudio(), new RenderStudio()];
  const tabsDef: { id: string; label: string; icon: keyof typeof I; badge?: string }[] = [
    { id: 'bounce', label: 'Bounce', icon: 'bounce' },
    { id: 'shapes', label: 'Shape Morph', icon: 'shapes' },
    { id: 'text', label: 'Text Morph', icon: 'text', badge: 'New' },
    { id: 'render', label: 'Render', icon: 'render' },
  ];
  const tabs = h('nav', { class: 'tabs' });
  const main = h('div', { style: { minHeight: '0', position: 'relative' } });
  studios.forEach((s) => main.appendChild(s.el));

  let active: Studio = studios[0];
  const tabBtns = tabsDef.map((t) => {
    const b = h('button', { class: 'tab', title: t.label }, svg(I[t.icon]), h('span', { class: 'lbl-text' }, t.label), t.badge ? h('span', { class: 'new' }, t.badge) : null);
    b.addEventListener('click', () => select(t.id));
    tabs.appendChild(b);
    return b;
  });
  const select = (id: string) => {
    const next = studios.find((s) => s.id === id) ?? studios[0];
    if (active && active !== next) active.deactivate();
    active = next;
    studios.forEach((s) => s.el.classList.toggle('active', s === next));
    tabBtns.forEach((b, i) => b.classList.toggle('active', tabsDef[i].id === id));
    clock.pause();
    next.activate();
    try { localStorage.setItem('kinetix.tab', id); } catch { /* */ }
  };

  const inspectorBtn = h('button', { class: 'btn btn-sm inspector-toggle', title: 'Show / hide the inspector (Tab)' }, svg(I.wand), 'Inspector');
  const status = h('div', { class: 'status' + (inAE ? ' on' : ''), title: inAE ? 'Connected to After Effects' : 'Running in browser preview (mock AE)' }, h('i'), h('span', null, inAE ? 'After Effects' : 'Preview mode'));
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('div', { class: 'logo-mark', html: LOGO }), h('span', { class: 'brand-name' }, 'KINETIX'), h('span', { class: 'brand-ver' }, 'PRO')),
    tabs,
    h('div', { class: 'top-actions' }, inspectorBtn, status),
  );
  const app = h('div', { class: 'app' }, topbar, main);
  inspectorBtn.addEventListener('click', () => { app.classList.toggle('show-inspector'); inspectorBtn.classList.toggle('on', app.classList.contains('show-inspector')); });
  document.body.appendChild(app);
  let initial = 'bounce';
  try { initial = localStorage.getItem('kinetix.tab') || 'bounce'; } catch { /* */ }
  select(initial);

  // keyboard
  window.addEventListener('keydown', (e) => {
    const tgt = e.target as HTMLElement;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
    const k = e.key;
    if (e.ctrlKey || e.metaKey) {
      if (k.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); return; }
      if ((k.toLowerCase() === 'z' && e.shiftKey) || k.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
    }
    if (active.onKey?.(e)) { e.preventDefault(); return; }
    if (k === ' ') { e.preventDefault(); clock.toggle(); return; }
    if (k === 'ArrowRight') { e.preventDefault(); clock.step(1); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); clock.step(-1); return; }
    if (k === 'Tab' && !e.ctrlKey) { e.preventDefault(); inspectorBtn.click(); return; }
    if (k === 'Home') { clock.pause(); clock.seek(0); return; }
    if (k === 'End') { clock.pause(); clock.seek(clock.duration); return; }
  });

  if (inAE) syncCompFromAE(true).then((ok) => ok && toast('Synced with the active AE composition', 'info'));
}

boot();
