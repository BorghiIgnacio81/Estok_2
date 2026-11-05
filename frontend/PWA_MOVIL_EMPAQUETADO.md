# Estok · PWA móvil y empaquetado nativo (TWA / PWABuilder / Capacitor)

Guía operativa para validar la PWA en iOS/Android y generar la primera build
móvil. **No requiere cambiar el despliegue**: la app sigue siendo SSR
(Django API + Astro Node detrás de Nginx) y el paquete nativo apunta a
`https://eeestok.duckdns.org`.

---

## 1. Qué quedó preparado en el código

| Área | Archivo | Estado |
| --- | --- | --- |
| Manifest completo (192/512 + maskable + apple 180, shortcuts) | `frontend/public/manifest.json` | ✅ |
| Iconos maskable (safe zone 80 %) | `frontend/public/icons/icon-*-maskable.png` | ✅ |
| Meta tags iOS/Android (`apple-mobile-web-app-capable`, `viewport-fit=cover`, theme-color dinámico) | `frontend/src/layouts/BaseLayout.astro` | ✅ |
| Safe-area (notch / barra de gestos), tap highlight, `touch-action` | `frontend/src/styles/global.css` | ✅ |
| Detección standalone/WebView, color de tema, botón ATRÁS, anti doble-tap | `frontend/src/lib/layout/nativeShell.ts` | ✅ |
| Service Worker (precache de iconos nuevos) | `frontend/public/sw.js` | ✅ |
| Escáner QR con **jsQR empaquetado** (sin CDN), frame 640 px, ~8 fps, errores de permiso, fallback por foto | `frontend/src/lib/escanerQr.ts` | ✅ |
| Cámara/galería del alta de objetos: selector «📷 Tomar foto» (`capture="environment"`) / «🖼️ Elegir de la Galería» (validación de tipo/tamaño, HEIC, anti doble-captura) | `frontend/src/lib/objetos/objetoArchivoImagen.ts` + `objetoCamara.ts` + `components/objetos/CapturaFotosCompacta.astro` | ✅ |
| Selector «📷 Tomar foto» (`capture="environment"`) / «🖼️ Elegir de la Galería» en edición de objeto | `frontend/src/pages/objetos/[id]/editar/index.astro` + `lib/editarObjetoFotos.ts` | ✅ |
| Header `Permissions-Policy: camera=(self)` y `/.well-known/` | `nginx-combined.conf` | ✅ |
| Targets de build para WebView (es2020/safari14) y host LAN en dev | `frontend/astro.config.mjs` | ✅ |
| Digital Asset Links de la TWA (`org.eeestok.app`) | `frontend/public/.well-known/assetlinks.json` | ✅ (falta la huella SHA-256 real) |
| Banner publicitario dinámico (se destruye si el plan es Pro) | `frontend/src/components/AdContainer.astro` + `src/lib/publicidad/estadoPublicidad.ts` | ✅ |
| Páginas legales exigidas por Play Store | `/politica-privacidad` y `/terminos-servicio` (`src/pages/`, layout `LegalLayout.astro`) | ✅ |
| Suscripción Pro (checkout + webhook) | `inventario/api/viewsets/suscripciones.py` + `inventario/services/suscripcion_pago.py` | ✅ (requiere `MERCADOPAGO_ACCESS_TOKEN`) |


> **Nota honesta:** la cámara en vivo y la instalación PWA no se pueden validar
> desde este entorno (ni con `localhost`): requieren HTTPS y un dispositivo
> real. Ver checklist §5.

---

## 2. Verificación local antes de empaquetar

```powershell
cd frontend
npm install
npx astro check      # tipos / imports
npm run build        # debe terminar sin errores
```

Comprobar que el manifest y los iconos quedaron en el build:

```powershell
Get-ChildItem .\dist\client\manifest.json
Get-ChildItem .\dist\client\icons\*maskable*.png
Get-ChildItem .\dist\client\.well-known -Force
```

> **Verificado en el build local:** Astro copia `public/.well-known/` a
> `dist/client/.well-known/` (el ejemplo queda en
> `/.well-known/assetlinks.example.json`). El archivo real
> `assetlinks.json` se agrega en ese mismo directorio y Nginx ya lo sirve como
> JSON con la location `/.well-known/`.

