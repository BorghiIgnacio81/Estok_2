// =============================================================================
// PLANTA ÚNICA - ORQUESTADOR DE INTERACCIÓN Y PERSISTENCIA EN CALIENTE
// -----------------------------------------------------------------------------
// Une todas las capacidades del Modelador 2D del Modo Planta Única:
//   - Inyección elástica de espacios libres (botón /nueva ubicacion.png).
//   - Renombrado in-place con SINCRONIZACIÓN del bloque fusionado: un ÚNICO PUT
//     actualiza el nombre de TODAS las partes de la macro-estructura.
//   - Arrastre + resizing con FÍSICA DE COLISIONES (AABB) y AJUSTE MAGNÉTICO a
//     huecos → delegado en ./plantaUnicaArrastre.
//   - Selección múltiple + motor de fusión/separación (espacio en "L").
// La geometría pura vive en colisionesPlantaUnica.ts y la persistencia
// consolidada del grupo en plantaUnicaGrupo.ts. Módulos chicos y enfocados.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { toast } from './mapaJerarquico';
import { conectarRenombradoEnVivo } from './lienzoInteractivo';
import { confirmarEliminacionEstructura } from './confirmacionEliminar';
import { adaptadorDe, conectarArrastreLibre, conectarResizeLibre } from './plantaUnicaArrastre';
import type { OpcionesPlantaUnica } from './plantaUnicaArrastre';

export type { OpcionesPlantaUnica } from './plantaUnicaArrastre';

/** POST JSON con auth centralizada (JWT + X-Estok-Id). Devuelve true si fue 2xx. */
async function postJson(url: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

/** Conecta TODAS las capacidades de edición de cualquier lienzo elástico 2D. */
export function conectarLienzoElastico(opts: OpcionesPlantaUnica): void {
  conectarRenombrado(opts);
  conectarCreacion(opts);
  conectarArrastreLibre(opts);
  conectarResizeLibre(opts);
  conectarSeleccionYFusion(opts);
  conectarEliminacionItems(opts);
}

/**
 * Alias de compatibilidad: Planta Única (Nivel 1) reutiliza el MISMO motor 2D
 * con el adaptador de Ubicación por defecto.
 */
export const conectarPlantaUnica = conectarLienzoElastico;

// =============================================================================
// CLIC PARA RENOMBRAR (in-place) + SINCRONIZACIÓN DE BLOQUES FUSIONADOS
// =============================================================================

function conectarRenombrado(opts: OpcionesPlantaUnica): void {
  conectarRenombradoEnVivo(opts.scope, async (id, nombre, el) => {
    const grupo = el.closest<HTMLElement>('.pu-grupo');
    // --- Espacio FUSIONADO: un único PUT renombra TODAS las partes. ---
    if (grupo) {
      const baseId = grupo.dataset.id ?? id;
      const grupoId = grupo.dataset.fusionGrupo ?? '';
      const ok = await adaptadorDe(opts).guardarGrupo(baseId, { nombre });
      if (!ok) {
        toast('❌ No se pudo renombrar el espacio fusionado.');
        return false;
      }
      // Sincronizar el estado en memoria de TODAS las partes del grupo.
      opts.rooms()
        .filter((r) => r.fusion_grupo && r.fusion_grupo === grupoId)
        .forEach((r) => {
          r.nombre = nombre;
        });
      toast(`🔗 Espacio fusionado renombrado a «${nombre}» en todas sus partes.`);
      opts.notificarCambios();
      return true;
    }

    // --- Espacio suelto: PUT individual. ---
    const room = opts.rooms().find((r) => r.id === id);
    if (!room) return false;
    if (nombre === room.nombre) return true;
    const ok = await adaptadorDe(opts).guardarItem(id, { nombre });
    if (!ok) {
      toast('❌ No se pudo renombrar el espacio.');
      return false;
    }
    room.nombre = nombre;
    toast(`✅ Espacio renombrado a «${nombre}».`);
    opts.notificarCambios();
    return true;
  });
}

// =============================================================================
// INYECCIÓN ELÁSTICA DE HABITACIONES LIBRES
// =============================================================================

function conectarCreacion(opts: OpcionesPlantaUnica): void {
  opts.scope
    .querySelectorAll<HTMLElement>('[data-nueva-ubicacion],[data-lienzo-crear]')
    .forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.creando === '1') return;
        btn.dataset.creando = '1';
        btn.classList.add('pu-creando');
        try {
          await crearRectangulo(opts);
        } finally {
          delete btn.dataset.creando;
          btn.classList.remove('pu-creando');
        }
      });
    });
}

