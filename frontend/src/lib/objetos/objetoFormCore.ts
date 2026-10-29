// =============================================================================
// NÚCLEO DEL FORMULARIO (/objetos/nuevo) · Persistencia, reset, envío y éxito
// -----------------------------------------------------------------------------
// Desmantelado del <script> de pages/objetos/nuevo.astro (regla de
// modularización <400 líneas por archivo). Responsabilidades:
//   · RESETEO ABSOLUTO cada vez que se abre la pantalla/modal de «Nuevo Objeto»
//     (y tras guardar): formulario, foto/galería, campos de IA, clasificación
//     rápida y variables locales. El alta NUNCA hereda datos de una carga previa.
//   · Reseteo absoluto ante una restauración de BFCACHE (botón Atrás).
//   · Validación final + ENVÍO multipart a POST /api/objetos/ mediante
//     enviarFormData() (services/auth/uploads): Authorization: Bearer + X-Estok-Id
//     multi-tenant + X-CSRFToken, con refresco de JWT ante 401. El
//     dueño externo (no usuario) viaja como texto plano `dueno_externo_nombre`.
//   · Modal de éxito direccional ("Cargar otro" / "Volver al inicio").
// La galería de fotos la gestiona objetoCamara.ts (obtenerFotosObjeto /
// limpiarCamara); acá solo se adjuntan los blobs al FormData.
// =============================================================================

import { enviarFormData, getCsrfToken, getEstokActivoId } from '../../services/auth';
import { base64ToBlob } from '../../services/image';
import { refrescarBotonesIA } from '../botonAutocompletarIA';
import { ref, refOpcional } from '../dom';
import { showToast } from '../toast';
import { limpiarCamara, obtenerFotosObjeto } from './objetoCamara';
import { camposClasificacionAlta, sincronizarClasificacionAlta } from './objetoClasificacionAlta';
// Atributos técnicos por familia (Marca/Modelo/N.º de serie · Material/Dimensiones):
// el alta los adjunta al multipart y re-sincroniza su visibilidad al resetear.
import {
  agregarCamposEspecificosAlFormData,
  sincronizarCamposEspecificos,
} from './objetoCamposEspecificosForm';
import { CLAVE_FOTO_LEGADA, CLAVE_FOTOS, mensajeError } from './objetoComunes';

// --- Referencias al DOM (se resuelven en initObjetoFormCore) -----------------
let submitBtn: HTMLButtonElement;
let submitText: HTMLElement;
let submitSpinner: HTMLElement;
let exitoModal: HTMLElement | null = null;

// =============================================================================
// RESETEO ABSOLUTO DEL FORMULARIO
// Se ejecuta CADA VEZ que se abre la pantalla/modal de «Nuevo Objeto» (y también
// tras guardar o al volver por BFCache): form.reset(), inputs vacíos, selectores
// y checkboxes en su valor inicial, cámara/galería apagadas, visor limpio,
// campos de IA ocultos y clasificación rápida re-sincronizada.
// =============================================================================

