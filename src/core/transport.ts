import { clock } from './clock';
import { h, svg, I } from '../ui/kit';

export interface Mark { t: number; kind?: 'tick' | 'key' }
export interface Range { t0: number; t1: number; kind?: 'gap' | 'trans' }

/** Play button + scrubber + time readout bound to the global clock. */
export function Transport(opts: { marks?: () => Mark[]; ranges?: () => Range[]; extra?: Node }) {
  const playBtn = h('button', { class: 'play', title: 'Play / pause (Space)' });
  const fill = h('div', { class: 'scrub-fill' });
  const head = h('div', { class: 'scrub-head' });
  const layer = h('div');
  const scrub = h('div', { class: 'scrub' }, h('div', { class: 'scrub-track' }), layer, fill, head);
  const time = h('div', { class: 'time' });
  const el = h('div', { class: 'transport' }, playBtn, scrub, time, opts.extra ?? null);

  let wasPlaying = false;
  playBtn.addEventListener('click', () => clock.toggle());
  const seekAt = (cx: number) => {
    const r = scrub.getBoundingClientRect();
    clock.seek(((cx - r.left) / r.width) * clock.duration);
  };
  scrub.addEventListener('pointerdown', (e) => {
    scrub.setPointerCapture(e.pointerId);
    wasPlaying = clock.playing;
    clock.pause();
    seekAt(e.clientX);
    const mv = (ev: PointerEvent) => seekAt(ev.clientX);
    const up = () => {
      scrub.removeEventListener('pointermove', mv);
      scrub.removeEventListener('pointerup', up);
      clock.seekFrame(clock.frame);
      if (wasPlaying) clock.play();
    };
    scrub.addEventListener('pointermove', mv);
    scrub.addEventListener('pointerup', up);
  });

  let lastPlaying: boolean | null = null;
  const update = () => {
    const d = Math.max(1e-6, clock.duration);
    const p = Math.min(1, clock.t / d) * 100;
    fill.style.width = p + '%';
    head.style.left = p + '%';
    time.innerHTML = `<b>${clock.t.toFixed(2)}s</b> / ${clock.duration.toFixed(2)}s &nbsp;f${clock.frame}`;
    if (lastPlaying !== clock.playing) {
      lastPlaying = clock.playing;
      playBtn.innerHTML = '';
      playBtn.appendChild(svg(clock.playing ? I.pause : I.play));
    }
  };
  const updateMarks = () => {
    const d = Math.max(1e-6, clock.duration);
    layer.innerHTML = '';
    for (const r of opts.ranges?.() ?? []) {
      layer.appendChild(h('div', { class: 'scrub-range' + (r.kind === 'gap' ? ' gap' : ''), style: { left: (r.t0 / d) * 100 + '%', width: Math.max(0.2, ((r.t1 - r.t0) / d) * 100) + '%' } }));
    }
    for (const m of opts.marks?.() ?? []) {
      layer.appendChild(h('div', { class: 'scrub-mark' + (m.kind === 'key' ? ' key' : ''), style: { left: (m.t / d) * 100 + '%' } }));
    }
  };
  clock.on(update);
  update();
  return { el, update, updateMarks };
}
