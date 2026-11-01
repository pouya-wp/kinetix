<div align="center">

# ⚡ Kinetix

### Professional 2D Physics, Text Morphing & Sound Design Extension for Adobe After Effects

[![Platform](https://img.shields.io/badge/Platform-Adobe%20After%20Effects%202022+-9999FF?style=flat-square&logo=adobeaftereffects)](https://adobe.com/products/aftereffects.html)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Bundler-Vite%208-646CFF?style=flat-square&logo=vite)](https://vitejs.dev/)
[![Engine](https://img.shields.io/badge/Physics-Matter.js-E74C3C?style=flat-square)](https://brm.io/matter-js/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Author](https://img.shields.io/badge/Author-Pouya%20Sadeghpour-181717?style=flat-square&logo=github)](https://github.com/pouya-wp)

<p align="center">
  <b>Kinetix</b> is an all-in-one motion toolkit CEP extension for After Effects. It unifies Newton-style rigid-body 2D physics simulation, intelligent text path morphing, one-click color grading presets, and a 350+ curated one-shot sound effects library directly inside your AE composition.
</p>

</div>

---

## ✨ Features

- 🌐 **Interactive 2D Physics World** — Per-layer dynamic roles (dynamic bodies, fixed boundaries, containers, pinned hinges), rope/bead chains, springs, and rod links baked directly to native After Effects keyframes.
- 🔤 **Path & Text Morphing** — Smooth shape and text transitions with line-by-line editor and sub-path matching.
- 🎨 **One-Click Cinematic Color Looks** — 12 calibrated LUT-style looks applied instantly via adjustment layers with live preview thumbnails.
- 🔊 **Curated SFX Library (350+ One-Shots)** — Curated Foley, clicks, pops, and whooshes automatically scored to motion timing and exported directly into timeline audio tracks.
- ⚡ **Realtime CEP Bridge** — Two-way high-speed ExtendScript host bridge syncing layer selections and transforms in real time.

---

## 🏗️ Architecture

```
Kinetix CEP Architecture
├── Host Layer (ExtendScript / JSX)
│    ├── Layer inspection & bounding-box extraction
│    ├── Keyframe baker (bakes Matter.js simulation into AE Transform keyframes)
│    └── Shape layer & adjustment layer generator
└── Panel Layer (Vite + TypeScript + Modern UI)
     ├── 2D Physics Simulation Engine (Matter.js + Poly-Decomp)
     ├── Audio synthesizer & waveform playback engine
     └── Color matrix transformation pipeline
```

| Component | Stack | Description |
|:---|:---|:---|
| `host/` | ExtendScript (.jsx) | AE DOM manipulation, keyframe baking, layer tracking |
| `src/physics/` | TypeScript + Matter.js | Rigid-body simulation and polygon decomposition |
| `src/sound/` | Web Audio API | Sound library sampler and tempo-matching |
| `src/color/` | Canvas / GL | Realtime LUT previews and adjustment layer generator |

---

## 🚀 Development & Installation

### Prerequisites
- Adobe After Effects 2022+ (v22.0 or higher)
- Node.js 20+

### Setup

```bash
# Clone the repository
git clone https://github.com/pouya-wp/kinetix.git
cd kinetix

# Install dependencies
npm install

# Start Vite dev server
npm run dev

# Run unit & physics integration tests
npm run test
```

### CEP Deployment to After Effects
1. Build production bundle: `npm run build`
2. Symlink or copy the repository directory into your Adobe CEP extensions folder:
   - **Windows:** `%APPDATA%\Adobe\CEP\extensions\kinetix`
3. Enable debugging in Registry:
   ```powershell
   reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```
4. In After Effects, open **Window → Extensions → Kinetix**.

---

## 📄 License

Distributed under the MIT License.

---

<div align="center">
  <sub>Crafted with precision & passion by <b><a href="https://github.com/pouya-wp">Pouya Sadeghpour</a></b></sub>
</div>
