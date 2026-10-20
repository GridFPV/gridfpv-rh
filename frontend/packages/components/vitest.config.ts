import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  // Plain Svelte 5 + plain CSS: no preprocessor inside the Vitest worker (it trips on a
  // partial Vite environment). Production builds still preprocess via svelte.config.js.
  plugins: [svelte({ preprocess: [] }), svelteTesting()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.ts']
  }
});
