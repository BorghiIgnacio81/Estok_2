// =============================================================================
// PROPIEDADES DEL OBJETO DE UN ESPACIO DECLARADO («Mueble / Objeto»)
// -----------------------------------------------------------------------------
// Cuando el operador tilda «🎒 Declarar como Mueble / Objeto» en el editor de
// espacios, este bloque despliega los datos del Objeto espejo del Contenedor:
//   · Dueño / Propietario  → miembros del Estok
//   · Categoría            → catálogo del Estok (default «Muebles»)
//   · Estado de conservación
//   · Valor estimado       → pesos ARS (sin sufijo USD)
//
// Persistencia: PUT parcial a `/contenedores/{id}/guardar_propiedades_objeto/`.
// Carga: GET `/contenedores/{id}/propiedades_objeto/` (precarga el formulario
// al abrir una pieza ya declarada). La autoridad de dominio y la dualidad
// Contenedor ⇄ Objeto viven en `inventario/services/objeto_espacio.py`.
//
// Auth centralizada: getAuthHeaders()/API_BASE_URL SIEMPRE desde services/auth.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../services/auth';
import {
  cargarCategoriasEstok,
  cargarUsuariosEstok,
  categoriaMueblePorDefecto,
} from './catalogosEstok';
import type { CategoriaEstok } from './catalogosEstok';
import { showToast } from './toast';

/** Nodo mínimo del motor de portales que necesita este bloque. */
export interface NodoEspacioObjeto {
  tipo: string;
  id: string;
}

/** Estados canónicos de Objeto.estado_conservacion con rótulos de operador. */
const ESTADOS_CONSERVACION = [
  { valor: 'excelente', etiqueta: 'Nuevo / Excelente' },
  { valor: 'bueno', etiqueta: 'Buen estado' },
  { valor: 'regular', etiqueta: 'Regular' },
  { valor: 'malo', etiqueta: 'A reparar' },
  { valor: 'muy_malo', etiqueta: 'Muy deteriorado' },
] as const;

/**
 * Markup del bloque de propiedades. Nace OCULTO salvo que la pieza ya esté
 * declarada (`visible = declarado_movible`): el `change` del checkbox lo
 * muestra/oculta sin recargar.
 */
export function propiedadesObjetoEspacioHtml(visible: boolean): string {
  const opcionesEstado = ESTADOS_CONSERVACION
    .map((e) => `<option value="${e.valor}">${e.etiqueta}</option>`)
    .join('');
  return `<div class="portal-objeto-propiedades" data-objeto-propiedades${visible ? '' : ' hidden'}>
    <p class="portal-objeto-propiedades-titulo">🧾 Propiedades del objeto declarado</p>
    <div class="portal-objeto-propiedades-grid">
      <label class="portal-objeto-campo">
        <span>Dueño / Propietario</span>
        <select data-objeto-dueno>
          <option value="">Seleccionar dueño...</option>
        </select>
      </label>
      <label class="portal-objeto-campo">
        <span>Categoría</span>
        <select data-objeto-categoria>
          <option value="">Seleccionar categoría...</option>
        </select>
      </label>
      <label class="portal-objeto-campo">
        <span>Estado de conservación</span>
        <select data-objeto-estado>${opcionesEstado}</select>
      </label>
      <label class="portal-objeto-campo">
        <span>Valor estimado</span>
        <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" data-objeto-valor />
      </label>
    </div>
    <div class="portal-objeto-propiedades-pie">
      <button type="button" class="portal-objeto-guardar" data-objeto-guardar>💾 Guardar datos del objeto</button>
      <span class="portal-objeto-guardado" data-objeto-guardado role="status"></span>
    </div>
  </div>`;
}

/** Agrega una opción al select si su valor todavía no está listado. */
function asegurarOpcion(select: HTMLSelectElement, valor: string, texto: string): void {
  if (!valor) return;
  if ([...select.options].some((o) => o.value === valor)) return;
  const opcion = document.createElement('option');
  opcion.value = valor;
  opcion.textContent = texto || valor;
  select.appendChild(opcion);
}

/** Payload GET/PUT de propiedades del objeto espejo. */
interface PropiedadesObjetoRespuesta {
  existe?: boolean;
  objeto_id?: string | null;
  dueno_original?: string | null;
  dueno_original_nombre?: string | null;
  categoria?: string | null;
  categoria_nombre?: string | null;
  estado_conservacion?: string | null;
  valor_estimado?: string | number | null;
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

