import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The helper's own server serves this from `companion/ui/` at its root; relative asset
// URLs keep it indifferent to where that is. `npm run dev` proxies the API to a running
// `gridfpv-video serve --port 5055`.
const HELPER = process.env.HELPER_URL ?? 'http://127.0.0.1:5055';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: {
    outDir: fileURLToPath(new URL('../../../companion/ui', import.meta.url)),
    emptyOutDir: true
  },
  server: {
    proxy: { '/api': { target: HELPER, changeOrigin: true } }
  }
});
