// =============================================================================
// ADMIN GLOBAL · PESTAÑA «PERMISOS POR BOTÓN»
//
// Matriz de permisos y cuotas por botón DENTRO del panel centralizado, sin
// abrir /admin/inventario/botonpermiso/matriz/ en otra pestaña.
//
// Contrato backend (inventario/api/viewsets/admin_global.py):
//   GET  /api/admin/permisos-botones/?objetivo=<free|pro|familiar|empresas|personalizado|usuario:<uuid>>
//        → { objetivo, tipo, plan, plan_etiqueta, usuario, planes, periodos, botones[] }
//   POST /api/admin/permisos-botones/  { objetivo, botones: [{identificador,
//                                        permitido, limite_usos, periodo}] }
//
// La decisión real (¿puede usar el botón? ¿cuántos usos le quedan?) vive en el
// backend: services/permisos_botones.py y services/cuotas_botones.py.
// Guardar la matriz de un USUARIO lo pasa a plan «Personalizado».
// =============================================================================

import { apiGet, apiPost, fetchAllPages } from '../api';
import { planesDisponibles } from './planes';

interface Periodo {
  valor: string;
  etiqueta: string;
}

interface BotonFila {
  identificador: string;
  nombre: string;
  descripcion: string;
  feature_flag: string;
  permitido: boolean;
  limite_usos: number | null;
  ilimitado: boolean;
  periodo: string;
  origen: string;
}

interface MatrizRespuesta {
  objetivo: string;
  tipo: 'plan' | 'usuario';
  plan: string;
  plan_etiqueta: string;
  usuario: { id: string; username: string; display_name: string } | null;
  periodos: Periodo[];
  botones: BotonFila[];
  success?: boolean;
  mensaje?: string;
}

let usuariosCache: Array<{ id: string; username: string; display_name: string }> | null = null;
let periodosCache: Periodo[] = [];
let objetivoActual = 'free';
let inicializado = false;
let cargando = false;

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function aviso(texto: string, error = false): void {
  const caja = document.getElementById('godPermisosAviso');
  if (!caja) return;
  if (!texto) {
    caja.textContent = '';
    caja.className = 'hidden';
    return;
  }
  caja.textContent = texto;
  caja.className = error
    ? 'mb-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2'
    : 'mb-3 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2';
}

function pintarSelectObjetivo(): void {
  const select = document.getElementById('godPermisosObjetivo') as HTMLSelectElement | null;
  if (!select) return;

  const planes = planesDisponibles()
    .map(
      (p) =>
        `<option value="${esc(p.valor)}"${p.valor === objetivoActual ? ' selected' : ''}>Plan: ${esc(p.etiqueta)}</option>`,
    )
    .join('');

  const usuarios = (usuariosCache || [])
    .map(
      (u) =>
        `<option value="usuario:${esc(u.id)}"${`usuario:${u.id}` === objetivoActual ? ' selected' : ''}>Usuario: ${esc(u.display_name)} (@${esc(u.username)})</option>`,
    )
    .join('');

  select.innerHTML =
    `<optgroup label="Planes">${planes}</optgroup>` +
    (usuarios
      ? `<optgroup label="Personalizado (por usuario)">${usuarios}</optgroup>`
      : '');
}

function filaHtml(fila: BotonFila): string {
  const periodos = periodosCache
    .map(
      (p) =>
        `<option value="${esc(p.valor)}"${p.valor === fila.periodo ? ' selected' : ''}>${esc(p.etiqueta)}</option>`,
    )
    .join('');

  const origen =
    fila.origen === 'catalogo'
      ? '<span class="text-[10px] text-gray-400">sin configurar</span>'
      : fila.origen === 'usuario'
        ? '<span class="text-[10px] text-amber-600 font-semibold">propia</span>'
        : '<span class="text-[10px] text-blue-600">del plan</span>';

  return `
    <tr class="border-t border-gray-100">
      <td class="px-3 py-2">
        <p class="text-xs font-semibold text-gray-800">${esc(fila.nombre)}</p>
        <p class="text-[11px] text-gray-500">${esc(fila.descripcion || '')}</p>
        <p class="text-[10px] text-gray-400">
          <code>${esc(fila.identificador)}</code>
          ${fila.feature_flag ? ` &middot; flag: <code>${esc(fila.feature_flag)}</code>` : ''}
          &middot; ${origen}
        </p>
      </td>
      <td class="px-3 py-2 text-center">
        <input type="checkbox" data-permitido="${esc(fila.identificador)}"
          ${fila.permitido && fila.limite_usos !== 0 ? 'checked' : ''}
          class="h-4 w-4 accent-red-600 cursor-pointer" />
      </td>
      <td class="px-3 py-2 text-center">
        <input type="number" min="-1" data-limite="${esc(fila.identificador)}"
          value="${fila.limite_usos === null ? -1 : fila.limite_usos}"
          class="w-20 text-xs px-2 py-1 border border-gray-300 rounded-md bg-white text-center"
          title="-1 = ilimitado · 0 = bloqueado" />
      </td>
      <td class="px-3 py-2">
        <select data-periodo="${esc(fila.identificador)}"
          class="text-[11px] px-1.5 py-1 border border-gray-300 rounded-md bg-white text-gray-700">
          ${periodos}
        </select>
      </td>
    </tr>`;
}

