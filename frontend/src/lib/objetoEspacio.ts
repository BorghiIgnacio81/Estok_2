// =============================================================================
// PROPIEDADES DEL OBJETO DE UN ESPACIO DECLARADO («Mueble / Objeto»)
// -----------------------------------------------------------------------------
// Cuando el operador tilda «🎒 Declarar como Mueble / Objeto» en el editor de
// espacios, este bloque despliega TODOS los datos del Objeto espejo:
//   · Dueño / Propietario  → miembros del Estok
//   · Categoría            → catálogo del Estok (default «Muebles»)
//   · Estado de conservación
//   · Valor estimado       → pesos ARS (sin sufijo USD)
//   · Notas / Descripción y campos patrimoniales adicionales
//   · Fotos                → galería múltiple + cámara directa
//
// El markup y la precarga/recolección viven en `objetoEspacioCampos.ts`, fuente
// ÚNICA compartida con el modal de edición de espacios.
//
// Persistencia: PUT multipart a `/contenedores/{id}/guardar_propiedades_objeto/`.
// Carga: GET `/contenedores/{id}/propiedades_objeto/` (precarga el formulario
// al abrir una pieza ya declarada). La autoridad de dominio y la dualidad
// Contenedor ⇄ Objeto viven en `inventario/services/objeto_espacio.py`.
//
// Auth centralizada: los headers salen SIEMPRE de services/auth.
// =============================================================================

import { API_BASE_URL, enviarFormData } from '../services/auth';
import { camposObjetoEspacioHtml, conectarCamposObjeto } from './objetoEspacioCampos';
import { showToast } from './toast';

/** Nodo mínimo del motor de portales que necesita este bloque. */
export interface NodoEspacioObjeto {
  tipo: string;
  id: string;
}

/**
 * Markup del bloque de propiedades. Nace OCULTO salvo que la pieza ya esté
 * declarada (`visible = declarado_movible`): el `change` del checkbox lo
 * muestra/oculta sin recargar.
 */
export function propiedadesObjetoEspacioHtml(visible: boolean): string {
  return `<div class="portal-objeto-propiedades" data-objeto-propiedades${visible ? '' : ' hidden'}>
    <p class="portal-objeto-propiedades-titulo">🧾 Propiedades del objeto declarado</p>
    ${camposObjetoEspacioHtml()}
    <div class="portal-objeto-propiedades-pie">
      <button type="button" class="portal-objeto-guardar" data-objeto-guardar>💾 Guardar datos del objeto</button>
      <span class="portal-objeto-guardado" data-objeto-guardado role="status"></span>
    </div>
  </div>`;
}

/**
 * Conecta el bloque de propiedades del espacio activo. Idempotente por render:
 * el host vuelve a llamarlo cada vez que repinta el panel.
 */
export function conectarPropiedadesObjetoEspacio(
  scope: ParentNode,
  nodo: NodoEspacioObjeto,
): void {
  // Sólo los Contenedores tienen Objeto espejo (la Ubicación no lo expone).
  if (nodo.tipo !== 'contenedor') return;

  const bloque = scope.querySelector<HTMLElement>('[data-objeto-propiedades]');
  const casilla = scope.querySelector<HTMLInputElement>('[data-mueble-movil]');
  if (!bloque || !casilla) return;

  const controlador = conectarCamposObjeto(bloque);
  const btnGuardar = bloque.querySelector<HTMLButtonElement>('[data-objeto-guardar]');
  const estadoGuardado = bloque.querySelector<HTMLElement>('[data-objeto-guardado]');
  if (!btnGuardar) return;

  let datosCargados = false;
  let cargando: Promise<void> | null = null;

  /** Muestra u oculta el bloque según el disyuntor de movilidad. */
  const reflejarVisibilidad = (): void => {
    bloque.hidden = !casilla.checked;
  };

  /** Catálogos + propiedades guardadas (precarga completa del formulario). */
  const cargarDatos = async (): Promise<void> => {
    if (datosCargados) return;
    if (cargando) return cargando;
    // El botón se habilita recién al terminar la precarga: guardar antes
    // enviaría valores por defecto y pisaría los datos reales del Objeto.
    btnGuardar.disabled = true;
    cargando = controlador
      .cargar(`${API_BASE_URL}/contenedores/${nodo.id}/propiedades_objeto/`)
      .then(() => {
        datosCargados = true;
      })
      .catch(() => {
        showToast(
          'No se pudieron cargar los datos del objeto. Volvé a intentarlo.',
          'error',
        );
      })
      .finally(() => {
        btnGuardar.disabled = false;
        cargando = null;
      });
    return cargando;
  };

  reflejarVisibilidad();
  casilla.addEventListener('change', () => {
    reflejarVisibilidad();
    if (casilla.checked) void cargarDatos();
  });
  // Precarga inmediata: una pieza ya declarada abre el espacio con sus datos.
  if (casilla.checked) void cargarDatos();



  btnGuardar.addEventListener('click', () => {
    void (async () => {
      if (!casilla.checked) {
        showToast('Primero declará el espacio como Mueble / Objeto.', 'warning');
        return;
      }
      if (!controlador.estaListo()) {
        showToast('Los datos del objeto todavía no terminaron de cargar.', 'warning');
        return;
      }

      // PUT multipart: TODOS los campos del objeto + las fotos nuevas
      // (galería o cámara) viajan en la MISMA petición.
      const { datos, fotos } = controlador.recolectar();
      const formData = new FormData();
      Object.entries(datos).forEach(([clave, valor]) => formData.append(clave, valor));
      fotos.forEach((foto) => formData.append('fotos', foto));

      btnGuardar.disabled = true;
      if (estadoGuardado) estadoGuardado.textContent = 'Guardando...';
      try {
        const res = await enviarFormData(
          `/contenedores/${nodo.id}/guardar_propiedades_objeto/`,
          formData,
          'PUT',
        );
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const crudo = data as Record<string, unknown>;
          const detalle =
            crudo?.detail ||
            Object.values(crudo).flat().join(', ') ||
            'No se pudieron guardar las propiedades.';
          showToast(`❌ ${detalle}`, 'error');
          if (estadoGuardado) estadoGuardado.textContent = '';
          return;
        }
        // La respuesta trae el estado completo (incluidas las fotos ya
        // persistidas): se repinta el formulario con ella.
        controlador.precargar(data);
        datosCargados = true;
        if (estadoGuardado) estadoGuardado.textContent = 'Guardado ✓';
        showToast('✅ Propiedades del objeto guardadas.', 'success');
        window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
      } catch {
        showToast('❌ Error de conexión al guardar las propiedades.', 'error');
        if (estadoGuardado) estadoGuardado.textContent = '';
      } finally {
        btnGuardar.disabled = false;
        window.setTimeout(() => {
          if (estadoGuardado) estadoGuardado.textContent = '';
        }, 2500);
      }
    })();
  });
}