export function resetFormularioCompleto(
  opciones: { desplazar?: boolean } = {},
): void {
  // 1-3) Galería multi-foto, visor principal, feed de cámara e inputs file.
  //      Todo eso vive en objetoCamara.ts (limpiarCamara).
  limpiarCamara();

  // 4) form.reset() devuelve TODOS los controles a su valor por defecto del
  //    markup (incluido el estado «Bueno» y los placeholders de los selects).
  //    Después se vacían a mano los campos de texto para no heredar nada.
  const formulario = refOpcional<HTMLFormElement>('objetoForm');
  if (formulario) {
    formulario.reset();
    formulario.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input[type="date"], input[type="email"], textarea').forEach((el) => {
      (el as HTMLInputElement | HTMLTextAreaElement).value = '';
    });
    formulario.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((el) => {
      (el as HTMLInputElement).checked = false;
    });
    // Lote 31 · punto 4: el alta rápida (Caja / Mueble) desmarca sus casillas con
    // las demás, pero su RESALTE es presentación propia del módulo: se re-sincroniza
    // para que la próxima carga no muestre una clasificación ya descartada.
    sincronizarClasificacionAlta();
    formulario.querySelectorAll('[aria-invalid="true"], .input-error').forEach((el) => {
      el.removeAttribute('aria-invalid');
      el.classList.remove('input-error');
    });
  }

  // 4 bis) CAMPOS TÉCNICOS: la categoría volvió a «Sin categoría», así que los
  // bloques por familia deben quedar otra vez ocultos y deshabilitados.
  sincronizarCamposEspecificos();

  // 5) Estado de IA y precio de referencia
  // Sin foto tras el reset: el botón IA vuelve a estado inactivo.
  refrescarBotonesIA();
  refOpcional<HTMLElement>('iaStatus')?.classList.add('hidden');
  refOpcional<HTMLElement>('iaProgressContainer')?.classList.add('hidden');
  const precioRef = refOpcional<HTMLElement>('precioReferencia');
  if (precioRef) {
    precioRef.classList.add('hidden');
    precioRef.innerHTML = '';
  }
  refOpcional<HTMLElement>('segundaFotoSection')?.classList.add('hidden');

  // 6) Botón de envío en estado inicial
  submitBtn.disabled = false;
  submitText.classList.remove('hidden');
  submitSpinner.classList.add('hidden');

  // 7) Limpiar persistencia de la captura anterior (foto única + galería)
  try { sessionStorage.removeItem(CLAVE_FOTO_LEGADA); } catch (e) {}
  try { sessionStorage.removeItem(CLAVE_FOTOS); } catch (e) {}

  // 8) Subir al tope para empezar la captura siguiente (al abrir la pantalla el
  //    llamador lo desactiva para no mover el viewport del operador).
  if (opciones.desplazar !== false) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// =============================================================================
// MODAL DE ÉXITO - Control direccional tras guardar un objeto
// =============================================================================

/** Abre el modal de éxito (detiene el flujo visual tras el 201 Created). */
function abrirModalExito(): void {
  if (exitoModal) exitoModal.classList.remove('hidden');
}

/** Cierra el modal de éxito dejando al operador en la misma pantalla. */
function cerrarModalExito(): void {
  if (exitoModal) exitoModal.classList.add('hidden');
}

// =============================================================================
// ENVÍO DEL FORMULARIO - Guardar objeto + subir fotos (multipart multi-foto)
// =============================================================================

