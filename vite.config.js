import { defineConfig } from 'vite';
import { cp } from 'fs/promises';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
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
