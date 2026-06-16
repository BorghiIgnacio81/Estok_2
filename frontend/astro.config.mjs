// =============================================================================
// Astro Configuration - Estok Frontend
// SSR con @astrojs/node: rutas dinámicas se renderizan en servidor
// =============================================================================

import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'http://localhost:4321',
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  build: {
    assets: 'assets',
    inlineStylesheets: 'auto',
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      cssMinify: true,
      minify: 'esbuild',
    },
  },
  server: {
    port: 4321,
    host: true,
  },
});
