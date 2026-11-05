/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_API_URL: string;
  /** URL pública del sitio (usada por astro.config.mjs). */
  readonly PUBLIC_SITE_URL?: string;
  /** AdSense (web): ID de cliente `ca-pub-...`. Vacío = anuncio de casa. */
  readonly PUBLIC_ADSENSE_CLIENT_ID?: string;
  /** AdSense (web): slot del banner. */
  readonly PUBLIC_ADSENSE_SLOT_BANNER?: string;
  /** AdMob (TWA/Capacitor): unidad de anuncio que monta el wrapper nativo. */
  readonly PUBLIC_ADMOB_BANNER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
