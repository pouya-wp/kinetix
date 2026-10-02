import { h, Btn, Field, Select, toast, clear, ColorField, pickFile, downloadText, TextInput, setPalette } from '../ui/kit';
import { Flow, Step, More } from '../ui/flow';
import { call } from '../core/ae-bridge';
import { registerCommands } from '../core/commands';
import { brands, activeBrand, setActive, updateBrand, addBrand, removeBrand, importBrands, exportBrands, onBrand, extractPalette } from './brand';
import { GRADIENTS, cssOf } from '../style/gradients';
import { EASE_LIBRARY } from '../animate/eases';
import { hex } from '../style/styles';
import type { Studio } from '../main';

export class BrandStudio implements Studio {
  id = 'brand';
  el: HTMLElement;
  private body: HTMLElement;
  private fonts: { ps: string; family: string; style: string }[] = [];

  constructor() {
    this.body = h('div', { class: 'stack', style: { gap: '20px' } });
    this.el = Flow({ title: 'Brand', sub: 'Your colours, fonts and logo. Every Kinetix section uses them, and you can drop them on selected layers in one click.', body: [this.body] }).el;
    onBrand(() => { this.render(); setPalette(activeBrand().colors); });
    setPalette(activeBrand().colors);
    this.render();
    registerCommands([
      { id: 'brand.font', label: 'Brand: apply heading font to selected text', group: 'Brand', run: () => this.applyFont('heading') },
      ...activeBrand().colors.map((c, i) => ({ id: 'brand.color' + i, label: `Brand: colour ${i + 1} → selected layers`, group: 'Brand', run: () => this.applyColor(activeBrand().colors[i] ?? c) })),
    ]);
  }

  activate() {}
  deactivate() {}

