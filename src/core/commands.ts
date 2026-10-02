// Global command registry + Ctrl+K palette. Any section can register commands.

import { h, svg, I } from '../ui/kit';

export interface Command { id: string; label: string; group: string; keywords?: string; run: () => void | Promise<void> }

const commands = new Map<string, Command>();
export function registerCommand(c: Command) { commands.set(c.id, c); }
export function registerCommands(list: Command[]) { list.forEach(registerCommand); }

const RECENT = 'kinetix.recentCommands';
function recent(): string[] { try { return JSON.parse(localStorage.getItem(RECENT) || '[]'); } catch { return []; } }
function pushRecent(id: string) { try { localStorage.setItem(RECENT, JSON.stringify([id, ...recent().filter((x) => x !== id)].slice(0, 8))); } catch { /* */ } }

function score(c: Command, q: string) {
  if (!q) return 1;
  const hay = (c.label + ' ' + c.group + ' ' + (c.keywords ?? '')).toLowerCase();
  let s = 0, pos = 0;
  for (const word of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const i = hay.indexOf(word);
    if (i < 0) return 0;
    s += 10 - Math.min(9, i / 4);
    pos = i;
  }
  return s + (c.label.toLowerCase().startsWith(q.toLowerCase()) ? 20 : 0) - pos * 0.01;
}

let openEl: HTMLElement | null = null;
export function openPalette() {
  if (openEl) { closePalette(); return; }
  const input = h('input', { class: 'input', placeholder: 'Type a command, preset or section…', spellcheck: false, style: { height: '44px', fontSize: '15px', fontFamily: 'var(--font-ui)' } });
  const list = h('div', { class: 'list', style: { maxHeight: '50vh', overflow: 'auto', marginTop: '8px' } });
  let items: Command[] = [];
  let sel = 0;
  const render = () => {
    const q = input.value.trim();
    const rec = recent();
    items = [...commands.values()]
      .map((c) => ({ c, s: score(c, q) + (q ? 0 : rec.includes(c.id) ? 50 - rec.indexOf(c.id) : 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.c);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = '';
    items.forEach((c, i) => {
      const row = h('div', { class: 'item' + (i === sel ? ' sel' : '') }, h('span', { class: 'name' }, c.label), h('span', { class: 'meta' }, c.group));
      row.addEventListener('mousemove', () => { if (sel !== i) { sel = i; render(); } });
      row.addEventListener('click', () => exec(c));
      list.appendChild(row);
    });
    if (!items.length) list.appendChild(h('div', { class: 'empty' }, 'Nothing found'));
    (list.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  };
  const exec = (c: Command) => { closePalette(); pushRecent(c.id); void c.run(); };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closePalette();
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    if (e.key === 'Enter' && items[sel]) exec(items[sel]);
  });
  const box = h('div', { class: 'modal', style: { width: 'min(620px, calc(100vw - 24px))', padding: '14px' } },
    h('div', { class: 'hstack', style: { marginBottom: '2px' } }, svg(I.search), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Command palette · ↑↓ Enter · Esc')),
    input, list);
  const bg = h('div', { class: 'modal-bg', style: { alignItems: 'start', paddingTop: '10vh' } }, box);
  bg.addEventListener('pointerdown', (e) => { if (e.target === bg) closePalette(); });
  document.body.appendChild(bg);
  openEl = bg;
  render();
  setTimeout(() => input.focus(), 0);
}
export function closePalette() { openEl?.remove(); openEl = null; }
