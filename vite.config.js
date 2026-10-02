import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Relative base: the built site works from any path (domain root, or a GitHub Pages
  // subpath like /city-scape/). Runtime asset URLs go through src/assets/assetUrl.js.
  base: './',
  publicDir: 'public',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
