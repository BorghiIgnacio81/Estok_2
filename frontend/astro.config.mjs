// =============================================================================
// Astro Configuration - Estok Frontend
// Hybrid: páginas estáticas + dinámicas con [id]
// Las rutas [id] usan prerender=false para generarse como HTML genérico
// =============================================================================

import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://eeestok.duckdns.org',
  output: 'hybrid',
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
