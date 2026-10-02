import { defineConfig, type Plugin } from 'vite';

// CEP opens dist/index.html from disk (file://). ES module scripts are blocked
// there, so the bundle is emitted as a classic IIFE script.
const classicScript = (): Plugin => ({
  name: 'kx-classic-script',
  enforce: 'post',
  transformIndexHtml(html) {
    return html.replace(/<script type="module" crossorigin/g, '<script defer').replace(/ crossorigin/g, '');
  },
});

export default defineConfig({
  base: './',
  plugins: [classicScript()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome99',
    assetsInlineLimit: 0,
    modulePreload: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
  server: { port: 5178, host: '127.0.0.1', strictPort: true },
});