/** Valida y envía el formulario; en éxito resetea y abre el modal de éxito. */
async function enviarFormulario(e: Event): Promise<void> {
  e.preventDefault();
  const formOriginal = new FormData(e.target as HTMLFormElement);

  // Validación final: el nombre es obligatorio. El `required` nativo ya bloquea
  // el envío, pero se refuerza por si el formulario se dispara por código.
  if (!formOriginal.get('nombre')) {
    showToast('El nombre del objeto es obligatorio.', 'error');
    refOpcional<HTMLInputElement>('nombre')?.focus();
    return;
  }

  submitBtn.disabled = true;
  submitText.classList.add('hidden');
  submitSpinner.classList.remove('hidden');

  try {
    // Construir payload multipart del objeto.
    // Taxonomía unificada: NO se envía "tipo". El único selector de clasificación
    // es "categoria" (11 oficiales de Mercado Libre). Se omite todo valor vacío
    // para que DRF no intente parsear "" como UUID/entero en las FK opcionales.
    const formData = new FormData();
    const agregarSi = (clave: string, valor: FormDataEntryValue | null) => {
      if (valor !== null && valor !== undefined && String(valor).trim() !== '') {
        formData.append(clave, String(valor));
      }
    };
    agregarSi('nombre', formOriginal.get('nombre'));
    agregarSi('descripcion', formOriginal.get('descripcion'));
    agregarSi('categoria', formOriginal.get('categoria'));
    agregarSi('estado_conservacion', formOriginal.get('estado_conservacion') || 'bueno');
    agregarSi('color', formOriginal.get('color'));
    agregarSi('valor_estimado', formOriginal.get('valor_estimado'));
    agregarSi('ubicacion', formOriginal.get('ubicacion'));
    agregarSi('contenedor', formOriginal.get('contenedor'));
    agregarSi('dueno_original', formOriginal.get('dueno_original'));
    // Dueño EXTERNO (no usuario de la plataforma): string plano de metadata.
    agregarSi('dueno_externo_nombre', formOriginal.get('dueno_externo_nombre'));
    agregarSi('beneficiario', formOriginal.get('beneficiario'));

    // Lote 31 · punto 4 · ALTA RÁPIDA: clasificación OPCIONAL del objeto como
    // Caja o Mueble elegida con los disyuntores de ClasificacionAltaRapida.astro.
    // Se lee del DOM en este momento (sin estado duplicado) y viaja como
    // `es_contenedor` + `especificaciones.alta_rapida`. Sin casilla marcada se
    // envía `es_contenedor=false`: objeto simple, comportamiento histórico.
    for (const [clave, valor] of Object.entries(camposClasificacionAlta())) {
      formData.append(clave, valor);
    }

    // CAMPOS TÉCNICOS DE LA CATEGORÍA (Tecnología / Mueble-Arte / Libro / Ropa):
    // se leen del DOM en este instante y sólo viajan los de la familia ACTIVA
    // (los demás están `disabled`). `especificaciones` se mergea con la bandera
    // del alta rápida para no pisarla.
    agregarCamposEspecificosAlFormData(formData);

    // Adjuntar TODAS las fotos acumuladas bajo la clave 'fotos' (multi-foto).
    for (const foto of obtenerFotosObjeto()) {
      try {
        const blob = base64ToBlob(foto.base64);
        formData.append('fotos', blob, `foto_${foto.id}.jpg`);
      } catch (err) {
        console.warn('No se pudo convertir una foto de la galería a Blob:', err);
      }
    }

    // Crear el objeto + subir fotos en una única petición multipart con el JWT
    // explícito y refresco automático (services/auth/uploads).
    // NO se fija Content-Type: el navegador agrega el boundary solo.
    //
    // CONTEXTO MULTI-TENANT EXPLÍCITO (fix del 403 del tutorial): el POST viaja
    // SIEMPRE con `X-Estok-Id` leído de localStorage en este instante y con el
    // `X-CSRFToken` de la cookie de Django. `enviarFormData` ya los arma desde
    // services/auth, pero acá se REFUERZAN para el caso «acabo de fundar mi
    // Estok» (Paso 1 del asistente) y para la PWA que perdió la clave local:
    // sin ese header el backend responde 403 aunque el JWT sea válido.
    const estokId = getEstokActivoId();
    const csrfToken = getCsrfToken();
    const createResponse = await enviarFormData('/objetos/', formData, 'POST', {
      ...(estokId ? { 'X-Estok-Id': estokId } : {}),
      ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
    });

    if (!createResponse.ok) {
      let errorMsg = 'Error al crear el objeto';
      try {
        const errData = await createResponse.json();
        errorMsg = errData.detail || errData.error || JSON.stringify(errData);
      } catch {
        try {
          errorMsg = await createResponse.text();
        } catch {}
      }
      throw new Error(errorMsg);
    }

    // Éxito (201 Created): se lee el objeto creado ANTES de resetear (su id
    // alimenta el refresco en caliente de las tarjetas de /objetos).
    const objetoCreado = await createResponse.json().catch(() => null);

    // RESETEO ABSOLUTO del formulario y apertura del modal de confirmación. El
    // flujo visual se detiene: el operador decide direccionalmente entre
    // "Cargar otro" o "Volver al inicio".
    resetFormularioCompleto();
    // LATIDO GLOBAL DE ALMACENAMIENTO (post-tutorial): la barra lateral
    // («🧺 Elementos por ubicar» → objetos/cajas a reubicar), el tablero de
    // Almacenamiento y los visores recargan sus datos al instante, de modo que
    // el primer objeto guardado aparece YA en su ubicación o en «Objetos a
    // reubicar» sin necesidad de refrescar la página. Es el mismo evento único
    // que emiten todas las mutaciones espaciales de la app.
    window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    // REFRESCO ESPECÍFICO DEL INVENTARIO: /objetos y la barra lateral de
    // Almacenamiento escuchan `estok:objetos-cambiados` y repintan la tarjeta
    // del objeto recién guardado sin F5 y sin forzar «Espacio Único».
    window.dispatchEvent(
      new CustomEvent('estok:objetos-cambiados', { detail: objetoCreado }),
    );

    // PASO 4 DEL TUTORIAL («Guardar objeto y finalizar»): el asistente escucha
    // este evento, persiste el `estok_activo_id` en localStorage y RECIÉN
    // ENTONCES redirige a /almacenamiento. El modal de éxito vive sólo en
    // /objetos/nuevo, así que dentro del tutorial se sale por acá.
    if (document.documentElement.hasAttribute('data-estok-onboarding')) {
      window.dispatchEvent(
        new CustomEvent('estok:onboarding-finalizar', { detail: objetoCreado }),
      );
      return;
    }

    abrirModalExito();
  } catch (err) {
    showToast(`❌ ${mensajeError(err)}`, 'error');
    submitBtn.disabled = false;
    submitText.classList.remove('hidden');
    submitSpinner.classList.add('hidden');
  }
}

