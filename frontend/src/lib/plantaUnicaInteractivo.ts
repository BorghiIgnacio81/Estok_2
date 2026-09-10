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
import { guardarUbicacion, toast } from './mapaJerarquico';
import { conectarRenombradoEnVivo } from './lienzoInteractivo';
import { conectarArrastreLibre, conectarResizeLibre } from './plantaUnicaArrastre';
import type { OpcionesPlantaUnica } from './plantaUnicaArrastre';
import { putGrupo } from './plantaUnicaGrupo';

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

/** Conecta TODAS las capacidades de edición del lienzo de Planta Única. */
export function conectarPlantaUnica(opts: OpcionesPlantaUnica): void {
  conectarRenombrado(opts);
  conectarCreacion(opts);
  conectarArrastreLibre(opts);
  conectarResizeLibre(opts);
  conectarSeleccionYFusion(opts);
}

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
      const ok = await putGrupo(baseId, { nombre });
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
    const ok = await guardarUbicacion(id, { nombre });
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
  opts.scope.querySelectorAll<HTMLElement>('[data-nueva-ubicacion]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.creando === '1') return;
      btn.dataset.creando = '1';
      btn.classList.add('pu-creando');
      try {
        const apartamento = opts.apartamentoId() ?? (await opts.asegurarApartamento());
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
      } finally {
        delete btn.dataset.creando;
        btn.classList.remove('pu-creando');
      }
    });
  });
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
    const [base, ...resto] = ids;
    btnFusionar.disabled = true;
    const ok = await postJson(`${API_BASE_URL}/ubicaciones/${base}/fusionar/`, {
      ubicacion_ids: resto,
    });
    if (!ok) {
      toast('❌ No se pudieron fusionar los espacios.');
      refrescar();
      return;
    }
    toast('🔗 Espacios fusionados en un único espacio en «L».');
    opts.notificarCambios();
  });

  opts.scope.querySelectorAll<HTMLElement>('[data-separar]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id ?? '';
      if (!id) return;
      const ok = await postJson(`${API_BASE_URL}/ubicaciones/${id}/separar/`, {});
      if (!ok) {
        toast('❌ No se pudo separar el espacio fusionado.');
        return;
      }
      toast('✂️ Espacio separado en rectángulos independientes.');
      opts.notificarCambios();
    });
  });
}
