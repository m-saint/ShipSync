/// <reference types="vitest" />
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves project repos under /<repo>/, so production builds need
// every asset URL prefixed with that subpath. The workflow at
// .github/workflows/deploy.yml passes BASE_PATH=/<repo>/ at build time (and
// '/' for user pages, where the deployed URL has no subpath). Local dev and
// local builds default to '/' so nothing changes for non-Pages workflows.
const basePath = process.env.BASE_PATH || '/'

export default defineConfig({
  base: basePath,
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
