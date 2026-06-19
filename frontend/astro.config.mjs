// =============================================================================
// Astro Configuration - Estok Frontend
// Server mode: rutas dinámicas con [id] se renderizan en servidor
// Rutas estáticas se renderizan en build
// =============================================================================

import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://eeestok.duckdns.org',
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
});
