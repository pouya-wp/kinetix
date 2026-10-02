import { h, onRefresh } from './kit';
import { EASES, type Ease } from '../core/math';

/** Cubic-bezier curve editor with draggable handles and preset chips. */
export function CurveEditor(get: () => Ease, set: (e: Ease, final: boolean) => void, begin?: () => void, presets = ['linear', 'smooth', 'easeIn', 'easeOut', 'snappy', 'expo', 'anticipate', 'overshoot']) {
  const cv = h('canvas');
  const box = h('div', { class: 'curve' }, cv);
  const chips = h('div', { class: 'chips' }, ...presets.map((k) => h('button', { class: 'chip', onclick: () => { begin?.(); set([...EASES[k]] as Ease, true); } }, k)));
  const root = h('div', { class: 'stack' }, box, chips);
  const PAD = 16, YMIN = -0.6, YMAX = 1.6;

  const geo = () => {
    const r = box.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };
  const toS = (x: number, y: number) => {
    const { w, h: H } = geo();
    return [PAD + x * (w - PAD * 2), PAD + (1 - (y - YMIN) / (YMAX - YMIN)) * (H - PAD * 2)];
  };
  const fromS = (sx: number, sy: number): [number, number] => {
    const { w, h: H } = geo();
    return [Math.min(1, Math.max(0, (sx - PAD) / (w - PAD * 2))), YMIN + (1 - (sy - PAD) / (H - PAD * 2)) * (YMAX - YMIN)];
  };

  const draw = () => {
    const { w, h: H } = geo();
    if (w < 2) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, H);
    const e = get();
    const [x0, y0] = toS(0, 0), [x1, y1] = toS(1, 1);
    c.strokeStyle = 'rgba(255,255,255,.08)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x0, y0); c.lineTo(x1, y0); c.moveTo(x0, y1); c.lineTo(x1, y1);
    c.stroke();
    const [a, b] = [toS(e[0], e[1]), toS(e[2], e[3])];
    c.strokeStyle = 'rgba(255,255,255,.35)';
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(a[0], a[1]); c.moveTo(x1, y1); c.lineTo(b[0], b[1]); c.stroke();
    c.strokeStyle = '#d1fe17';
    c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(x0, y0); c.bezierCurveTo(a[0], a[1], b[0], b[1], x1, y1); c.stroke();
    for (const p of [a, b]) {
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(p[0], p[1], 5, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = 'rgba(247,247,248,.45)';
    c.font = '10px Consolas, monospace';
    c.fillText(e.map((v) => v.toFixed(2)).join(', '), 8, H - 6);
  };

  let drag = -1;
  cv.addEventListener('pointerdown', (ev) => {
    const r = cv.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const e = get();
    const a = toS(e[0], e[1]), b = toS(e[2], e[3]);
    drag = Math.hypot(mx - a[0], my - a[1]) < Math.hypot(mx - b[0], my - b[1]) ? 0 : 1;
    cv.setPointerCapture(ev.pointerId);
    begin?.();
  });
  cv.addEventListener('pointermove', (ev) => {
    if (drag < 0) return;
    const r = cv.getBoundingClientRect();
    const [x, y] = fromS(ev.clientX - r.left, ev.clientY - r.top);
    const e = [...get()] as Ease;
    e[drag * 2] = +x.toFixed(3);
    e[drag * 2 + 1] = +y.toFixed(3);
    set(e, false);
  });
  cv.addEventListener('pointerup', () => { if (drag >= 0) set(get(), true); drag = -1; });
  new ResizeObserver(draw).observe(box);
  onRefresh(root, draw);
  return root;
}
