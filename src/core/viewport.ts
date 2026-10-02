import type { Vec } from './math';
import { store } from './state';
import { h, icon } from '../ui/kit';

export interface ToolHandler {
  down?(p: Vec, e: PointerEvent): void;
  move?(p: Vec, e: PointerEvent): void;
  up?(p: Vec, e: PointerEvent): void;
  hover?(p: Vec, e: PointerEvent): void;
  dbl?(p: Vec, e: MouseEvent): void;
  cursor?(): string;
}

const guideCache = new Map<string, HTMLImageElement>();
function guideImage(src: string) {
  let img = guideCache.get(src);
  if (!img) { img = new Image(); img.src = src; img.onload = () => window.dispatchEvent(new Event('kx-redraw')); guideCache.set(src, img); }
  return img.complete ? img : null;
}

/** Canvas viewport in comp (world) pixel space with zoom, pan, grid, rulers and guide image. */
export class Viewport {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly zoomEl: HTMLElement;
  zoom = 0.5;
  panX = 0;
  panY = 0;
  dpr = 1;
  tool: ToolHandler = {};
  showRulers = true;
  private dirty = true;
  private fitted = false;
  private panning: { x: number; y: number; px: number; py: number } | null = null;
  private spaceDown = false;
  hoverWorld: Vec | null = null;

