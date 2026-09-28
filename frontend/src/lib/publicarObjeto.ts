// =============================================================================
// PUBLICAR UN OBJETO (Mercado Libre / Facebook Marketplace)
// -----------------------------------------------------------------------------
// Comportamiento del modal de 2 pasos de la pestaña Decisiones:
//   1. elegir plataforma,
//   2. vista previa (fotos del objeto + anuncio generado por IA + precio de
//      referencia) y publicar.
//
// El markup vive en components/PublicarObjetoModal.astro; acá vive únicamente
// la lógica, para que la página quede por debajo de las 400 líneas (disciplina
// de modularidad del proyecto).
//
// Auth 100% centralizada (getAuthHeaders): JAMÁS se arma el header
// Authorization a mano ni se lee localStorage de tokens en este archivo.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { publicarEnMercadoLibre } from '../services/mercadolibre';

/** Objeto que se va a publicar (los datos que muestra el paso 1 del modal). */
export interface ObjetoPublicable {
  id: string;
  nombre: string;
  valor?: string | null;
}

type Plataforma = 'mercadolibre' | 'facebook';

// -----------------------------------------------------------------------------
// Estado del modal
// -----------------------------------------------------------------------------

let objetoId: string | null = null;
let plataforma: Plataforma | null = null;
let fotoSeleccionadaUrl: string | null = null;

