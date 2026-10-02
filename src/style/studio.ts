import { h, Seg, Btn, Toggle, toast, refreshAll, clear, Chips } from '../ui/kit';
import { Group } from '../core/page';
import { Flow, More, Tabs } from '../ui/flow';
import { call, inAE, nodeRequire } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { GRADIENTS, GRADIENT_CATS, cssOf, renderPng, type Gradient } from './gradients';
import { STYLES, STYLE_GROUPS, hex, type StyleDef, type Palette } from './styles';
import { activeBrand, onBrand, updateBrand } from '../brand/brand';
import type { Studio } from '../main';

type Tab = 'styles' | 'gradients';
type GradTarget = 'fill' | 'image' | 'background';

export class StyleStudio implements Studio {
  id = 'style';
  el: HTMLElement;
  private tab: Tab = 'styles';
  private body: HTMLElement;
  private gCat = 'All';
  private gQuery = '';
  private gSel: Gradient = GRADIENTS[0];
  private gTarget: GradTarget = 'image';
  private animate = false;
  private stack = false;
  private favs = new Set<string>(JSON.parse(localStorage.getItem('kinetix.grad.favs') || '[]'));
  private lastStyle: StyleDef | null = null;

  constructor() {
    this.body = h('div', { class: 'stack', style: { gap: '20px' } });
    const tabs = Tabs<Tab>([{ id: 'styles', label: 'Looks' }, { id: 'gradients', label: `Gradients · ${GRADIENTS.length}` }], () => this.tab, (v) => { this.tab = v; this.render(); });
    const opts = More('style-opts', [
      Toggle('Keep existing Kinetix looks (stack)', () => this.stack, (v) => { this.stack = v; refreshAll(); }),
      Toggle('Animate gradient (slow spin)', () => this.animate, (v) => { this.animate = v; refreshAll(); }),
      (() => { const box = h('div', { class: 'swatches' }); const fill = () => { box.innerHTML = ''; activeBrand().colors.forEach((c) => box.appendChild(h('button', { style: { background: c, width: '26px', height: '26px' }, title: c }))); }; fill(); onBrand(fill); return box; })(),
      h('div', { class: 'hint' }, 'Looks use your Brand colours (above). Change them in the Brand section.'),
      Btn('Remove Kinetix looks from selected layers', () => this.clearStyles(), { variant: 'danger', size: 'sm' }),
    ], 'Options');
    this.el = Flow({
      title: 'Style', sub: 'Select layers in After Effects, then click a look or a gradient — it is applied instantly with normal, editable effects.',
      tabs, body: [this.body, opts],
      action: { label: 'Apply again', icon: 'send', need: 'layers', run: () => (this.tab === 'styles' ? (this.lastStyle ? this.applyStyle(this.lastStyle) : toast('Click a look first', 'info')) : this.applyGradient()) },
    }).el;
    this.render();
    registerCommands([
      ...STYLES.map((s) => ({ id: 'style.' + s.id, label: 'Style: ' + s.label, group: 'Style', keywords: s.sub, run: () => this.applyStyle(s) })),
      ...GRADIENTS.slice(0, 120).map((g) => ({ id: 'grad.' + g.id, label: 'Gradient: ' + g.name, group: 'Gradient', keywords: g.cat, run: () => { this.gSel = g; this.applyGradient(); } })),
    ]);
  }

  activate() {}
  deactivate() {}

  private render() {
    clear(this.body);
    if (this.tab === 'styles') this.stylesPage(); else this.gradientsPage();
    refreshAll();
  }

  private palette(): Palette {
    const c = activeBrand().colors.map(hex);
    return { a: c[0] ?? hex('#d1fe17'), b: c[1] ?? hex('#4cc9f0'), c: c[2] ?? hex('#b388ff'), dark: c.find((x) => x[0] + x[1] + x[2] < 0.6) ?? hex('#111111'), light: c.find((x) => x[0] + x[1] + x[2] > 2.4) ?? hex('#ffffff') };
  }