  constructor(private draw: (ctx: CanvasRenderingContext2D, vp: Viewport) => void, private overlay?: (ctx: CanvasRenderingContext2D, vp: Viewport) => void) {
    this.canvas = h('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.el = h('div', { class: 'stage-canvas' }, this.canvas);
    const pct = h('span', { title: 'Click to fit', onclick: () => this.fit() });
    this.zoomEl = h('div', { class: 'zoom' },
      h('button', { class: 'btn', onclick: () => this.zoomBy(1 / 1.25) }, icon('minus')),
      pct,
      h('button', { class: 'btn', onclick: () => this.zoomBy(1.25) }, icon('plus')),
    );
    (this.zoomEl as any).pct = pct;

    new ResizeObserver(() => { this.resize(); }).observe(this.el);
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointerleave', () => { this.hoverWorld = null; this.request(); });
    this.canvas.addEventListener('dblclick', (e) => this.tool.dbl?.(this.toWorld(e.clientX, e.clientY), e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') this.spaceDown = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceDown = false; });
    window.addEventListener('kx-redraw', () => this.request());
    const loop = () => {
      if (this.dirty && this.el.isConnected && this.el.offsetParent) { this.dirty = false; this.render(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  request() { this.dirty = true; }

  get comp() { return store.state.comp; }

  resize() {
    const r = this.el.getBoundingClientRect();
    if (r.width < 2) return;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (!this.fitted) { this.fit(); this.fitted = true; }
    this.request();
  }

  get w() { return this.canvas.width / this.dpr; }
  get h() { return this.canvas.height / this.dpr; }

  fit() {
    const { w, h } = this.comp;
    const pad = 56;
    this.zoom = Math.max(0.02, Math.min((this.w - pad * 2) / w, (this.h - pad * 2) / h));
    this.panX = (this.w - w * this.zoom) / 2;
    this.panY = (this.h - h * this.zoom) / 2;
    this.updateZoomLabel();
    this.request();
  }

  zoomBy(k: number, sx = this.w / 2, sy = this.h / 2) {
    const z = Math.min(16, Math.max(0.02, this.zoom * k));
    const wx = (sx - this.panX) / this.zoom, wy = (sy - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = sx - wx * z;
    this.panY = sy - wy * z;
    this.updateZoomLabel();
    this.request();
  }

  private updateZoomLabel() { (this.zoomEl as any).pct.textContent = Math.round(this.zoom * 100) + '%'; }

  toWorld(cx: number, cy: number): Vec {
    const r = this.canvas.getBoundingClientRect();
    return [(cx - r.left - this.panX) / this.zoom, (cy - r.top - this.panY) / this.zoom];
  }
  toScreen(p: Vec): Vec { return [p[0] * this.zoom + this.panX, p[1] * this.zoom + this.panY]; }
  /** world size of N screen pixels */
  px(n: number) { return n / this.zoom; }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    if (e.shiftKey && !e.ctrlKey) { this.panX -= e.deltaY; this.request(); return; }
    this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }
  private onDown(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.altKey || this.spaceDown || e.button === 2) {
      this.panning = { x: e.clientX, y: e.clientY, px: this.panX, py: this.panY };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 0) this.tool.down?.(this.toWorld(e.clientX, e.clientY), e);
    this.request();
  }
  private onMove(e: PointerEvent) {
    const p = this.toWorld(e.clientX, e.clientY);
    this.hoverWorld = p;
    if (this.panning) {
      this.panX = this.panning.px + e.clientX - this.panning.x;
      this.panY = this.panning.py + e.clientY - this.panning.y;
      this.request();
      return;
    }
    if (e.buttons & 1) this.tool.move?.(p, e);
    else this.tool.hover?.(p, e);
    this.canvas.style.cursor = this.spaceDown || e.altKey ? 'grab' : this.tool.cursor?.() ?? 'default';
    this.request();
  }
  private onUp(e: PointerEvent) {
    if (this.panning) { this.panning = null; this.canvas.style.cursor = ''; return; }
    this.tool.up?.(this.toWorld(e.clientX, e.clientY), e);
    this.request();
  }

  render() {
    const { ctx, dpr } = this;
    const s = store.state;
    const { w, h, bg } = s.comp;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0b0c';
    ctx.fillRect(0, 0, this.w, this.h);

    // comp in world space
    ctx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, dpr * this.panX, dpr * this.panY);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = 40;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const v = s.view;
    if (v.guide) {
      const img = guideImage(v.guide);
      if (img) {
        ctx.save();
        ctx.globalAlpha = v.guideOpacity / 100;
        const sc = v.guideScale / 100;
        const iw = img.naturalWidth * sc, ih = img.naturalHeight * sc;
        ctx.drawImage(img, (w - iw) / 2 + v.guideX, (h - ih) / 2 + v.guideY, iw, ih);
        ctx.restore();
      }
    }
    if (v.grid && v.gridSize > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      ctx.lineWidth = 1 / this.zoom;
      ctx.strokeStyle = 'rgba(255,255,255,0.055)';
      ctx.beginPath();
      for (let x = v.gridSize; x < w; x += v.gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = v.gridSize; y < h; y += v.gridSize) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(209,254,23,0.12)';
      ctx.beginPath();
      ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1 / this.zoom;
    ctx.strokeRect(0, 0, w, h);

    this.draw(ctx, this);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlay?.(ctx, this);
    if (v.grid && this.showRulers) this.drawRulers();
  }

  private drawRulers() {
    const { ctx } = this;
    const R = 18;
    ctx.fillStyle = 'rgba(15,17,19,0.92)';
    ctx.fillRect(0, 0, this.w, R);
    ctx.fillRect(0, 0, R, this.h);
    ctx.fillStyle = 'rgba(247,247,248,0.4)';
    ctx.strokeStyle = 'rgba(247,247,248,0.18)';
    ctx.font = '9px Consolas, monospace';
    ctx.lineWidth = 1;
    // pick a step that is ~70px on screen
    const raw = 70 / this.zoom;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
    const x0 = Math.floor(-this.panX / this.zoom / step) * step;
    ctx.beginPath();
    for (let x = x0; x * this.zoom + this.panX < this.w; x += step) {
      const sx = Math.round(x * this.zoom + this.panX) + 0.5;
      ctx.moveTo(sx, R - 6); ctx.lineTo(sx, R);
      ctx.fillText(String(Math.round(x)), sx + 3, 10);
    }
    const y0 = Math.floor(-this.panY / this.zoom / step) * step;
    for (let y = y0; y * this.zoom + this.panY < this.h; y += step) {
      const sy = Math.round(y * this.zoom + this.panY) + 0.5;
      ctx.moveTo(R - 6, sy); ctx.lineTo(R, sy);
      ctx.save();
      ctx.translate(10, sy + 3);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(Math.round(y)), 0, 0);
      ctx.restore();
    }
    ctx.stroke();
    if (this.hoverWorld) {
      const [sx, sy] = this.toScreen(this.hoverWorld);
      ctx.fillStyle = '#d1fe17';
      ctx.fillRect(sx - 0.5, 0, 1, R);
      ctx.fillRect(0, sy - 0.5, R, 1);
    }
    ctx.fillStyle = '#0f1113';
    ctx.fillRect(0, 0, R, R);
  }
}
