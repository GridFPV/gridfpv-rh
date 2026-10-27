import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The plugin serves the SPA from RotorHazard at /grid, so every asset URL is rooted there,
// and the build lands straight in the plugin folder (gitignored; shipped in the zip).
const RH = process.env.RH_URL ?? 'http://localhost:5050';

export default defineConfig({
  base: '/grid/',
  plugins: [svelte()],
  build: {
    outDir: fileURLToPath(new URL('../../../plugin/gridfpv/static', import.meta.url)),
    emptyOutDir: true
  },
  server: {
    // The help pages are docs/help/*.md at the repo root, outside this app (#41).
    fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] },
    // `make dev`: the page comes from Vite with hot reload, socket.io from the rig.
    proxy: {
      '/socket.io': { target: RH, ws: true, changeOrigin: true }
    }
  }
});
