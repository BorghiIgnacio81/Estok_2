// =============================================================================
// VISOR CONTENEDOR GRANDE - EDITOR ELÁSTICO DE HABITACIÓN VACÍA
// -----------------------------------------------------------------------------
// REGLA DE INICIALIZACIÓN: cuando la habitación activa NO tiene muebles, el panel
// derecho nunca queda en blanco. Este módulo monta el MISMO lienzo editor
// elástico 2D que las plantas (rectángulos libres fusionables) y expone el botón
// «➕ Crear mueble aquí» para modelar la distribución interna en caliente.
// Vive aparte de visorContenedorGrande.ts para sostener la modularidad.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { toast } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';
import { conectarLienzoElastico } from './plantaUnicaInteractivo';
import { adaptadorContenedores } from './lienzoElastico';
import type { ItemElastico } from './lienzoElastico';

export interface OpcionesHabitacionVacia {
  /** Panel derecho donde viven los lienzos elásticos (`#visorContenedorGrande`). */
  scope: ParentNode;
  /** Contenedores RAÍZ actuales de la habitación (fuente de los rectángulos). */
  raices: () => ItemElastico[];
  /** Habitación activa (destino del POST de creación del mueble). */
  room: () => UbicacionPlano | null;
}

/**
 * Conecta el editor elástico del estado VACÍO. Reutiliza el motor 2D de Planta
 * Única (arrastrar/estirar/fusionar) y su botón «➕ Crear mueble aquí» funda un
 * mueble raíz dentro de la habitación activa.
 * Los lienzos internos de un mueble ya los gobierna el visor del mueble.
 */
export function conectarLienzoHabitacionVacia(opts: OpcionesHabitacionVacia): void {
  opts.scope.querySelectorAll<HTMLElement>('[data-lienzo-elastico]').forEach((scope) => {
    if (scope.closest('[data-mueble-card]')) return;
    conectarLienzoElastico({
      scope,
      rooms: () => opts.raices(),
      adaptador: adaptadorContenedores(),
      notificarCambios: () => window.dispatchEvent(new CustomEvent('estok:espacios-cambiados')),
      crearItem: () => crearMuebleEnHabitacion(opts),
    });
  });
}

/** Crea un mueble nuevo (rectángulo libre raíz) dentro de la habitación activa. */
async function crearMuebleEnHabitacion(opts: OpcionesHabitacionVacia): Promise<boolean> {
  const room = opts.room();
  if (!room) return false;
  const n = opts.raices().length;
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: `Mueble ${n + 1}`,
        descripcion: '',
        ubicacion: room.id,
        ui_left: `${6 + (n % 5) * 12}%`,
        ui_top: `${8 + (n % 4) * 16}%`,
        ui_width: '28%',
        ui_height: '24%',
        es_inmueble: false,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) {
      toast(`✅ «Mueble ${n + 1}» creado en «${room.nombre}».`);
      window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
      return true;
    }
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo crear el mueble.'));
    return false;
  } catch {
    toast('❌ Error de conexión al crear el mueble.');
    return false;
  }
}