  const selectDueno = bloque.querySelector<HTMLSelectElement>('[data-objeto-dueno]');
  const selectCategoria = bloque.querySelector<HTMLSelectElement>('[data-objeto-categoria]');
  const selectEstado = bloque.querySelector<HTMLSelectElement>('[data-objeto-estado]');
  const inputValor = bloque.querySelector<HTMLInputElement>('[data-objeto-valor]');
  const btnGuardar = bloque.querySelector<HTMLButtonElement>('[data-objeto-guardar]');
  const estadoGuardado = bloque.querySelector<HTMLElement>('[data-objeto-guardado]');
  if (!selectDueno || !selectCategoria || !selectEstado || !inputValor || !btnGuardar) {
    return;
  }

  let objetoId: string | null = null;
  let categoriasCargadas: CategoriaEstok[] = [];
  let datosCargados = false;
  let cargando: Promise<void> | null = null;

  /** Muestra u oculta el bloque según el disyuntor de movilidad. */
  const reflejarVisibilidad = (): void => {
    bloque.hidden = !casilla.checked;
  };

  /** Trae catálogos + propiedades guardadas y completa el formulario. */
  const cargarDatos = async (): Promise<void> => {
    if (datosCargados) return;
    if (cargando) return cargando;
    cargando = (async () => {
      try {
        const [usuarios, categorias] = await Promise.all([
          cargarUsuariosEstok(),
          cargarCategoriasEstok(),
        ]);
        categoriasCargadas = categorias;

        usuarios.forEach((u) => asegurarOpcion(selectDueno, u.id, u.nombre));
        categorias.forEach((c) =>
          asegurarOpcion(selectCategoria, c.id, `${c.icono} ${c.nombre}`),
        );

        const res = await fetch(
          `${API_BASE_URL}/contenedores/${nodo.id}/propiedades_objeto/`,
          { headers: getAuthHeaders() },
        );
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        const data: PropiedadesObjetoRespuesta = res.ok ? await res.json() : {};

        objetoId = data.objeto_id ?? null;
        if (data.dueno_original) {
          asegurarOpcion(
            selectDueno,
            data.dueno_original,
            data.dueno_original_nombre || 'Dueño actual',
          );
        }
        if (data.categoria) {
          asegurarOpcion(
            selectCategoria,
            data.categoria,
            data.categoria_nombre || 'Categoría actual',
          );
        }

        selectDueno.value = data.dueno_original ?? '';
        // SIN categoría guardada: se autocompleta con «Muebles» si el Estok la
        // tiene en su catálogo oficial (MLA1574).
        selectCategoria.value = data.categoria
          ?? categoriaMueblePorDefecto(categoriasCargadas)?.id
          ?? '';
        selectEstado.value = data.estado_conservacion || 'bueno';
        inputValor.value = data.valor_estimado == null ? '' : String(data.valor_estimado);
        datosCargados = true;
      } catch {
        // El bloque queda con los valores por defecto; se reintenta al reabrir.
      } finally {
        cargando = null;
      }
    })();
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

      const payload: Record<string, unknown> = {
        estado_conservacion: selectEstado.value || 'bueno',
        dueno_original: selectDueno.value || null,
        categoria: selectCategoria.value || null,
        valor_estimado: inputValor.value.trim() === '' ? null : inputValor.value.trim(),
      };
      if (objetoId) payload.objeto_id = objetoId;

      btnGuardar.disabled = true;
      if (estadoGuardado) estadoGuardado.textContent = 'Guardando...';
      try {
        const res = await fetch(
          `${API_BASE_URL}/contenedores/${nodo.id}/guardar_propiedades_objeto/`,
          {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        const data: PropiedadesObjetoRespuesta = await res.json().catch(() => ({}));
        if (!res.ok) {
          const crudo = data as Record<string, unknown>;
          const detalle = crudo?.detail
            || Object.values(crudo).flat().join(', ')
            || 'No se pudieron guardar las propiedades.';
          showToast(`❌ ${detalle}`, 'error');
          if (estadoGuardado) estadoGuardado.textContent = '';
          return;
        }
        objetoId = data.objeto_id ?? objetoId;
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

