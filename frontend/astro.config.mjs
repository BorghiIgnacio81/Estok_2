// =============================================================================
// Astro Configuration - Estok Frontend
// Static: páginas estáticas + dinámicas con [id] (prerender=false)
// Las rutas [id] se generan como HTML genérico, datos vía API
// =============================================================================

import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://eeestok.duckdns.org',
  output: 'static',
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