  private render() {
    clear(this.body);
    const b = activeBrand();
    // brand switcher
    const sw = h('div', { class: 'stack' },
      h('div', { class: 'row' },
        Field('Active brand', Select(brands().map((x) => ({ value: x.id, label: x.name })), () => b.id, (v) => setActive(v))),
        Field('Name', TextInput({ get: () => b.name, set: (v) => updateBrand((x) => { x.name = v || x.name; }) }))),
      h('div', { class: 'row3' },
        Btn('New brand', () => addBrand('Brand ' + (brands().length + 1)), { size: 'sm', icon: 'plus' }),
        Btn('Export', () => downloadText('kinetix-brands.json', exportBrands()), { size: 'sm' }),
        Btn('Import', async () => { const f = await pickFile('.json'); if (f) { try { importBrands(await f.text()); toast('Brands imported'); } catch (e: any) { toast(e.message, 'err'); } } }, { size: 'sm' })),
      brands().length > 1 ? Btn('Delete this brand', () => removeBrand(b.id), { size: 'sm', variant: 'danger' }) : null,
    );
    // colours
    const colors = h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } });
    b.colors.forEach((c, i) => colors.appendChild(h('div', { class: 'tile' },
      h('div', { class: 'tile-prev', style: { background: c, height: '54px' } }),
      ColorField(() => activeBrand().colors[i], (v, fin) => { if (fin) updateBrand((x) => { x.colors[i] = v; }); }),
      h('div', { class: 'row' }, Btn('Apply', () => this.applyColor(c), { size: 'sm', variant: 'soft' }), Btn('', () => updateBrand((x) => { x.colors.splice(i, 1); }), { size: 'sm', icon: 'x', title: 'Remove' })))));
    colors.appendChild(h('div', { class: 'tile', style: { display: 'grid', placeItems: 'center', minHeight: '120px' }, onclick: () => updateBrand((x) => { x.colors.push('#ffffff'); }) }, '+ Add colour'));
    // logo + palette extraction
    const logo = h('div', { class: 'stack' },
      h('div', { class: 'hstack' },
        b.logo ? h('img', { src: b.logo, style: { width: '84px', height: '84px', objectFit: 'contain', borderRadius: '12px', background: 'var(--bg-deep)' } }) : h('div', { class: 'empty', style: { width: '84px' } }, 'No logo'),
        h('div', { class: 'stack grow' },
          Btn('Upload logo / image', async () => {
            const f = await pickFile('image/*');
            if (!f) return;
            const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); });
            updateBrand((x) => { x.logo = url; });
          }, { size: 'sm' }),
          Btn('Extract palette from logo', async () => {
            if (!activeBrand().logo) { toast('Upload a logo or image first', 'info'); return; }
            const pal = await extractPalette(activeBrand().logo!, 6);
            if (pal.length) updateBrand((x) => { x.colors = pal; });
            toast('Palette extracted');
          }, { size: 'sm', variant: 'soft', icon: 'wand' }))));
    // gradients
    const grads = h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' } });
    for (const id of b.gradients) {
      const g = GRADIENTS.find((x) => x.id === id);
      if (!g) continue;
      grads.appendChild(h('div', { class: 'tile' }, h('div', { class: 'tile-prev', style: { background: cssOf(g) } }), h('div', { class: 'tile-label' }, g.name),
        Btn('Remove', () => updateBrand((x) => { x.gradients = x.gradients.filter((q) => q !== id); }), { size: 'sm' })));
    }
    if (!b.gradients.length) grads.appendChild(h('div', { class: 'empty' }, 'Add gradients from the Style → Gradients tab (“+ Brand”).'));
    // fonts + feel
    const fontSel = (which: 'heading' | 'body') => {
      const inp = h('input', { class: 'input', list: 'kx-brand-fonts', placeholder: 'Search fonts…', value: b[which].family || '', style: { fontFamily: 'var(--font-ui)' } }) as HTMLInputElement;
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      inp.addEventListener('focus', () => this.loadFonts());
      inp.addEventListener('change', () => {
        const f = this.fonts.find((x) => `${x.family} — ${x.style}` === inp.value || x.ps === inp.value);
        updateBrand((x) => { x[which] = f ? { ps: f.ps, family: f.family } : { ps: inp.value, family: inp.value.split(' — ')[0] }; });
      });
      return inp;
    };
    const dl = h('datalist', { id: 'kx-brand-fonts' });
    const feel = h('div', { class: 'stack' },
      h('div', { class: 'row' },
        Field('Heading font', h('div', null, fontSel('heading'))),
        Field('Body font', h('div', null, fontSel('body')))), dl,
      h('div', { class: 'row' },
        Btn('Heading → selected text', () => this.applyFont('heading'), { size: 'sm', variant: 'soft' }),
        Btn('Body → selected text', () => this.applyFont('body'), { size: 'sm' })),
      Field('Signature ease', Select(EASE_LIBRARY.map((e) => ({ value: e.id, label: `${e.group} · ${e.label}` })), () => activeBrand().ease, (v) => updateBrand((x) => { x.ease = v; }))));
    this.body.append(
      Step(1, 'Colours', [colors], 'Apply = fill the selected layers'),
      Step(2, 'Fonts', [feel]),
      Step(3, 'Logo', [logo], 'pull the colours out of your logo'),
      More('brand-more', [sw, h('div', { class: 'lbl' }, 'Brand gradients'), grads], 'Several brands, import / export, gradients'));
  }

  private async loadFonts() {
    if (this.fonts.length) return;
    try {
      this.fonts = await call('listFonts');
      const dl = this.el.querySelector('#kx-brand-fonts')!;
      dl.innerHTML = '';
      for (const x of this.fonts) dl.appendChild(h('option', { value: `${x.family} — ${x.style}` }));
    } catch { /* */ }
  }

  private async applyColor(c: string) {
    try { const r = await call<{ layers: number }>('styleApply', { fx: [{ match: ['ADBE Fill'], name: 'KX Style Brand Fill', props: { 'Color': hex(c) } }], text: null, extrude: 0, clear: false, name: 'Brand colour' }); toast(`Colour → ${r.layers} layer(s)`); }
    catch (e: any) { toast(e.message, 'err'); }
  }
  private async applyFont(which: 'heading' | 'body') {
    const f = activeBrand()[which];
    if (!f.ps) { toast('Pick a ' + which + ' font first', 'info'); return; }
    try { const r = await call<{ layers: number }>('textApplyStyle', { target: 'selected', font: f.ps, size: 0, tracking: null, caps: null }); toast(`${f.family} → ${r.layers} layer(s)`); }
    catch (e: any) { toast(e.message, 'err'); }
  }
}
