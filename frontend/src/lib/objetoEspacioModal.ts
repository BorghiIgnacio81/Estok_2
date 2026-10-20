// =============================================================================
// SECCIÓN DE OBJETO DENTRO DEL MODAL TÉCNICO DE EDICIÓN DE ESPACIOS
// -----------------------------------------------------------------------------
// El modal de Almacenamiento edita un Contenedor (nombre, medidas, grilla,
// foto). Cuando la pieza está declarada «Mueble / Objeto» (`declarado_movible`),
// este módulo inyecta los campos del Objeto espejo y los deja listos para que
// el PUT unificado del espacio los envíe PREFIJADOS (`objeto_*`).
//
// Fuente ÚNICA de los campos: lib/objetoEspacioCampos.ts (la misma que usa el
// panel del editor de espacios). Acá sólo vive el ciclo del modal: mostrar/
// ocultar, precargar al abrir y recolectar al guardar.
// =============================================================================

import { API_BASE_URL } from '../services/auth';
import {
  camposObjetoEspacioHtml,
  conectarCamposObjeto,
  obtenerControladorCamposObjeto,
} from './objetoEspacioCampos';

const HOST_ID = 'editarObjetoCampos';

function hostObjeto(): HTMLElement | null {
  return document.getElementById(HOST_ID);
}

/**
 * Muestra/oculta la sección y (re)carga los datos del Objeto espejo.
 * `contenedorId = null` limpia el formulario (alta o pieza no declarada).
 *
 * El markup se inyecta UNA sola vez: los listeners y las referencias de los
 * campos viven en el controlador conectado a ese nodo.
 */
export function prepararSeccionObjeto(
  contenedorId: string | null,
  visible: boolean,
): void {
  const host = hostObjeto();
  if (!host) return;
  host.classList.toggle('hidden', !visible);
  if (!visible) return;

  if (!host.dataset.inicializado) {
    host.innerHTML = `<p class="portal-objeto-propiedades-titulo">🧾 Datos del objeto (Mueble / Objeto)</p>
      <p class="portal-objeto-modal-ayuda">Dueño, categoría, estado, valor, notas, datos patrimoniales y fotos. Se guardan junto con el espacio en una sola operación.</p>
      ${camposObjetoEspacioHtml()}`;
    host.dataset.inicializado = '1';
  }

  const controlador = conectarCamposObjeto(host);
  if (contenedorId) {
    // Bloquea el guardado hasta terminar la precarga: así nunca se envían
    // valores por defecto que pisarían los datos reales del Objeto.
    const btnGuardar = document.getElementById('editarSaveBtn') as HTMLButtonElement | null;
    if (btnGuardar) btnGuardar.disabled = true;
    void controlador
      .cargar(`${API_BASE_URL}/contenedores/${contenedorId}/propiedades_objeto/`)
      .catch(() => {
        // Sin precarga, `recolectarSeccionObjeto()` devuelve null y el PUT del
        // espacio sigue sin tocar el objeto: nunca se pisan datos reales.
      })
      .finally(() => {
        if (btnGuardar) btnGuardar.disabled = false;
      });
  } else {
    controlador.limpiar();
  }
}

/**
 * Propiedades del objeto a enviar en el PUT unificado del espacio.
 * Devuelve null si la sección no está visible (pieza no declarada o alta).
 */
export function recolectarSeccionObjeto(): {
  datos: Record<string, string>;
  fotos: File[];
} | null {
  const host = hostObjeto();
  if (!host || host.classList.contains('hidden')) return null;
  const controlador = obtenerControladorCamposObjeto(host);
  if (!controlador || !controlador.estaListo()) return null;
  return controlador.recolectar();
}
