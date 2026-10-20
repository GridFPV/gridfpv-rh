import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  // Plain Svelte 5 + plain CSS: skip the preprocessor inside the Vitest worker (it trips on
  // a partial Vite environment). Production builds still preprocess via svelte.config.js.
  plugins: [svelte({ preprocess: [] }), svelteTesting()],
  resolve: {
    // Tests run against the component library's source so they need no prior build.
    alias: {
      '@gridfpv/components': fileURLToPath(
        new URL('../../packages/components/src/index.ts', import.meta.url)
      ),
      '@gridfpv/components/tokens.css': fileURLToPath(
        new URL('../../packages/components/src/tokens.css', import.meta.url)
      )
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.ts']
  }
});