---

## 3. Android · TWA con PWABuilder (recomendado)

### 3.1 Generar el paquete

1. Desplegar el frontend (commit + push + **Redeploy manual en Coolify**) y
   verificar que `https://eeestok.duckdns.org/manifest.json` responde 200 con
   `Content-Type: application/manifest+json`.
2. Entrar a <https://www.pwabuilder.com>, cargar
   `https://eeestok.duckdns.org` y revisar el score de PWA.
3. *Package for stores* → **Android** → completar:
   - **Package ID**: `org.eeestok.app` (o el que se elija; debe coincidir con
     `assetlinks.json`).
   - **App name**: `Estok` · **Short name**: `Estok`.
   - Iconos: PWABuilder toma los del manifest (192, 512 y maskable).
4. Descargar el ZIP: incluye proyecto Android, `assetlinks.json` y el
   `signing.keystore` **generado por PWABuilder** (guardar la contraseña).

### 3.2 Compilar / instalar en un Android real

El ZIP de PWABuilder se puede compilar con Android Studio, o instalar la APK ya
incluida. Para una build de prueba:

```powershell
# Abrir el proyecto en Android Studio y ejecutar 'Run' con el móvil conectado,
# o compilar desde la carpeta del proyecto:
.\gradlew assembleDebug
```

### 3.3 Digital Asset Links (obligatorio para que abra sin barra de Chrome)

`/.well-known/assetlinks.json` debe publicar **el SHA-256 del keystore con el
que se firmó la APK**:

```powershell
keytool -list -v -keystore .\signing.keystore -alias androiddebugkey -storepass <PASSWORD>
# copiar la huella SHA-256
```