/**
 * Crea un rectángulo nuevo en el lienzo. Si el consumidor inyecta `crearItem`
 * (visores de Nivel 2/3/4) se usa ese; si no, se cae al alta de Ubicación de
 * Planta Única (Nivel 1) con el contenedor «Departamento» como padre.
 */
async function crearRectangulo(opts: OpcionesPlantaUnica): Promise<void> {
  if (opts.crearItem) {
    const ok = await opts.crearItem();
    if (ok) {
      toast('✅ Espacio libre inyectado. Arrastralo para acomodarlo.');
      opts.notificarCambios();
    } else {
      toast('❌ No se pudo inyectar el espacio libre.');
    }
    return;
  }

  const apartamento =
    opts.apartamentoId?.() ??
    (opts.asegurarApartamento ? await opts.asegurarApartamento() : null);
  if (!apartamento) {
    toast('⚠️ No se pudo preparar el contenedor del departamento.');
    return;
  }
  const n = opts.rooms().length;
  const izquierda = 6 + (n % 5) * 12;
  const arriba = 8 + (n % 4) * 16;
  const ok = await postJson(`${API_BASE_URL}/ubicaciones/`, {
    nombre: `Espacio ${n + 1}`,
    parent_ubicacion: apartamento,
    piso: 'PLANTA_BAJA',
    ui_left: `${izquierda}%`,
    ui_top: `${arriba}%`,
    ui_width: '28%',
    ui_height: '24%',
  });
  if (!ok) {
    toast('❌ No se pudo inyectar la ubicación libre.');
    return;
  }
  toast('✅ Espacio libre inyectado. Arrastralo para acomodarlo.');
  opts.notificarCambios();
}

// =============================================================================
// SELECCIÓN MÚLTIPLE + MOTOR DE FUSIÓN (espacios en "L")
// =============================================================================

