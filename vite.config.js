import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // AudioWorklet modules are bundled like workers (single self-contained ES module each).
  worker: { format: 'es' },
});
