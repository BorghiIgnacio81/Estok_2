// =============================================================================
// MODAL "INVITAR MIEMBROS" (Estok)
//
// Interfaz transaccional ÚNICA (sin pestañas): un solo formulario que genera el
// código de invitación y, opcionalmente, lo despacha por email.
//
//   - Rol FIJO: "Solo lectura" (Visualizador) o "Lectura y edición" (Editor).
//   - Estok de destino: con 2 o más inquilinatos aparece el combobox
//     "Seleccionar Estok de destino" (preseleccionado en el Estok activo); con
//     uno solo queda oculto y su ID viaja automático en el payload.
//   - Caducidad FIJA: el código muere en su cuarto uso (USOS_MAXIMOS_INVITACION).
//   - Destinatario: email o nombre de usuario, según el switch "Es usuario de
//     Estok". El backend acepta cualquiera de los dos para la vinculación.
//   - Checkbox "y enviar email": agrega `enviar_email: true` al payload para que
//     Django despache la invitación con el SMTP ya saneado (email_service.py).
//
// El HTML se construye acá (y no en BaseLayout.astro) para mantener el layout
// por debajo del límite de líneas del proyecto. Los estilos son las mismas
// clases Tailwind del resto de los modales (con el remapeo dark mode de
// global.css aplicado sobre bg-white / text-gray-* / border-gray-*).
// =============================================================================

import {
  getEstokActivoId,
  fetchRoles,
  generarCodigoInvitacion,
  USOS_MAXIMOS_INVITACION,
  ROLES_INVITACION,
} from '../services/auth';
import type { CodigoInvitacionCreado } from '../services/auth';
import {
  bloqueEstokHtml,
  escaparHtml,
  estokPreseleccionado,
  estoksDelUsuario,
} from './invitacionEstok';

const MODAL_ID = 'invitarModal';

/**
 * Cartel fijo de caducidad. El número coincide con USOS_MAXIMOS_INVITACION:
 * el backend valida `usos_actuales >= usos_maximos`, o sea, muere en el 4º uso.
 */
const AVISO_CADUCIDAD = 'Este código caducará automáticamente en su cuarto uso';

/** Nota sutil del modo "usuario de Estok" (se muestra solo con el switch activo). */
const NOTA_USUARIO =
  'Si no recuerdas su nombre de usuario, puedes ingresar su email igualmente';

/** Etiqueta visible de un rol fijo a partir de su nombre en el backend. */
function etiquetaRol(nombreBackend: string): string {
  return (
    ROLES_INVITACION.find((r) => r.nombreBackend === nombreBackend)?.etiqueta ??
    nombreBackend
  );
}

/**
 * Devuelve un resolvedor perezoso `Role.name` -> UUID.
 *
 * Se dispara al abrir el modal para que la UI NUNCA muestre un cartel de
 * "cargando roles...": el selector ya tiene sus dos opciones fijas desde el
 * primer render y el UUID real se resuelve recién al generar el código.
 */
function crearResolverDeRoles(): () => Promise<Record<string, string>> {
  let mapa: Record<string, string> | null = null;
  let enCurso: Promise<void> | null = null;

  return async function resolver(): Promise<Record<string, string>> {
    if (!enCurso) {
      enCurso = fetchRoles()
        .then((roles) => {
          mapa = Object.fromEntries(roles.map((r) => [r.name, r.id]));
        })
        .catch(() => {
          // Silencioso a propósito: el fallo se reporta al intentar generar.
          mapa = {};
        });
    }
    await enCurso;
    return mapa ?? {};
  };
}

// =============================================================================
// ESTRUCTURA DE LA TARJETA ÚNICA
// =============================================================================