// -----------------------------------------------------------------------------
// Acceso al DOM (los elementos existen recién cuando el componente se monta)
// -----------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function formatUSD(val: string | null | undefined): string {
  if (!val) return '—';
  const num = parseFloat(val);
  if (Number.isNaN(num)) return '—';
  return `$${num.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

// -----------------------------------------------------------------------------
// Pasos del modal
// -----------------------------------------------------------------------------

function resetModal(): void {
  el('modalPaso1')?.classList.remove('hidden');
  el('modalPaso2')?.classList.add('hidden');
  el('previewLoading')?.classList.add('hidden');
  el('previewForm')?.classList.add('hidden');
  const status = el('publicarStatus');
  status?.classList.add('hidden');
  if (status) status.textContent = '';
  const titulo = el('modalTitulo');
  if (titulo) titulo.textContent = '📢 Publicar objeto';
}

/** Abre el modal en el paso 1 (elegir plataforma) para el objeto indicado. */
export function abrirPublicarObjeto(objeto: ObjetoPublicable): void {
  objetoId = objeto.id;
  plataforma = null;
  resetModal();

  const nombre = el('publicarObjetoNombre');
  if (nombre) nombre.textContent = objeto.nombre;
  const valor = el('publicarObjetoValor');
  if (valor) valor.textContent = objeto.valor ? `Valor estimado: ${formatUSD(objeto.valor)}` : '';

  el('publicarModal')?.classList.remove('hidden');
}

/** Cierra el modal y vuelve al paso 1. */
export function cerrarPublicarObjeto(): void {
  el('publicarModal')?.classList.add('hidden');
  objetoId = null;
  plataforma = null;
  resetModal();
}

function mostrarStatus(tipo: 'success' | 'error' | 'info', msg: string): void {
  const status = el('publicarStatus');
  if (!status) return;
  status.classList.remove('hidden');
  status.className = `p-3 rounded-lg text-sm ${
    tipo === 'success'
      ? 'bg-green-50 text-green-700'
      : tipo === 'error'
        ? 'bg-red-50 text-red-700'
        : 'bg-blue-50 text-blue-700'
  }`;
  status.innerHTML = msg;
}

/**
 * Paso 2: verifica la vinculación de ML (si corresponde), trae la vista previa
 * del anuncio y llena el formulario.
 */
async function irAPaso2(nuevaPlataforma: Plataforma): Promise<void> {
  if (!objetoId) return;
  plataforma = nuevaPlataforma;

  const titulo = el('modalTitulo');
  if (titulo) {
    titulo.textContent = nuevaPlataforma === 'mercadolibre'
      ? '🛒 Publicar en Mercado Libre'
      : '📘 Publicar en Facebook Marketplace';
  }

  el('modalPaso1')?.classList.add('hidden');
  el('modalPaso2')?.classList.remove('hidden');
  el('previewLoading')?.classList.remove('hidden');
  el('previewForm')?.classList.add('hidden');
  el('publicarStatus')?.classList.add('hidden');

  try {
    if (nuevaPlataforma === 'mercadolibre') {
      const respAuth = await fetch(`${API_BASE_URL}/mercadolibre/auth-status/`, {
        headers: getAuthHeaders(),
      });
      if (respAuth.ok) {
        const authData = await respAuth.json();
        if (!authData.conectado) {
          el('previewLoading')?.classList.add('hidden');
          mostrarStatus(
            'info',
            `<p class="font-semibold mb-2">⚠️ No tenés tu cuenta de Mercado Libre conectada.</p>
             <p class="text-xs mb-3">Para publicar directamente necesitás vincular tu cuenta.</p>
             <button id="btnConectarML" class="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-base shadow-sm w-full">
               🔗 Conectar cuenta de Mercado Libre
             </button>`,
          );
          el('btnConectarML')?.addEventListener('click', async () => {
            const respUrl = await fetch(`${API_BASE_URL}/mercadolibre/auth-url/`, {
              headers: getAuthHeaders(),
            });
            if (respUrl.ok) {
              const data = await respUrl.json();
              window.open(data.auth_url, 'ml_oauth_popup');
            }
          });
          return;
        }
      }
    }

    const respPreview = await fetch(
      `${API_BASE_URL}/objetos/${objetoId}/preview_publicacion/`,
      { headers: getAuthHeaders() },
    );
    if (!respPreview.ok) throw new Error(`Error ${respPreview.status}`);

    llenarFormulario(await respPreview.json(), nuevaPlataforma);
  } catch (err) {
    el('previewLoading')?.classList.add('hidden');
    const mensaje = err instanceof Error ? err.message : 'Error al cargar vista previa';
    mostrarStatus('error', `❌ ${mensaje}`);
  }
}

function llenarFormulario(preview: any, plataformaActual: string): void {
  el('previewLoading')?.classList.add('hidden');
  el('previewForm')?.classList.remove('hidden');

  // Fotos
  const fotoSelector = el('fotoSelector');
  if (fotoSelector) {
    if (preview.fotos && preview.fotos.length > 0) {
      fotoSeleccionadaUrl = preview.fotos[0].url;
      fotoSelector.innerHTML = preview.fotos.map((f: any, i: number) => `
        <div class="foto-thumb flex-shrink-0 w-20 h-20 rounded-lg border-2 overflow-hidden cursor-pointer ${i === 0 ? 'border-blue-500' : 'border-gray-200 hover:border-gray-400'}" data-url="${f.url || ''}">
          ${f.url ? `<img src="${f.url}" alt="Foto ${i + 1}" class="w-full h-full object-cover" />` : '<div class="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs">Sin foto</div>'}
        </div>
      `).join('');

      fotoSelector.querySelectorAll('.foto-thumb').forEach((thumb) => {
        thumb.addEventListener('click', () => {
          fotoSelector.querySelectorAll('.foto-thumb').forEach((t) => {
            t.classList.remove('border-blue-500');
            t.classList.add('border-gray-200');
          });
          thumb.classList.add('border-blue-500');
          thumb.classList.remove('border-gray-200');
          fotoSeleccionadaUrl = (thumb as HTMLElement).dataset.url || null;
        });
      });
    } else {
      fotoSeleccionadaUrl = null;
      fotoSelector.innerHTML = '<p class="text-xs text-gray-400">Sin fotos disponibles</p>';
    }
  }

  // Título y descripción desde IA
  const anuncio = preview.anuncios?.[plataformaActual];
  const inputTitulo = el<HTMLInputElement>('inputTitulo');
  const inputDescripcion = el<HTMLTextAreaElement>('inputDescripcion');
  if (inputTitulo) inputTitulo.value = anuncio?.titulo || preview.objeto?.nombre || '';
  if (inputDescripcion) {
    inputDescripcion.value = anuncio?.descripcion || preview.objeto?.descripcion || '';
  }

  // Precio
  const inputPrecio = el<HTMLInputElement>('inputPrecio');
  const precioRefInfo = el('precioRefInfo');
  if (preview.precio_referencia?.precio_ajustado) {
    if (inputPrecio) inputPrecio.value = String(preview.precio_referencia.precio_ajustado);
    if (precioRefInfo) {
      precioRefInfo.textContent = `Precio de referencia ajustado por estado (${preview.precio_referencia.fuente || 'ML'})`;
    }
  } else {
    if (inputPrecio) inputPrecio.value = preview.objeto?.valor_estimado || '';
    if (precioRefInfo) precioRefInfo.textContent = 'Precio estimado del inventario';
  }

  // Botón publicar
  const btnPublicar = el<HTMLButtonElement>('btnPublicarAhora');
  if (!btnPublicar) return;
  btnPublicar.className = plataformaActual === 'mercadolibre'
    ? 'w-full px-4 py-2.5 text-sm font-semibold text-white bg-yellow-500 hover:bg-yellow-600 rounded-lg transition-base shadow-sm'
    : 'w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-base shadow-sm';
  btnPublicar.textContent = plataformaActual === 'mercadolibre'
    ? '🛒 Publicar en Mercado Libre'
    : '📘 Marcar como publicado en Facebook';
  btnPublicar.onclick = () => void publicarAhora();
}

// -----------------------------------------------------------------------------
// Publicación
// -----------------------------------------------------------------------------

async function publicarAhora(): Promise<void> {
  if (!objetoId || !plataforma) return;

  if (plataforma === 'facebook') {
    const titulo = el<HTMLInputElement>('inputTitulo')?.value || '';
    const precio = el<HTMLInputElement>('inputPrecio')?.value || '';
    const descripcion = el<HTMLTextAreaElement>('inputDescripcion')?.value || '';
    const texto = `${titulo}\n\n💰 $${precio} USD\n\n${descripcion}\n\n📸 ${fotoSeleccionadaUrl || 'Sin foto'}`;

    try {
      await navigator.clipboard.writeText(texto);
      mostrarStatus('success', '✅ Texto copiado al portapapeles. Ahora pegalo en Facebook Marketplace.');
    } catch {
      mostrarStatus('info', '📋 No se pudo copiar automáticamente. Seleccioná el texto manualmente.');
    }

    await marcarPublicado('facebook');
    return;
  }

  // Mercado Libre: publicación real vía API
  mostrarStatus('info', '⏳ Analizando categoría y publicando en Mercado Libre...');
  const titulo = el<HTMLInputElement>('inputTitulo')?.value || '';
  const precio = el<HTMLInputElement>('inputPrecio')?.value || '0';
  const descripcion = el<HTMLTextAreaElement>('inputDescripcion')?.value || '';

  try {
    const result = await publicarEnMercadoLibre({
      objetoId,
      titulo,
      precio: parseFloat(precio),
      descripcion,
      fotoUrl: fotoSeleccionadaUrl || undefined,
    });
    // Se muestra la categoría REAL con la que se publicó (mapeo de la BD o
    // predicción por nombre de categoría) y cuántas fotos se enviaron, para
    // detectar de inmediato cualquier desvío de categoría o foto faltante.
    const detalle = result.category_id
      ? `<br><span class="text-xs">Categoría ML: ${result.category_id}` +
        `${result.categoria_estok ? ` (${result.categoria_estok})` : ''}` +
        ` · Fotos enviadas: ${result.fotos_enviadas ?? 0}</span>`
      : '';
    mostrarStatus(
      'success',
      `✅ ¡Publicado en Mercado Libre!${detalle}<br><a href="${result.permalink}" target="_blank" class="underline text-blue-700">Ver publicación →</a>`,
    );
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : 'Error al publicar en Mercado Libre';
    mostrarStatus('error', `❌ ${mensaje}`);
  }
}

/** Registra la publicación en el backend (no es crítico si falla). */
async function marcarPublicado(plataformaPublicada: Plataforma): Promise<void> {
  if (!objetoId) return;
  try {
    await fetch(`${API_BASE_URL}/objetos/${objetoId}/publicar_en/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ plataforma: plataformaPublicada }),
    });
  } catch {
    // Silencioso: la publicación en sí ya se resolvió.
  }
}

