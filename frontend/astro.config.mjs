// =============================================================================
// Astro Configuration - Estok Frontend
// Hybrid: rutas estáticas + dinámicas con [id] (prerender=false)
// Las rutas [id] se renderizan en servidor (Node adapter)
// =============================================================================

import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://eeestok.duckdns.org',
  output: 'hybrid',
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
});