function construirHtml(bloqueEstok: string): string {
  const opcionesRol = ROLES_INVITACION.map(
    (r) => `<option value="${escaparHtml(r.nombreBackend)}">${escaparHtml(r.etiqueta)}</option>`
  ).join('');

  return `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-auto overflow-hidden">
      <!-- Header -->
      <div class="flex items-start justify-between px-6 py-4 border-b border-gray-200">
        <div>
          <h3 class="text-lg font-bold text-gray-900">Invitar miembros</h3>
          <p class="text-xs text-gray-500 mt-0.5">Generá un código de acceso y compartilo</p>
        </div>
        <button id="invCerrarBtn" type="button" aria-label="Cerrar"
          class="p-1 -mr-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-base">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="p-6 space-y-5">${bloqueEstok}

        <!-- Permisos: dos opciones fijas -->
        <div>
          <label for="invRol" class="block text-sm font-medium text-gray-700 mb-1">Permisos del invitado</label>
          <select id="invRol"
            class="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-base cursor-pointer">
            ${opcionesRol}
          </select>
        </div>

        <!-- Caducidad fija -->
        <div class="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
          <span class="text-base leading-none mt-0.5" aria-hidden="true">⏳</span>
          <p class="text-xs font-medium text-amber-800">${AVISO_CADUCIDAD}</p>
        </div>

        <!-- Destinatario + switch "Es usuario de Estok" -->
        <div>
          <div class="flex items-center justify-between gap-3 mb-1">
            <label id="invDestinatarioLabel" for="invDestinatario" class="text-sm font-medium text-gray-700">Email</label>
            <label class="inline-flex items-center gap-2 cursor-pointer select-none">
              <span class="text-xs font-medium text-gray-600">Es usuario de Estok</span>
              <input id="invEsUsuario" type="checkbox" role="switch" aria-label="Es usuario de Estok" class="peer sr-only" />
              <span aria-hidden="true"
                class="relative w-10 h-5 shrink-0 rounded-full bg-gray-300 transition-base peer-checked:bg-blue-700 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"></span>
            </label>
          </div>
          <input id="invDestinatario" type="email" autocomplete="off" spellcheck="false" placeholder="Ej: nombre@dominio.com"
            class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-base" />
          <p id="invNotaUsuario" class="hidden mt-1.5 text-xs text-gray-500">${NOTA_USUARIO}</p>
        </div>

        <!-- Acción principal + envío por email -->
        <div class="space-y-3">
          <button id="invGenerarBtn" type="button"
            class="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-base disabled:opacity-50 disabled:cursor-not-allowed shadow-sm">
            Generar código
          </button>
          <label class="flex items-center justify-center gap-2 cursor-pointer select-none">
            <input id="invEnviarEmail" type="checkbox"
              class="w-4 h-4 rounded border-gray-300 accent-blue-700 cursor-pointer" />
            <span class="text-sm font-medium text-gray-600">y enviar email</span>
          </label>
        </div>

        <!-- Resultado -->
        <div id="invExito" class="hidden p-4 bg-green-50 border border-green-200 rounded-lg">
          <p class="text-xs text-green-700 font-medium mb-2">✅ Código generado exitosamente</p>
          <div class="flex items-center gap-2">
            <code id="invCodigoTexto"
              class="flex-1 px-3 py-2 bg-white border border-green-300 rounded-lg text-lg font-mono font-bold text-green-800 text-center tracking-wider select-all"></code>
            <button id="invCopiarBtn" type="button"
              class="px-3 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-base shadow-sm whitespace-nowrap">
              Copiar
            </button>
          </div>
        </div>

        <div id="invError" class="hidden p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"></div>
      </div>
    </div>
  `;
}

// =============================================================================
// APERTURA E INTERACCIÓN
// =============================================================================