// -----------------------------------------------------------------------------
// Arranque (idempotente)
// -----------------------------------------------------------------------------

/**
 * Enlaza el modal una sola vez (idempotente): cierre, pasos y el callback del
 * popup de OAuth de Mercado Libre.
 */
export function iniciarModalPublicar(): void {
  const modal = el('publicarModal');
  if (!modal || modal.dataset.activo === 'true') return;
  modal.dataset.activo = 'true';

  el('cerrarPublicarModalBtn')?.addEventListener('click', cerrarPublicarObjeto);
  modal.addEventListener('click', (evento) => {
    if (evento.target === modal) cerrarPublicarObjeto();
  });
  el('btnElegirML')?.addEventListener('click', () => void irAPaso2('mercadolibre'));
  el('btnElegirFB')?.addEventListener('click', () => void irAPaso2('facebook'));
  el('btnVolverPaso1')?.addEventListener('click', resetModal);

  // Callback del popup de OAuth de Mercado Libre: si la cuenta se conectó,
  // se regenera la vista previa del paso 2.
  window.addEventListener('message', (evento) => {
    if (evento.data?.type !== 'ml_connected' || !evento.data?.success) return;
    if (!modal.classList.contains('hidden') && plataforma === 'mercadolibre') {
      void irAPaso2('mercadolibre');
    }
  });
}