function pintarMatriz(data: MatrizRespuesta): void {
  const contenedor = document.getElementById('godPermisosMatriz');
  const resumen = document.getElementById('godPermisosResumen');
  if (resumen) {
    resumen.textContent =
      data.tipo === 'usuario'
        ? `Reglas propias de ${data.usuario?.display_name || '—'} (al guardar queda en plan «Personalizado»).`
        : `Reglas del plan «${data.plan_etiqueta}» (aplican a todos sus usuarios).`;
  }
  if (!contenedor) return;

  periodosCache = data.periodos || periodosCache;

  contenedor.innerHTML = `
    <table class="min-w-full text-sm divide-y divide-gray-200">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Botón / función</th>
          <th class="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide">Permitido</th>
          <th class="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide">Usos</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Período</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        ${(data.botones || []).map(filaHtml).join('')}
      </tbody>
    </table>`;
}


/** Carga la matriz del objetivo actual (GET). */
export async function cargarPermisosBotones(valor?: string): Promise<void> {
  if (valor) objetivoActual = valor;
  const contenedor = document.getElementById('godPermisosMatriz');
  if (!contenedor || cargando) return;

  // «Personalizado» a nivel plan no existe: sus reglas son SIEMPRE por usuario.
  if (objetivoActual === 'personalizado') {
    contenedor.innerHTML =
      '<p class="text-sm text-gray-500 px-3 py-6">El plan «Personalizado» se configura por usuario: elegí un usuario en el selector de arriba.</p>';
    aviso('');
    return;
  }

  cargando = true;
  contenedor.innerHTML =
    '<p class="text-sm text-gray-400 px-3 py-6">Cargando matriz de permisos...</p>';
  try {
    const data = await apiGet<MatrizRespuesta>('/admin/permisos-botones/', {
      objetivo: objetivoActual,
    });
    pintarMatriz(data);
    aviso('');
  } catch (err: any) {
    contenedor.innerHTML = `<p class="text-sm text-red-600 px-3 py-6">${esc(
      err?.error || 'Error al cargar los permisos.',
    )}</p>`;
  } finally {
    cargando = false;
  }
}

async function cargarUsuarios(): Promise<void> {
  if (usuariosCache) return;
  try {
    const filas = await fetchAllPages<any>('/admin/usuarios/');
    usuariosCache = (filas || []).map((u: any) => ({
      id: String(u.id),
      username: String(u.username || ''),
      display_name: String(u.display_name || u.username || ''),
    }));
    pintarSelectObjetivo();
  } catch {
    usuariosCache = [];
  }
}

/** Guarda la matriz completa del objetivo seleccionado (POST). */
export async function guardarPermisosBotones(): Promise<void> {
  const botones: Array<Record<string, unknown>> = [];
  document.querySelectorAll<HTMLInputElement>('[data-permitido]').forEach((casilla) => {
    const identificador = casilla.dataset.permitido || '';
    if (!identificador) return;
    const limite = document.querySelector<HTMLInputElement>(
      `[data-limite="${identificador}"]`,
    );
    const periodo = document.querySelector<HTMLSelectElement>(
      `[data-periodo="${identificador}"]`,
    );
    botones.push({
      identificador,
      permitido: casilla.checked,
      limite_usos: limite?.value ?? -1,
      periodo: periodo?.value || 'mensual',
    });
  });

  if (botones.length === 0) {
    aviso('No hay botones para guardar.', true);
    return;
  }

  const btn = document.getElementById('godPermisosGuardar') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Guardando...';
  }
  try {
    const data = await apiPost<MatrizRespuesta>('/admin/permisos-botones/', {
      objetivo: objetivoActual,
      botones,
    });
    pintarMatriz(data);
    aviso(`✅ ${data.mensaje || 'Permisos guardados.'}`);
    if (data.tipo === 'usuario') {
      // Guardar reglas propias deja al usuario en «Personalizado».
      objetivoActual = data.objetivo;
    }
  } catch (err: any) {
    aviso(err?.error || 'Error al guardar los permisos.', true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Guardar permisos';
    }
  }
}

/** Cablea la pestaña (idempotente). */
export function initPermisosBotonesTab(): void {
  if (inicializado) return;
  const select = document.getElementById('godPermisosObjetivo') as HTMLSelectElement | null;
  if (!select) return;
  inicializado = true;

  pintarSelectObjetivo();
  void cargarUsuarios();

  select.addEventListener('change', () => {
    void cargarPermisosBotones(select.value);
  });

  document
    .getElementById('godPermisosGuardar')
    ?.addEventListener('click', () => void guardarPermisosBotones());
}

