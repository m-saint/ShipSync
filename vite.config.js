/// <reference types="vitest" />
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  // Polling is required in some sandboxed dev environments where the native
  // file-watcher events don't reach Node. Adds <1% overhead in normal local
  // dev and unblocks HMR otherwise.
  server: {
    watch: {
      usePolling: true,
      interval: 200,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    include: ['src/**/*.{test,spec}.{js,ts}'],
  },
})