Crear `frontend/public/.well-known/assetlinks.json` (partiendo de
`assetlinks.example.json`) con:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "org.eeestok.app",
      "sha256_cert_fingerprints": ["AA:BB:CC:...:SHA256_REAL"]
    }
  }
]
```

Commit + push + Redeploy, y verificar:

```powershell
Invoke-WebRequest -Uri "https://eeestok.duckdns.org/.well-known/assetlinks.json" -UseBasicParsing | Select-Object StatusCode, Content
```

> **Estado en el repo (oct 2026):** `frontend/public/.well-known/assetlinks.json`
> ya existe con el `package_name` de la TWA (`org.eeestok.app`) y
> `sha256_cert_fingerprints: []`. La ruta responde 200/JSON, pero **la
> verificación de Digital Asset Links NO queda activa hasta cargar la huella
> SHA-256 real del keystore que firma la APK** (paso `keytool` de arriba):
> pegar cada huella como string dentro del array y volver a desplegar. Una lista
> vacía equivale a "sin huellas declaradas": Chrome sigue abriendo con barra.

> Si se publica en Google Play con **Play App Signing**, la huella válida es la
> que muestra Play Console (App integrity), no la del keystore local.

### 3.4 Probar la TWA

- Instalar la APK, abrir: debe cargar sin barra de URL (standalone).
- Navegación móvil: las 3 barras (`Objetos`, `Almacenamiento`, `Decisiones`)
  deben responder con un solo toque (el guard anti doble-tap evita la doble
  navegación del WebView).

---

## 4. Alternativa · Capacitor (WebView propio)

Solo si se necesita publicar en Play Store con un contenedor propio o acceder a
plugins nativos. La app **no necesita build estático**: Capacitor apunta al
servidor de producción.

```powershell
cd frontend
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/app
npx cap init Estok org.eeestok.app --web-dir=dist/client
npx cap add android
```

`frontend/capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.eeestok.app',
  appName: 'Estok',
  webDir: 'dist/client',
  server: {
    url: 'https://eeestok.duckdns.org',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
```

Puntos ya resueltos para este caso:

- `nativeShell.ts` escucha el botón ATRÁS (`Capacitor.Plugins.App.backButton`)
  y navega / minimiza. No hace falta escribir código Java.
- Los `<input type="file" capture>` abren cámara/galería porque el WebView de
  Capacitor implementa `onShowFileChooser` por defecto.
- jsQR está empaquetado en el bundle: el escáner no depende de un CDN y
  funciona dentro del WebView.
- `Permissions-Policy` y HTTPS están en Nginx; el WebView hereda el permiso.

Además, en `android/app/src/main/AndroidManifest.xml` declarar la cámara (el
WebView la exige para `getUserMedia`; `required="false"` evita excluir tablets
sin cámara en Play Store):

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

```powershell
npx cap sync android
npx cap open android   # compilar y ejecutar en el móvil
```

---

## 5. Checklist de prueba en dispositivos reales

### Android (Chrome y APK/TWA)
- [ ] `https://eeestok.duckdns.org/manifest.json` → 200 + JSON válido.
- [ ] Chrome → menú → *Instalar aplicación / Añadir a pantalla de inicio*.
- [ ] Abre en standalone (sin barra de URL) y el icono no se recorta.
- [ ] `/objetos/nuevo` → *Subir foto del objeto* → cámara y galería.
- [ ] `/objetos/<id>/editar` → *Usar cámara* sube la foto y abre el editor.
- [ ] `/escanear` → permiso de cámara → el QR de un contenedor redirige al
      detalle en menos de ~2 s.
- [ ] Con el permiso DENEGADO: aparece el mensaje con instrucciones y
      *Reintentar cámara*; el fallback *Escanear desde una foto* funciona.
- [ ] Bloquear/desbloquear el teléfono con `/escanear` abierto → al volver, la
      cámara se reanuda.
- [ ] Botón ATRÁS del sistema (en APK) no deja pantalla en blanco.

### iOS (Safari y PWA instalada)
- [ ] Compartir → *Añadir a pantalla de inicio* → abre sin barra de Safari.
- [ ] La barra superior no queda debajo del notch / isla dinámica.
- [ ] Cámara y fotos: *Tomar foto* y *Elegir de la fototeca*.
- [ ] `/escanear` pide permiso y funciona; si se deniega, el texto explica
      Ajustes → Safari → Cámara.
- [ ] Al volver desde la app Cámara, el feed del escáner se reanuda.
- [ ] Dark mode: la barra de estado y `theme-color` cambian a `#1e293b`.

> **iOS no soporta TWA.** Las opciones son PWA instalada (recomendada, ya
> funciona) o un wrapper WKWebView con Capacitor (`npx cap add ios`, requiere
> macOS/Xcode).

---

## 6. Diagnóstico rápido

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| No aparece "Instalar app" | Manifest 404/MIME incorrecto o sin icono 512 | Ver §3.1 y los headers de `manifest.json` |
| Abre con barra de Chrome | `assetlinks.json` ausente o SHA-256 distinto | Repetir §3.3 |
| Cámara bloqueada en `/escanear` | Permiso denegado o contexto no HTTPS | El mensaje en pantalla indica la ruta exacta |
| La cámara se congela al volver | Tracks cerrados por iOS/Android | Ya se reabre en `visibilitychange` |
| Escáner lento | Frames 1080p | Ya se reescala a 640 px y 8 fps |
| Dos navegaciones con un toque | Doble evento en WebView | Guard de 700 ms en `nativeShell.ts` |
| La app no actualiza el layout | Service Worker viejo | `CACHE_VERSION` en `sw.js` (subir en cada deploy) |

---

## 7. Deuda técnica conocida (no se tocó en esta auditoría)

- `components/ImageEditor.astro` todavía carga **Cropper.js 1.6.2 desde
  cdnjs** y la fuente Inter desde Google Fonts. Con red funcionan; sin red, el
  editor de imagen no abre. `cropperjs@2` está instalado pero su API es distinta
  (web components), así que migrarlo requiere un cambio aparte.
- El formulario de edición de objetos mantiene el botón *Subir foto(s)*
  deshabilitado (la subida arranca al elegir el archivo). Es el comportamiento
  previo; no se modificó para no ampliar el alcance.
- La orientación del manifest es `portrait` (layout móvil ya validado en
  vertical). Si se quiere permitir landscape para los mapas, cambiarla a `any`
  y volver a validar el layout en horizontal.
- Botón ATRÁS del hardware: vuelve de pantalla; en la raíz minimiza la app
  (requiere `@capacitor/app` solo si se usa Capacitor; en TWA lo maneja Chrome).
- `/escanear`: debe pedir permiso de cámara y mostrar el feed.

---

## 8. Monetización y requisitos de Google Play Store

### 8.1 Publicidad dinámica (`<AdContainer />`)

- El layout incluye un único slot publicitario (`components/AdContainer.astro`,
  montado en `layouts/BaseLayout.astro`). Nace `hidden` para que un usuario Pro
  no vea ni un parpadeo de anuncio.
- `lib/publicidad/estadoPublicidad.ts` es la ÚNICA fuente de verdad en el
  cliente: lee `GET /api/usuarios/me/` (`ocultar_publicidad`, `es_premium`,
  `plan_suscripcion`) y, si el plan es Pro, ejecuta `remove()` sobre
  `[data-ad-container]` → **no queda hueco ni margen en la UI**.
- Red publicitaria en web: definir en `frontend/.env` (build):
  `PUBLIC_ADSENSE_CLIENT_ID`, `PUBLIC_ADSENSE_SLOT_BANNER`. Sin esas variables
  se muestra el "anuncio de casa" (invitación a Estok Pro).
- En la TWA/Capacitor el wrapper nativo puede montar el banner AdMob leyendo
  `window.EstokAds.estado` y el evento `window.addEventListener('estok:publicidad', ...)`;
  la unidad se configura con `PUBLIC_ADMOB_BANNER_ID`
  (queda en `data-admob-unit`).

### 8.2 Suscripción Pro (Mercado Pago)

| Endpoint | Método | Auth | Uso |
| --- | --- | --- | --- |
| `/api/suscripciones/crear_preferencia/` | POST | JWT | Crea la preferencia de Checkout Pro y devuelve `init_point`. |
| `/api/suscripciones/webhook/` | POST | Público | Mercado Pago notifica; el backend CONSULTA el pago y activa el plan. |

Pasos para activarlo en producción:

1. Cargar `MERCADOPAGO_ACCESS_TOKEN` en las variables de entorno de Coolify
   (mientras falte, el endpoint responde **503** y la app sigue en plan gratuito).
2. Verificar que `SUSCRIPCION_WEBHOOK_URL` sea `https://eeestok.duckdns.org/api/suscripciones/webhook/`.
3. Ajustar `SUSCRIPCION_PRO_PRECIO_ARS` / `SUSCRIPCION_PRO_DIAS` si cambia el precio.
4. Cada pago aprobado deja un registro auditable en **Admin → Pagos de suscripción**
   (`SuscripcionPago`) y activa `es_premium` + `ocultar_publicidad` (el hogar
   completo hereda el plan si la compra fue a nombre del Estok).

> **Si se cobra dentro de la app en Google Play** hay que usar *Google Play
> Billing* (política de Play): una compra con Mercado Pago dentro de la app
> distribuida por Play puede ser rechazada. Alternativas válidas: cobrar en la
> web (fuera de la app) o integrar Play Billing con un webhook equivalente a
> `procesar_notificacion()`.

### 8.3 Páginas legales (obligatorias)

- `https://eeestok.duckdns.org/politica-privacidad`
- `https://eeestok.duckdns.org/terminos-servicio`

Se enlazan desde el footer de la app y deben declararse en Play Console
(*Contenido de la app → Política de privacidad*) y en la consola de AdMob.

### 8.4 Checklist antes de subir el AAB

- [ ] `manifest.json` con `display: standalone`, `orientation: portrait`,
      iconos 512 + maskable y `theme_color` `#8B4513`.
- [ ] `/.well-known/assetlinks.json` respondiendo 200 con la huella SHA-256 real.
- [ ] Política de privacidad y términos publicados y accesibles.
- [ ] `MERCADOPAGO_ACCESS_TOKEN` cargado (o publicidad de casa como fallback).
- [ ] `npm run build` sin errores y `python manage.py check` sin issues.

