// =============================================================================
// PASO 4 DEL ASISTENTE — CATÁLOGOS DEL FORMULARIO COMPACTO DE OBJETO
// -----------------------------------------------------------------------------
// Carga los comboboxes del formulario modular del Paso 4 con los MISMOS
// endpoints y contrato que /objetos/nuevo (src/lib/objetos/objetoCatalogos.ts):
//   · GET /api/usuarios/    → «Dueño original» y «Beneficiario» del Estok.
//   · GET /api/categorias/  → categorías oficiales + personalizadas.
// Auth 100% centralizada (JWT + X-Estok-Id). Idempotente: una sola carga.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../../services/auth';

interface UsuarioApi {
  id: string | number;
  full_name?: string;
  username?: string;
  email?: string;
}

interface CategoriaApi {
  id: string | number;
  nombre: string;
  icono?: string;
}

function refOpc<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Llena los comboboxes dueño/beneficiario con los usuarios del Estok. */
async function cargarUsuarios(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/usuarios/`, { headers: { ...getAuthHeaders() } });
    if (!res.ok) return;
    const data = (await res.json()) as UsuarioApi[] | { results?: UsuarioApi[] };
    const usuarios: UsuarioApi[] = Array.isArray(data) ? data : data?.results ?? [];
    const dueno = refOpc<HTMLSelectElement>('dueno_original');
    const beneficiario = refOpc<HTMLSelectElement>('beneficiario');
    if (!dueno || !beneficiario) return;
    usuarios.forEach((u) => {
      const nombre = u.full_name || u.username || u.email || 'Usuario';
      const o1 = document.createElement('option');
      o1.value = String(u.id);
      o1.textContent = nombre;
      dueno.appendChild(o1);
      const o2 = document.createElement('option');
      o2.value = String(u.id);
      o2.textContent = nombre;
      beneficiario.appendChild(o2);
    });
  } catch {
    /* silencioso: el formulario sigue usable sin catálogo */
  } finally {
    // LegadoTrazabilidad recalcula su aviso de votación con el padrón cargado.
    window.dispatchEvent(new CustomEvent('estok:usuariosCargados'));
  }
}

/** Llena el selector de categorías (oficiales + personalizadas del Estok). */
async function cargarCategorias(): Promise<void> {
  const select = refOpc<HTMLSelectElement>('categoria');
  if (!select) return;
  try {
    const res = await fetch(`${API_BASE_URL}/categorias/`, { headers: { ...getAuthHeaders() } });
    if (!res.ok) return;
    const data = (await res.json()) as CategoriaApi[] | { results?: CategoriaApi[] };
    const categorias: CategoriaApi[] = Array.isArray(data) ? data : data?.results ?? [];
    // Se rellenan solo las nuevas: el «Sin categoría» inicial permanece primero.
    const existentes = new Set(Array.from(select.options).map((o) => o.value));
    categorias.forEach((c) => {
      if (existentes.has(String(c.id))) return;
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = `${c.icono || '🏷️'} ${c.nombre}`;
      select.appendChild(opt);
    });
  } catch {
    /* silencioso */
  }
}

let cargado = false;

/** Carga única de los catálogos del formulario compacto del Paso 4. */
export async function cargarCatalogosObjeto(): Promise<void> {
  if (cargado) return;
  cargado = true;
  window.addEventListener('categoriaCreada', () => void cargarCategorias());
  await Promise.all([cargarUsuarios(), cargarCategorias()]);
}