function conectarSeleccionYFusion(opts: OpcionesPlantaUnica): void {
  const seleccion = new Set<string>();
  const btnFusionar = opts.scope.querySelector<HTMLButtonElement>('[data-fusionar]');
  const contador = opts.scope.querySelector<HTMLElement>('[data-fusion-contador]');

  const refrescar = (): void => {
    if (contador) {
      contador.textContent = `${seleccion.size} seleccionado${seleccion.size === 1 ? '' : 's'}`;
    }
    if (btnFusionar) btnFusionar.disabled = seleccion.size < 2;
  };

  opts.scope.querySelectorAll<HTMLInputElement>('[data-fusion-check]').forEach((chk) => {
    chk.addEventListener('change', () => {
      const id = chk.dataset.id ?? '';
      if (!id) return;
      if (chk.checked) seleccion.add(id);
      else seleccion.delete(id);
      refrescar();
    });
  });
  refrescar();

  btnFusionar?.addEventListener('click', async () => {
    const ids = Array.from(seleccion);
    if (ids.length < 2) return;
    // FUSIÓN ENCADENADA: si algún seleccionado ya pertenece a un grupo, se toma
    // como BASE para REUTILIZAR su `fusion_grupo` y EXPANDIR la macro-estructura
    // existente en un mismo PUT, sin importar el orden en que se tildaron.
    const rooms = opts.rooms();
    const base =
      ids.find((id) => rooms.find((r) => r.id === id)?.fusion_grupo) ?? ids[0];
    const resto = ids.filter((id) => id !== base);
    if (resto.length === 0) return;
    btnFusionar.disabled = true;
    const ok = await adaptadorDe(opts).fusionar(base, resto);
    if (!ok) {
      toast('❌ No se pudieron fusionar los espacios.');
      refrescar();
      return;
    }
    toast('🔗 Espacios fusionados en un único espacio en «L».');
    opts.notificarCambios();
  });

  // ===========================================================================
  // BORRADO ATÓMICO DEL MACRO-ESPACIO FUSIONADO (bloque indestructible)
  // Una vez unidos, los cuadrantes son UN SOLO espacio: no existen controles
  // individuales ni separación. El único 🗑️ vive en la esquina superior derecha
  // del bloque unificado y elimina físicamente todas sus partes en el backend.
  // ===========================================================================
  opts.scope.querySelectorAll<HTMLButtonElement>('[data-eliminar-grupo]').forEach((btn) => {
    // El botón vive DENTRO de la tarjeta arrastrable/navegable: se frena el
    // gesto de arrastre (pointerdown) y el clic para no disparar el portal.
    btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id ?? '';
      const card = btn.closest<HTMLElement>('.pu-grupo');
      if (!id || !card) return;
      const nombre = btn.dataset.nombre || 'espacio fusionado';
      // 1) Advertencia unificada de resguardo: frena el flujo ANTES del server.
      if (!confirmarEliminacionEstructura()) return;
      // 2) DELETE atómico del UUID del macro-espacio: el backend borra de
      //    PostgreSQL todas las sub-celdas del grupo y desancla recursivamente
      //    sus objetos hacia la bandeja inferior de disponibles.
      btn.disabled = true;
      const res = await adaptadorDe(opts).eliminar(id);
      if (!res.ok) {
        btn.disabled = false;
        toast(`❌ ${res.error || 'No se pudo eliminar el espacio fusionado.'}`);
        return;
      }
      // 3) Remoción instantánea del bloque completo en pantalla (sin recargar).
      card.remove();
      toast(`🗑️ «${nombre}» eliminado. Su contenido quedó en la bandeja de «por ubicar».`);
      opts.notificarCambios();
    });
  });
}

// ===========================================================================
// BORRADO DE ESPACIOS INDIVIDUALES (habitaciones comunes, muebles y estantes)
// ---------------------------------------------------------------------------
// OMNIPRESENTE: TODA tarjeta del lienzo elástico (habitación suelta, mueble de
// una habitación o estante de un mueble) expone su «Eliminar» (🗑️) en modo
// edición. El DELETE recorre el subárbol completo en el backend y DESANCLA cada
// objeto hacia la bandeja inferior de «por ubicar» (el stock nunca se pierde).
// Las estructuras protegidas (es_inmueble) no reciben botón: el backend las
// rechaza con 403, por lo que el lienzo no ofrece una acción imposible.
// ===========================================================================
function conectarEliminacionItems(opts: OpcionesPlantaUnica): void {
  opts.scope.querySelectorAll<HTMLButtonElement>('[data-eliminar-item]').forEach((btn) => {
    // El botón vive DENTRO de la tarjeta arrastrable/navegable: se frena el
    // gesto de arrastre (pointerdown) y el clic para no disparar el portal.
    btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id ?? '';
      const card = btn.closest<HTMLElement>('.pu-celda');
      if (!id || !card) return;
      const nombre = btn.dataset.nombre || 'espacio';
      if (!confirmarEliminacionEstructura()) return;
      btn.disabled = true;
      const res = await adaptadorDe(opts).eliminar(id);
      if (!res.ok) {
        btn.disabled = false;
        toast(`❌ ${res.error || 'No se pudo eliminar el espacio.'}`);
        return;
      }
      card.remove();
      toast(`🗑️ «${nombre}» eliminado. Su contenido quedó en la bandeja de «por ubicar».`);
      opts.notificarCambios();
    });
  });
}
