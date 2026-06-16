// =============================================================================
// Astro Configuration - Estok Frontend
// Hybrid: rutas estáticas + dinámicas (sin getStaticPaths)
// =============================================================================

import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'http://localhost:4321',
  output: 'static',
  build: {
    // Assets con hash para cacheo perpetuo
    assets: 'assets',
    inlineStylesheets: 'auto',
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Optimización para producción
      cssMinify: true,
      minify: 'esbuild',
    },
  },
  server: {
    port: 4321,
    host: true,
  },
});
