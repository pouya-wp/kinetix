// Short "how to" cards for every section + the first-run welcome.
import { h, Btn, modal } from '../ui/kit';

export const HELP: Record<string, { what: string; steps: string[]; tips?: string[] }> = {
  camera: {
    what: 'Drives After Effects’ own camera and 3D layers — nothing proprietary in your project.',
    steps: ['Open a comp, click “Add camera” — your layers become 3D automatically.', 'In “Layers & depth”, spread the layers in Z and keep their on-screen size.', 'Move the playhead, drag the Orbit / Move / Dolly pads, then “Key pose”. Repeat at another time — done.', 'Focus & blur: turn on depth of field and pick the layer to keep sharp.'],
    tips: ['One drag = one undo step in AE.', 'Ready moves add a whole camera move in one click; shakes stack on top.'],
  },
  animate: {
    what: 'Eases for any keyframes, In/Out animations for any layer, wiggles and loops.',
    steps: ['Select keyframes in AE → pick an ease → “Apply to selected keyframes”.', 'Select layers → pick an In and an Out style → “Apply to selected layers”. They follow the layer’s in/out points.', '“Bake to keyframes” turns the live expressions into plain keys for faster renders.'],
  },
  type: {
    what: 'Per-letter, word or line animations on live, editable text.',
    steps: ['Select text layers in AE.', 'Pick an In motion (and optionally Out / Loop), direction and order.', 'Apply — change the text or font any time afterwards, the animation follows.'],
  },
  physics: {
    what: 'Real rigid-body physics on your layers’ exact outlines, including custom and morphing shape paths.',
    steps: ['Import the selected layers (shape outlines are read exactly).', 'Choose which ones are static (floors, walls) and press Simulate.', 'Bake — position and rotation keys are written, plus hit markers for Auto-SFX.'],
  },
  bounce: {
    what: 'Squash-and-stretch bounce animation for any layer.',
    steps: ['Set the drop, the floor and the bounciness.', 'Play to preview, tweak, then send to After Effects.'],
  },
  shapes: {
    what: 'Real-time shape animation: morphs between any outlines, gooey merging, trails, melt and auto-behaviors.',
    steps: ['Add a shape (or draw one), move the playhead and use “Morph into…” — a form, another shape, a word or a logo.', 'Put shapes in a merge group so they melt together when close.', 'Add Auto animation (jiggle, breathe, melt, gooey trail…) — no keyframes needed.', '“Send to After Effects” creates real shape layers.'],
  },
  text: {
    what: 'Many subtitle layers morphed into one another, with an animated text box.',
    steps: ['Select your subtitle text layers in AE and Analyze.', 'Pick a morph style and a box style, set the font.', 'Build — the precomp holds the text; the box sits outside so you can make it an adjustment layer.'],
  },
  color: {
    what: 'One-click colour grades for the whole video, built from native AE effects on one adjustment layer.',
    steps: ['Pick a look — tiles show it on a sample image (or load a still of your own video).', 'Adjust strength, warmth, contrast, saturation and fade.', 'Apply — a “KX Color Grade” adjustment layer goes on top of the comp. Apply again to update it.'],
  },
  style: {
    what: 'Glow, bevel, shadows and 500+ gradients for any layer.',
    steps: ['Select layers in AE.', 'Click a style or gradient — it is applied with live, editable effects.'],
  },
  sound: {
    what: 'Real recorded pops, drops and whooshes, and Auto-SFX that scores your whole animation into one clean track.',
    steps: ['Listen to the styles and pick one.', 'Analyze — every layer is read on screen frame by frame and grouped into gestures.', 'Preview the mix, then “Place in AE”. Run it again to replace the previous mix.'],
    tips: ['Use “Vary” for different sound picks, “Rich” for more detail, “3 stems” to balance pops / motion / detail yourself.'],
  },
  brand: {
    what: 'Your colours, fonts and logo — used across every Kinetix section.',
    steps: ['Add your palette and fonts.', 'Swatches everywhere in Kinetix now show your brand first.'],
  },
  render: {
    what: 'One-click renders with presets researched for YouTube, Instagram and TikTok.',
    steps: ['Pick one or more presets.', 'Press “Render now” — AE renders the frames; FFmpeg (if found) encodes with exact platform settings.'],
  },
};

export function showHelp(id: string, title: string) {
  const H = HELP[id];
  if (!H) return;
  modal((close) => h('div', { class: 'stack', style: { maxWidth: '440px' } },
    h('div', { class: 'page-title', style: { fontSize: '20px' } }, title),
    h('div', { class: 'hint', style: { fontSize: '13px' } }, H.what),
    h('ol', { class: 'help-steps' }, ...H.steps.map((s) => h('li', null, s))),
    H.tips ? h('div', { class: 'stack', style: { gap: '4px' } }, ...H.tips.map((t) => h('div', { class: 'hint' }, '💡 ' + t))) : null,
    h('div', { class: 'row' }, Btn('Got it', close, { variant: 'primary' }))));
}

export function welcome(sections: { id: string; title: string }[], open: (id: string) => void) {
  modal((close) => h('div', { class: 'stack', style: { maxWidth: '520px' } },
    h('div', { class: 'page-title', style: { fontSize: '22px' } }, 'Welcome to Kinetix'),
    h('div', { class: 'hint', style: { fontSize: '13px' } }, 'Everything works on After Effects’ own layers — your project stays editable without Kinetix. Pick a place to start:'),
    h('div', { class: 'tiles', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } }, ...sections.map((s) => {
      const t = h('div', { class: 'tile' }, h('div', { class: 'tile-label' }, s.title), h('div', { class: 'tile-sub' }, HELP[s.id]?.what.split(/[.—]/)[0] ?? ''));
      t.addEventListener('click', () => { close(); open(s.id); });
      return t;
    })),
    h('div', { class: 'hint' }, 'Tip: Ctrl+K searches every command. The ? button explains the section you are in.'),
    h('div', { class: 'row' }, Btn('Start', close, { variant: 'primary' }))));
}
