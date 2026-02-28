import { defineConfig } from 'vite';
import { cp } from 'fs/promises';
import { resolve } from 'path';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  resolve: {
    alias: {
      // Use pixi.js's own pre-built flat ESM bundle instead of its source files.
      // The source uses dynamic imports that create circular references when Rollup
      // re-bundles them, causing a deadlock (or TDZ errors) in production builds.
      'pixi.js': resolve('./node_modules/pixi.js/dist/pixi.min.mjs'),
    },
  },
  build: {
    target: 'esnext',
  },
  plugins: [{
    name: 'copy-assets',
    apply: 'build',
    async closeBundle() {
      await cp('./assets', './dist/assets', { recursive: true });
    },
  }],
});