export function abrirModalInvitacion(): void {
  // Evitar duplicados (navbar desktop y mobile comparten este modal).
  if (document.getElementById(MODAL_ID)) return;

  // Estoks a los que tiene acceso la cuenta (estado global de sesión, mismo
  // origen que el dropdown "Mis Estoks" del Navbar): con 2 o más se muestra el
  // combobox y arranca en el Estok activo.
  const estoks = estoksDelUsuario();
  const estokSeleccionado = estokPreseleccionado(estoks, getEstokActivoId());

  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.className =
    'fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4';
  overlay.innerHTML = construirHtml(bloqueEstokHtml(estoks, estokSeleccionado));
  document.body.appendChild(overlay);

  // --- Referencias DOM -------------------------------------------------------
  const buscar = <T extends HTMLElement>(id: string): T => overlay.querySelector(id) as T;

  // Combobox de Estok de destino: solo existe cuando la cuenta administra 2 o
  // más inquilinatos (con uno solo el ID viaja automático en el payload).
  const estokSelect = overlay.querySelector<HTMLSelectElement>('#invEstok');
  const rolSelect = buscar<HTMLSelectElement>('#invRol');
  const destinatarioLabel = buscar<HTMLLabelElement>('#invDestinatarioLabel');
  const destinatarioInput = buscar<HTMLInputElement>('#invDestinatario');
  const notaUsuario = buscar<HTMLParagraphElement>('#invNotaUsuario');
  const switchEsUsuario = buscar<HTMLInputElement>('#invEsUsuario');
  const checkEmail = buscar<HTMLInputElement>('#invEnviarEmail');
  const generarBtn = buscar<HTMLButtonElement>('#invGenerarBtn');
  const copiarBtn = buscar<HTMLButtonElement>('#invCopiarBtn');
  const codigoTexto = buscar<HTMLElement>('#invCodigoTexto');
  const cajaExito = buscar<HTMLDivElement>('#invExito');
  const cajaError = buscar<HTMLDivElement>('#invError');

  const resolverRoles = crearResolverDeRoles();
  void resolverRoles(); // precarga silenciosa: sin cartel de "cargando roles..."

  // --- Switch "Es usuario de Estok": etiqueta y placeholder reactivos ---------
  function sincronizarDestinatario(): void {
    const esUsuario = switchEsUsuario.checked;
    destinatarioLabel.textContent = esUsuario ? 'Nombre de usuario' : 'Email';
    destinatarioInput.placeholder = esUsuario ? 'Ej: juanperez' : 'Ej: nombre@dominio.com';
    destinatarioInput.type = esUsuario ? 'text' : 'email';
    destinatarioInput.spellcheck = !esUsuario;
    notaUsuario.classList.toggle('hidden', !esUsuario);
  }
  switchEsUsuario.addEventListener('change', sincronizarDestinatario);
  sincronizarDestinatario();

  // --- Feedback --------------------------------------------------------------
  function mostrarError(msg: string): void {
    cajaError.textContent = msg;
    cajaError.classList.remove('hidden');
    cajaExito.classList.add('hidden');
  }

  function notificarEnvio(data: CodigoInvitacionCreado, destinatario: string): void {
    const toasts = window as unknown as {
      showSuccess?: (m: string) => void;
      showInfo?: (m: string) => void;
    };
    if (data.email_enviado) {
      toasts.showSuccess?.(`📧 Invitación enviada a ${destinatario}`);
      return;
    }
    toasts.showInfo?.(
      `⚠️ ${data.email_aviso || 'No se pudo enviar el email: compartí el código manualmente.'}`
    );
  }

  // --- Generación del código -------------------------------------------------
  async function generar(): Promise<void> {
    const destinatario = destinatarioInput.value.trim();
    const quiereEmail = checkEmail.checked;

    cajaError.classList.add('hidden');

    if (quiereEmail && !destinatario) {
      mostrarError('Ingresá un email o un nombre de usuario para enviar la invitación.');
      return;
    }

    cajaExito.classList.add('hidden');
    generarBtn.textContent = 'Generando...';
    generarBtn.disabled = true;

    try {
      // El código se crea en el Estok elegido en el combobox (o en el único al
      // que pertenece la cuenta): ese ID es el que viaja como X-Estok-Id.
      const estokId = (estokSelect?.value || estokSeleccionado).trim();
      if (!estokId) {
        throw new Error(
          'No se pudo determinar el Estok de destino. Recargá la página e intentá de nuevo.'
        );
      }

      const mapaRoles = await resolverRoles();
      const roleId = mapaRoles[rolSelect.value];
      if (!roleId) {
        throw new Error(`El rol "${etiquetaRol(rolSelect.value)}" no está disponible en el sistema.`);
      }

      const data = await generarCodigoInvitacion(estokId, roleId, {
        usos_maximos: USOS_MAXIMOS_INVITACION,
        invitado: destinatario || undefined,
        es_usuario_estok: switchEsUsuario.checked,
        enviar_email: quiereEmail,
      });

      codigoTexto.textContent = data.codigo;
      cajaExito.classList.remove('hidden');
      if (quiereEmail) notificarEnvio(data, destinatario);
    } catch (err) {
      const fallo = err as { error?: string; message?: string } | null;
      mostrarError(
        fallo?.error || fallo?.message || 'No se pudo generar el código. Intentá de nuevo.'
      );
    } finally {
      generarBtn.textContent = 'Generar código';
      generarBtn.disabled = false;
    }
  }

  generarBtn.addEventListener('click', () => {
    void generar();
  });
  destinatarioInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void generar();
    }
  });

  // --- Copiar al portapapeles ------------------------------------------------
  copiarBtn.addEventListener('click', () => {
    const codigo = codigoTexto.textContent;
    if (!codigo) return;
    navigator.clipboard
      .writeText(codigo)
      .then(() => {
        copiarBtn.textContent = '✅ Copiado';
        setTimeout(() => {
          copiarBtn.textContent = 'Copiar';
        }, 2000);
      })
      .catch(() => {
        const range = document.createRange();
        range.selectNodeContents(codigoTexto);
        const seleccion = window.getSelection();
        seleccion?.removeAllRanges();
        seleccion?.addRange(range);
      });
  });

  // --- Cierre -----------------------------------------------------------------
  function cerrar(): void {
    document.removeEventListener('keydown', alPresionarTecla);
    overlay.remove();
  }

  function alPresionarTecla(e: KeyboardEvent): void {
    if (e.key === 'Escape') cerrar();
  }

  buscar<HTMLButtonElement>('#invCerrarBtn').addEventListener('click', cerrar);
  document.addEventListener('keydown', alPresionarTecla);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrar();
  });
}
