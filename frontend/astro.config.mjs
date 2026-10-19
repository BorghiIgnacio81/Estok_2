// =============================================================================
// Astro Configuration - Estok Frontend
// Server mode: rutas dinámicas con [id] se renderizan en servidor
// Rutas estáticas se renderizan en build
//
// EMPAQUETADO MÓVIL (TWA / PWABuilder / Capacitor):
//   El despliegue real es SSR (Django API + Astro Node detrás de Nginx), por lo
//   que el paquete Android debe apuntar a https://eeestok.duckdns.org (TWA) o a
//   `server.url` en Capacitor. NO se requiere `output: 'static'`. Ver
//   PWA_MOVIL_EMPAQUETADO.md.
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
  compressHTML: true,
  build: {
    assets: 'assets',
    inlineStylesheets: 'auto',
  },
  // Pruebas en un móvil real dentro de la misma red: `npm run dev` escucha en
  // la IP de la PC. OJO: getUserMedia exige HTTPS salvo en localhost, así que
  // para probar la CÁMARA usá la URL de producción o un túnel HTTPS.
  server: {
    host: true,
    port: 4321,
  },
  preview: {
    host: true,
    port: 4321,
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // WebView de Android (TWA/Capacitor) y Safari iOS 14+: evita sintaxis que
      // los WebView viejos no soportan (rompe los <script> de la app).
      target: ['es2020', 'safari14', 'chrome87'],
      cssMinify: true,
      minify: 'esbuild',
    },
  },
});