  private stylesPage() {
    for (const g of STYLE_GROUPS) {
      const grid = h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } });
      for (const s of STYLES.filter((x) => x.group === g)) {
        const t = h('div', { class: 'tile' }, h('div', { class: 'tile-prev' }, this.stylePreview(s)), h('div', { class: 'tile-label' }, s.label), h('div', { class: 'tile-sub' }, s.sub));
        t.addEventListener('click', () => { this.lastStyle = s; this.body.querySelectorAll('.tile').forEach((x) => x.classList.remove('on')); t.classList.add('on'); this.applyStyle(s); });
        grid.appendChild(t);
      }
      this.body.appendChild(Group(g, [grid]));
    }
  }

  /** CSS approximation of each style for the tile preview. */
  private stylePreview(s: StyleDef) {
    const b = activeBrand().colors;
    const el = h('div', { style: { font: '800 26px "Space Grotesk", sans-serif', letterSpacing: '.02em', color: '#f7f7f8' } }, 'Aa');
    const st = el.style;
    switch (s.id) {
      case 'neon': st.color = '#fff'; st.textShadow = `0 0 6px ${b[0]}, 0 0 18px ${b[0]}, 0 0 40px ${b[0]}`; break;
      case 'soft-bloom': st.textShadow = '0 0 30px rgba(255,255,255,.8)'; break;
      case 'cyber': st.color = b[0]; st.textShadow = `0 0 12px ${b[0]}`; break;
      case 'hologram': st.color = '#7df9ff'; st.textShadow = '0 0 14px #7df9ff'; st.opacity = '.85'; break;
      case 'chrome': st.background = 'linear-gradient(#fff, #6b7280 55%, #e5e7eb)'; break;
      case 'gold': st.background = 'linear-gradient(#f7e08a, #8e6a1f 60%, #f7e08a)'; break;
      case 'rose-gold': st.background = 'linear-gradient(#f9d3cf, #a0525c)'; break;
      case 'retro': st.background = 'linear-gradient(#ffd319, #ff2975)'; st.filter = 'drop-shadow(4px 4px 0 #8c1eff)'; break;
      case 'fire': st.background = 'linear-gradient(#fff200, #ff2a00)'; st.filter = 'drop-shadow(0 0 8px #ff6a00)'; break;
      case 'gradient-text': st.background = `linear-gradient(${b[0]}, ${b[1]})`; break;
      case 'long-shadow': st.textShadow = Array.from({ length: 10 }, (_, i) => `${i + 1}px ${i + 1}px 0 rgba(0,0,0,${0.5 - i * 0.04})`).join(','); break;
      case 'soft-shadow': st.textShadow = '0 10px 24px rgba(0,0,0,.8)'; break;
      case 'hard-shadow': st.textShadow = `5px 5px 0 ${b[0]}`; break;
      case 'outline': st.color = 'transparent'; (st as any).webkitTextStroke = '1.5px #fff'; break;
      case 'double-outline': (st as any).webkitTextStroke = '2px #111'; st.textShadow = `4px 4px 0 ${b[0]}`; break;
      case 'emboss': case 'paper': st.textShadow = '0 2px 4px rgba(0,0,0,.6), 0 -1px 0 rgba(255,255,255,.3)'; break;
      case 'glass-btn': st.textShadow = '0 6px 14px rgba(0,0,0,.6), 0 -1px 0 rgba(255,255,255,.5)'; break;
      case 'glitch': st.textShadow = '2px 0 #ff00c8, -2px 0 #00f0ff'; break;
      case 'duotone': st.color = b[0]; break;
      case 'extrude': st.textShadow = Array.from({ length: 6 }, (_, i) => `0 ${i + 1}px 0 #555`).join(','); break;
    }
    if (st.background) { (st as any).webkitBackgroundClip = 'text'; st.color = 'transparent'; }
    return el;
  }

  private gradientsPage() {
    const search = h('input', { class: 'input', placeholder: 'Search gradients…', value: this.gQuery, style: { fontFamily: 'var(--font-ui)' } }) as HTMLInputElement;
    search.addEventListener('keydown', (e) => e.stopPropagation());
    const grid = h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' } });
    const draw = () => {
      clear(grid);
      const brandIds = new Set(activeBrand().gradients);
      const list = GRADIENTS.filter((g) => (this.gCat === 'All' || (this.gCat === 'Favorites' ? this.favs.has(g.id) : this.gCat === 'Brand' ? brandIds.has(g.id) : g.cat === this.gCat)) && (!this.gQuery || (g.name + ' ' + g.cat).toLowerCase().includes(this.gQuery)));
      for (const g of list) {
        const t = h('div', { class: 'tile' + (g.id === this.gSel.id ? ' on' : ''), title: `${g.name} · ${g.cat}` },
          h('div', { class: 'tile-prev', style: { background: cssOf(g), height: '58px' } }),
          h('div', { class: 'tile-label' }, g.name));
        t.addEventListener('click', () => { this.gSel = g; grid.querySelectorAll('.tile').forEach((x) => x.classList.remove('on')); t.classList.add('on'); refreshAll(); this.applyGradient(); });
        grid.appendChild(t);
      }
      if (!list.length) grid.appendChild(h('div', { class: 'empty' }, 'Nothing here yet'));
    };
    search.addEventListener('input', () => { this.gQuery = search.value.toLowerCase(); draw(); });
    draw();
    this.body.append(
      h('div', { class: 'step' },
        h('div', { class: 'row wrap' }, search, Seg<GradTarget>([{ value: 'image', label: 'Full gradient' }, { value: 'fill', label: 'Editable 2-colour' }, { value: 'background', label: 'Background' }], () => this.gTarget, (v) => { this.gTarget = v; refreshAll(); })),
        Chips(['All', 'Favorites', 'Brand', ...GRADIENT_CATS].map((c) => ({ value: c, label: c })), () => this.gCat, (v) => { this.gCat = v; draw(); refreshAll(); }),
        h('div', { class: 'hstack' }, h('div', { class: 'hint grow' }, 'Click a gradient to apply it to the selected layers.'),
          Btn('★', () => { this.favs.has(this.gSel.id) ? this.favs.delete(this.gSel.id) : this.favs.add(this.gSel.id); localStorage.setItem('kinetix.grad.favs', JSON.stringify([...this.favs])); toast('Favorites updated'); }, { size: 'sm', title: 'Favorite the last gradient' }),
          Btn('+ Brand', () => { updateBrand((b) => { if (!b.gradients.includes(this.gSel.id)) b.gradients.push(this.gSel.id); }); toast('Added to brand'); }, { size: 'sm' }))),
      grid,
    );
  }

  // ───────── AE ─────────
  private async applyStyle(s: StyleDef) {
    const pal = this.palette();
    try {
      const r = await call<{ layers: number; missing: string[] }>('styleApply', { fx: s.fx(pal), text: s.text?.(pal) ?? null, extrude: s.extrude ?? 0, clear: !this.stack, name: s.label });
      toast(`${s.label} → ${r.layers} layer(s)`);
      r.missing?.forEach((m) => toast('Not installed, used a fallback: ' + m, 'info', 4000));
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }
  private async clearStyles() {
    try { const r = await call<{ layers: number }>('styleApply', { fx: [], clear: true, text: null, extrude: 0, name: 'Clear' }); toast(`Cleared ${r.layers} layer(s)`); } catch (e: any) { toast(e.message, 'err'); }
  }
  private async applyGradient() {
    const g = this.gSel;
    let png: string | null = null;
    if (this.gTarget !== 'fill') {
      if (!inAE) { toast(`Preview mode: “${g.name}” would be rendered at 2048px and applied`, 'info'); return; }
      const req = nodeRequire();
      if (!req) { toast('Node.js unavailable', 'err'); return; }
      const fs = req('fs'), path = req('path'), os = req('os');
      let dir: string | null = null;
      try { dir = await call<string | null>('sfxFolder'); } catch { /* */ }
      dir = dir ? path.join(path.dirname(dir), 'Kinetix Gradients') : path.join(os.homedir(), 'Documents', 'Kinetix Gradients');
      fs.mkdirSync(dir, { recursive: true });
      png = path.join(dir, `${g.name.replace(/\W+/g, '_')}_${g.id}.png`);
      if (!fs.existsSync(png)) fs.writeFileSync(png, Buffer.from(await renderPng(g)));
    }
    try {
      const r = await call<{ layers: number }>('gradApply', { mode: this.gTarget, png, name: g.name, stops: g.stops.map((s) => hex(s.c)), radial: g.type === 'radial', angle: g.angle, animate: this.animate });
      toast(`${g.name} → ${r.layers} layer(s)`);
    } catch (e: any) { toast(e.message, 'err', 6000); }
  }
}