// =============================================================================
// INICIALIZACIÓN
// =============================================================================

/** Inicializa el reset de apertura, BFCache, modal de éxito y envío del formulario. */
export function initObjetoFormCore(): void {
  submitBtn = ref<HTMLButtonElement>('submitBtn');
  submitText = ref<HTMLElement>('submitText');
  submitSpinner = ref<HTMLElement>('submitSpinner');
  exitoModal = refOpcional<HTMLElement>('exitoModal');

  // APERTURA DE «NUEVO OBJETO»: reset absoluto SIEMPRE. El formulario aparece
  // limpio en cada visita (campos, foto/galería, IA, categoría y clasificación
  // rápida) sin heredar nada de una carga anterior. No se restaura sessionStorage.
  resetFormularioCompleto({ desplazar: false });

  // VISIBILIDAD INICIAL DE LOS CAMPOS TÉCNICOS: deja sólo el bloque de la
  // familia de la categoría vigente (tras el reset, ninguno).
  sincronizarCamposEspecificos();

  const objetoForm = refOpcional<HTMLFormElement>('objetoForm');
  if (objetoForm) {
    objetoForm.addEventListener('submit', (e) => void enviarFormulario(e));
  }

  // BFCACHE: cuando el navegador restaura la página desde caché (botón Atrás) el
  // DOM conserva el estado aunque sessionStorage ya se haya limpiado; se resetea
  // para no mostrar estado viejo.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      resetFormularioCompleto();
    }
  });

  // "Cargar otro": solo oculta el modal. resetFormularioCompleto() ya vació los
  // campos tras el guardado, así que el formulario queda listo para una nueva
  // carga inmediata sin recargar la página.
  refOpcional<HTMLButtonElement>('cargarOtroBtn')?.addEventListener('click', cerrarModalExito);

  // "Volver al inicio": redirección directa al Dashboard principal.
  refOpcional<HTMLButtonElement>('volverInicioBtn')?.addEventListener('click', () => {
    window.location.href = '/';
  });

  // Exponer el reseteo absoluto para uso externo (ej: cabecera superior) y debug
  (window as any).resetFormularioCompleto = resetFormularioCompleto;
}



