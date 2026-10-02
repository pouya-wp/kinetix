import '@fontsource-variable/inter';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './styles/app.css';
import { h, svg, I, toast } from './ui/kit';
import { store, loadPersisted } from './core/state';
import { clock } from './core/clock';
import { inAE, setHostErrorHook, nodeRequire } from './core/ae-bridge';
import { log, logText, logPath, installGlobalHandlers } from './core/log';
import { syncCompFromAE } from './core/common-ui';
import { openPalette, registerCommands } from './core/commands';
import './core/mocks';
import { BounceStudio } from './bounce/studio';
import { ShapesStudio } from './shapes/studio';
import { TextStudio } from './text/studio';
import { RenderStudio } from './render/studio';
import { CameraStudio } from './camera/studio';
import { AnimateStudio } from './animate/studio';
import { TypeStudio } from './type/studio';
import { PhysicsStudio } from './physics/studio';
import { SoundStudio } from './sound/studio';
import { StyleStudio } from './style/studio';
import { BrandStudio } from './brand/studio';

export interface Studio {
  id: string;
  el: HTMLElement;
  activate(): void;
  deactivate(): void;
  onKey?(e: KeyboardEvent): boolean;
}

const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 4v16"/><path d="M18 4l-8 8 8 8"/><circle cx="18" cy="12" r="1.6" fill="#1a1a1a" stroke="none"/></svg>`;

interface SectionDef { id: string; label: string; title: string; icon: keyof typeof I; make: () => Studio; isNew?: boolean; sep?: boolean }
const SECTIONS: SectionDef[] = [
  { id: 'camera', label: 'Camera', title: '3D Camera', icon: 'camera', make: () => new CameraStudio(), isNew: true },
  { id: 'animate', label: 'Animate', title: 'Animate · Ease · In/Out', icon: 'animate', make: () => new AnimateStudio(), isNew: true },
  { id: 'type', label: 'Type', title: 'Type Animator', icon: 'type', make: () => new TypeStudio(), isNew: true },
  { id: 'physics', label: 'Physics', title: 'Physics', icon: 'physics', make: () => new PhysicsStudio(), isNew: true, sep: true },
  { id: 'bounce', label: 'Bounce', title: 'Bounce', icon: 'bounce', make: () => new BounceStudio() },
  { id: 'shapes', label: 'Shapes', title: 'Shapes & Morph', icon: 'shapes', make: () => new ShapesStudio() },
  { id: 'text', label: 'Text Morph', title: 'Text Morph', icon: 'text', make: () => new TextStudio(), sep: true },
  { id: 'style', label: 'Style', title: 'Styles & Gradients', icon: 'style', make: () => new StyleStudio(), isNew: true },
  { id: 'sound', label: 'Sound', title: 'Sound Lab', icon: 'sound', make: () => new SoundStudio(), isNew: true },
  { id: 'brand', label: 'Brand', title: 'Brand Kit', icon: 'brand', make: () => new BrandStudio(), isNew: true, sep: true },
  { id: 'render', label: 'Render', title: 'Render', icon: 'render', make: () => new RenderStudio() },
];

function boot() {
  installGlobalHandlers();
  setHostErrorHook((name, msg) => log('error', `host ${name}: ${msg}`));
  registerCommands([
    { id: 'diag.copy', label: 'Copy diagnostics log', group: 'Tools', run: () => { navigator.clipboard?.writeText(logText()).then(() => toast('Log copied'), () => toast('Clipboard blocked', 'err')); } },
    { id: 'diag.open', label: 'Show log file', group: 'Tools', run: () => {
      const f = logPath();
      if (!f) { toast('Log file is only written inside After Effects', 'info'); return; }
      try { const win = navigator.platform.startsWith("Win"); nodeRequire()!("child_process").exec(win ? `explorer /select,"${f}"` : `open -R "${f}"`); } catch { toast(f, 'info', 8000); }
    } },
  ]);
  loadPersisted();
  clock.fps = store.state.comp.fps;

  const rail = h('nav', { class: 'rail' });
  const area = h('div', { class: 'main-area' });
  const title = h('div', { class: 'section-title' });
  const built = new Map<string, Studio>();
  let active: Studio | null = null;

  const btns = SECTIONS.map((d) => {
    const b = h('button', { class: 'rail-btn', title: d.title }, svg(I[d.icon]), d.label, d.isNew ? h('span', { class: 'new' }) : null);
    b.addEventListener('click', () => select(d.id));
    rail.appendChild(b);
    if (d.sep) rail.appendChild(h('div', { class: 'rail-sep' }));
    return b;
  });

  const select = (id: string) => {
    const def = SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
    let next = built.get(def.id);
    if (!next) {
      // sections are built the first time they are opened — keeps the panel light
      next = def.make();
      built.set(def.id, next);
      area.appendChild(next.el);
    }
    if (active && active !== next) active.deactivate();
    active = next;
    for (const s of built.values()) s.el.classList.toggle('active', s === next);
    btns.forEach((b, i) => b.classList.toggle('active', SECTIONS[i].id === def.id));
    title.textContent = def.title;
    clock.pause();
    next.activate();
    try { localStorage.setItem('kinetix.tab', def.id); } catch { /* */ }
  };

  registerCommands(SECTIONS.map((s) => ({ id: 'go.' + s.id, label: 'Open ' + s.title, group: 'Sections', run: () => select(s.id) })));

  const cmdBtn = h('button', { class: 'btn btn-sm cmd-btn', title: 'Command palette (Ctrl+K)', onclick: () => openPalette() }, svg(I.search), h('span', null, 'Search commands…'), h('kbd', null, 'Ctrl K'));
  const inspectorBtn = h('button', { class: 'btn btn-sm inspector-toggle', title: 'Show / hide the inspector (Tab)' }, svg(I.wand), 'Inspector');
  const status = h('div', { class: 'status' + (inAE ? ' on' : ''), title: inAE ? 'Connected to After Effects' : 'Running in browser preview (mock AE)' }, h('i'), h('span', null, inAE ? 'After Effects' : 'Preview mode'));
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('div', { class: 'logo-mark', html: LOGO }), h('span', { class: 'brand-name' }, 'KINETIX'), h('span', { class: 'brand-ver' }, 'PRO')),
    title,
    h('div', { class: 'top-actions' }, cmdBtn, inspectorBtn, status),
  );
  const app = h('div', { class: 'app' }, topbar, h('div', { class: 'body' }, rail, area));
  inspectorBtn.addEventListener('click', () => { app.classList.toggle('show-inspector'); inspectorBtn.classList.toggle('on', app.classList.contains('show-inspector')); });
  document.body.appendChild(app);
  let initial = 'camera';
  try { initial = localStorage.getItem('kinetix.tab') || 'camera'; } catch { /* */ }
  select(initial);

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    const tgt = e.target as HTMLElement;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey) {
      if (k.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); return; }
      if ((k.toLowerCase() === 'z' && e.shiftKey) || k.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
    }
    if (active?.onKey?.(e)) { e.preventDefault(); return; }
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
