// =============================================================================
// CARGA Y MUTACIONES DEL LIENZO «MAPA ESTOK» (Nivel Estok)
// -----------------------------------------------------------------------------
// Operaciones contra el backend (Ubicaciones del Estok activo): lectura del
// plano, creación del contenedor «Departamento» (Planta Única), inyección de
// habitaciones y persistencia del disyuntor «Espacio Único» de una planta.
// Módulo de EFECTOS: usa auth centralizada y escribe en el estado compartido.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../../services/auth';
import {
  PISO_PRIMERO,
  PISO_BAJA,
  crearDivisionUbicacion,
  esDivisionUbicacion,
  fetchUbicacionesPlano,
  toast,
} from '../mapaJerarquico';
import type { UbicacionPlano } from '../mapaJerarquico';
import { apartamentoDePlantaUnica } from './dominioCasita';
import { estado } from './estadoCasita';

/** Carga divisiones (plantas) y habitaciones del Estok activo en el estado. */
export async function cargarDatos(): Promise<void> {
  const todas = await fetchUbicacionesPlano();
  estado.divisiones = todas.filter((u) => esDivisionUbicacion(u));
  estado.habitaciones = todas.filter((u) => !esDivisionUbicacion(u));
}

/** Garantiza el contenedor «Departamento» antes de inyectar el primer espacio. */
export async function crearApartamentoSiFalta(): Promise<string | null> {
  const existente = apartamentoDePlantaUnica(estado.divisiones);
  if (existente) return existente.id;
  const creada = await crearDivisionUbicacion('Departamento', 1, 1);
  if (!creada) return null;
  estado.divisiones.push(creada);
  return creada.id;
}

/**
 * Crea una habitación nueva (rectángulo elástico libre) dentro de la planta
 * activa. Reutiliza el MISMO motor 2D que el Modo Planta Única; la tarjeta
 * hereda iconografía contextual y se persiste multi-tenant (JWT + X-Estok-Id).
 */
export async function crearHabitacionEnPlanta(div: UbicacionPlano): Promise<boolean> {
  const n = estado.habitaciones.filter((h) => h.parent_ubicacion === div.id).length;
  try {
    const res = await fetch(`${API_BASE_URL}/ubicaciones/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: `Habitación ${n + 1}`,
        parent_ubicacion: div.id,
        piso: div.parent_grid_row === 1 ? PISO_PRIMERO : PISO_BAJA,
        ui_left: `${6 + (n % 5) * 12}%`,
        ui_top: `${8 + (n % 4) * 16}%`,
        ui_width: '28%',
        ui_height: '24%',
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) {
      toast(`✅ «Habitación ${n + 1}» creada en «${div.nombre}».`);
      window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
      return true;
    }
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo crear la habitación.'));
    return false;
  } catch {
    toast('❌ Error de conexión al crear la habitación.');
    return false;
  }
}

/**
 * Persiste el disyuntor «Espacio Único» de una planta (Ubicación división):
 * PATCH multi-tenant. Devuelve true si el backend confirmó el cambio.
 */
export async function guardarEspacioUnicoDivision(
  divisionId: string,
  valor: boolean,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/ubicaciones/${divisionId}/`, {
      method: 'PATCH',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ espacio_unico: valor }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) {
      toast(
        valor
          ? '🧱 Planta marcada como Espacio Único: sus objetos se guardan de forma directa.'
          : '🧩 Espacio Único desactivado: la planta vuelve a admitir subdivisiones.',
      );
      return true;
    }
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo actualizar el Espacio Único.'));
    return false;
  } catch {
    toast('❌ Error de conexión al actualizar el Espacio Único.');
    return false;
  }
}
