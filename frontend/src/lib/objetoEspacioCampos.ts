// =============================================================================
// CAMPOS DE OBJETO DE UN ESPACIO (mueble / objeto declarado) — FUENTE ÚNICA
// -----------------------------------------------------------------------------
// Markup + catálogos + precarga + recolección de los campos del Objeto espejo
// que comparten DOS formularios de edición:
//   · panel del espacio declarado (lib/objetoEspacio.ts),
//   · modal técnico de edición de espacios (lib/objetoEspacioModal.ts).
//
// Campos integrados: Dueño, Categoría (default «Muebles»), Estado de
// conservación, Valor estimado, Notas/Descripción, campos patrimoniales y
// FOTOS con galería múltiple + cámara directa (capture="environment").
//
// La PERSISTENCIA no vive acá: cada formulario decide su endpoint (el panel
// usa /guardar_propiedades_objeto/; el modal los envía prefijados `objeto_*`
// dentro del PUT unificado del espacio).
// Auth centralizada: getAuthHeaders()/API_BASE_URL desde services/auth.
// =============================================================================

import { getAuthHeaders } from '../services/auth';
import {
  cargarCategoriasEstok,
  cargarUsuariosEstok,
  categoriaMueblePorDefecto,
} from './catalogosEstok';
import type { CategoriaEstok } from './catalogosEstok';
import { CAMPOS_PATRIMONIALES, patrimonialesPanelHtml } from './objetoCamposPatrimoniales';

/** Foto del objeto tal como la devuelve el backend. */
export interface FotoObjetoEspacio {
  id: string;
  imagen: string;
  descripcion?: string | null;
  es_principal?: boolean;
}

/** Payload GET/PUT de las propiedades del Objeto espejo. */
export interface DatosObjetoEspacio {
  existe?: boolean;
  objeto_id?: string | null;
  nombre?: string | null;
  descripcion?: string | null;
  dueno_original?: string | null;
  dueno_original_nombre?: string | null;
  dueno_externo_nombre?: string | null;
  beneficiario?: string | null;
  beneficiario_nombre?: string | null;
  categoria?: string | null;
  categoria_nombre?: string | null;
  estado_conservacion?: string | null;
  valor_estimado?: string | number | null;
  color?: string | null;
  material?: string | null;
  marca?: string | null;
  modelo?: string | null;
  numero_serie?: string | null;
  autor?: string | null;
  anio?: string | number | null;
  artista_fabricante?: string | null;
  tamano?: string | null;
  fotos?: FotoObjetoEspacio[];
}

/** Estados canónicos de Objeto.estado_conservacion con rótulos de operador. */
export const ESTADOS_CONSERVACION = [
  { valor: 'excelente', etiqueta: 'Nuevo / Excelente' },
  { valor: 'bueno', etiqueta: 'Buen estado' },
  { valor: 'regular', etiqueta: 'Regular' },
  { valor: 'malo', etiqueta: 'A reparar' },
  { valor: 'muy_malo', etiqueta: 'Muy deteriorado' },
] as const;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Markup completo de los campos del objeto (sin botón de guardado). */
export function camposObjetoEspacioHtml(): string {
  const opcionesEstado = ESTADOS_CONSERVACION
    .map((e) => `<option value="${e.valor}">${e.etiqueta}</option>`)
    .join('');
  return `<div class="portal-objeto-propiedades-grid">
      <label class="portal-objeto-campo">
        <span>Dueño / Propietario</span>
        <select data-objeto-campo="dueno_original">
          <option value="">Sin dueño asignado</option>
        </select>
      </label>
      <label class="portal-objeto-campo">
        <span>Categoría</span>
        <select data-objeto-campo="categoria">
          <option value="">Seleccionar categoría...</option>
        </select>
      </label>
      <label class="portal-objeto-campo">
        <span>Estado de conservación</span>
        <select data-objeto-campo="estado_conservacion">${opcionesEstado}</select>
      </label>
      <label class="portal-objeto-campo">
        <span>Valor estimado</span>
        <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" data-objeto-campo="valor_estimado" />
      </label>
      <label class="portal-objeto-campo portal-objeto-campo--ancho">
        <span>Notas / Descripción</span>
        <textarea rows="2" data-objeto-campo="descripcion" placeholder="Historia, procedencia, detalles patrimoniales…"></textarea>
      </label>
    </div>
    <details class="portal-objeto-patrimoniales">
      <summary>🧾 Datos patrimoniales adicionales</summary>
      <div class="portal-objeto-propiedades-grid">
        <label class="portal-objeto-campo">
          <span>Propietario sin cuenta</span>
          <input type="text" data-objeto-campo="dueno_externo_nombre" placeholder="Nombre del dueño original" />
        </label>
        <label class="portal-objeto-campo">
          <span>Beneficiario</span>
          <select data-objeto-campo="beneficiario">
            <option value="">Sin beneficiario</option>
          </select>
        </label>
        ${patrimonialesPanelHtml()}
      </div>
    </details>
    <div class="portal-objeto-fotos">
      <p class="portal-objeto-fotos-titulo">📷 Fotos del objeto</p>
      <div class="portal-objeto-fotos-grid" data-objeto-fotos-existentes hidden></div>
      <div class="portal-objeto-fotos-grid" data-objeto-fotos-nuevas hidden></div>
      <div class="portal-objeto-fotos-acciones">
        <label class="portal-objeto-foto-boton">
          <span aria-hidden="true">📷</span> Tomar foto
          <input type="file" accept="image/*" capture="environment" data-objeto-foto-camara class="hidden" />
        </label>
        <label class="portal-objeto-foto-boton portal-objeto-foto-boton--sec">
          <span aria-hidden="true">🖼️</span> Elegir de la Galería
          <input type="file" accept="image/*" multiple data-objeto-foto-galeria class="hidden" />
        </label>
      </div>
    </div>`;
}


/** Controlador de una instancia de los campos dentro de un formulario. */
export interface ControladorCamposObjeto {
  /** Catálogos + GET de propiedades (siempre refresca los valores). */
  cargar(url: string): Promise<void>;
  precargar(datos: DatosObjetoEspacio): void;
  limpiar(): void;
  /** true cuando la precarga terminó: evita guardar valores por defecto. */
  estaListo(): boolean;
  recolectar(): { datos: Record<string, string>; fotos: File[] };
}

const controladores = new WeakMap<ParentNode, ControladorCamposObjeto>();

/** Devuelve el controlador ya conectado a ese scope (o null si no existe). */
export function obtenerControladorCamposObjeto(
  scope: ParentNode,
): ControladorCamposObjeto | null {
  return controladores.get(scope) ?? null;
}

/** Agrega una opción al select si su valor todavía no está listado. */
function asegurarOpcion(select: HTMLSelectElement | null, valor: unknown, texto: unknown): void {
  const id = valor == null ? '' : String(valor);
  if (!select || !id) return;
  if ([...select.options].some((o) => o.value === id)) return;
  const opcion = document.createElement('option');
  opcion.value = id;
  opcion.textContent = texto ? String(texto) : id;
  select.appendChild(opcion);
}

/** Conecta los campos de objeto dentro de `scope` (idempotente por nodo). */
export function conectarCamposObjeto(scope: ParentNode): ControladorCamposObjeto {
  const existente = controladores.get(scope);
  if (existente) return existente;

  type Campo = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const campos = new Map<string, Campo>();
  scope.querySelectorAll<Campo>('[data-objeto-campo]').forEach((el) => {
    const clave = el.dataset.objetoCampo;
    if (clave) campos.set(clave, el);
  });

  const selectDueno = campos.get('dueno_original') as HTMLSelectElement | undefined;
  const selectBeneficiario = campos.get('beneficiario') as HTMLSelectElement | undefined;
  const selectCategoria = campos.get('categoria') as HTMLSelectElement | undefined;
  const fotosExistentesHost = scope.querySelector<HTMLElement>('[data-objeto-fotos-existentes]');
  const fotosNuevasHost = scope.querySelector<HTMLElement>('[data-objeto-fotos-nuevas]');
  const camaraInput = scope.querySelector<HTMLInputElement>('[data-objeto-foto-camara]');
  const galeriaInput = scope.querySelector<HTMLInputElement>('[data-objeto-foto-galeria]');

  let categoriasCargadas: CategoriaEstok[] = [];
  let catalogoCargado = false;
  let listo = false;
  let datosActuales: DatosObjetoEspacio = {};
  let fotosExistentes: FotoObjetoEspacio[] = [];
  let fotosNuevas: File[] = [];
  const urlsNuevas: string[] = [];

  const setValor = (clave: string, valor: unknown): void => {
    const el = campos.get(clave);
    if (el) el.value = valor == null ? '' : String(valor);
  };

  const renderFotosExistentes = (): void => {
    if (!fotosExistentesHost) return;
    fotosExistentesHost.innerHTML = fotosExistentes
      .map((f) => `<figure class="portal-objeto-foto">
        <img src="${escapeHtml(f.imagen)}" alt="Foto del objeto" loading="lazy" />
        ${f.es_principal ? '<span class="portal-objeto-foto-principal">★ Principal</span>' : ''}
      </figure>`)
      .join('');
    fotosExistentesHost.hidden = fotosExistentes.length === 0;
  };

  const renderFotosNuevas = (): void => {
    urlsNuevas.forEach((url) => URL.revokeObjectURL(url));
    urlsNuevas.length = 0;
    if (!fotosNuevasHost) return;
    fotosNuevasHost.innerHTML = '';
    fotosNuevas.forEach((archivo, indice) => {
      const url = URL.createObjectURL(archivo);
      urlsNuevas.push(url);
      const figura = document.createElement('figure');
      figura.className = 'portal-objeto-foto';
      figura.innerHTML = `<img src="${url}" alt="Foto nueva ${indice + 1}" />
        <button type="button" class="portal-objeto-foto-quitar" title="Quitar foto" aria-label="Quitar foto">×</button>`;
      figura.querySelector<HTMLButtonElement>('.portal-objeto-foto-quitar')?.addEventListener(
        'click',
        () => {
          fotosNuevas.splice(indice, 1);
          renderFotosNuevas();
        },
      );
      fotosNuevasHost.appendChild(figura);
    });
    fotosNuevasHost.hidden = fotosNuevas.length === 0;
  };

  const agregarFotos = (archivos: FileList | null): void => {
    if (!archivos) return;
    for (const archivo of Array.from(archivos)) {
      if (archivo.type.startsWith('image/')) fotosNuevas.push(archivo);
    }
    renderFotosNuevas();
  };


  const cargarCatalogos = async (): Promise<void> => {
    if (catalogoCargado) return;
    const [usuarios, categorias] = await Promise.all([
      cargarUsuariosEstok(),
      cargarCategoriasEstok(),
    ]);
    categoriasCargadas = categorias;
    usuarios.forEach((u) => {
      asegurarOpcion(selectDueno ?? null, u.id, u.nombre);
      asegurarOpcion(selectBeneficiario ?? null, u.id, u.nombre);
    });
    categorias.forEach((c) =>
      asegurarOpcion(selectCategoria ?? null, c.id, `${c.icono} ${c.nombre}`),
    );
    catalogoCargado = true;
  };

  const precargar = (datos: DatosObjetoEspacio): void => {
    datosActuales = datos || {};
    asegurarOpcion(
      selectDueno ?? null,
      datos.dueno_original,
      datos.dueno_original_nombre || 'Dueño actual',
    );
    asegurarOpcion(
      selectBeneficiario ?? null,
      datos.beneficiario,
      datos.beneficiario_nombre || 'Beneficiario actual',
    );
    asegurarOpcion(
      selectCategoria ?? null,
      datos.categoria,
      datos.categoria_nombre || 'Categoría actual',
    );

    setValor('dueno_original', datos.dueno_original ?? '');
    // SIN categoría guardada: default «Muebles» (MLA1574) si el Estok la tiene.
    setValor(
      'categoria',
      datos.categoria ?? categoriaMueblePorDefecto(categoriasCargadas)?.id ?? '',
    );
    setValor('estado_conservacion', datos.estado_conservacion || 'bueno');
    setValor('valor_estimado', datos.valor_estimado);
    setValor('descripcion', datos.descripcion);
    setValor('dueno_externo_nombre', datos.dueno_externo_nombre);
    setValor('beneficiario', datos.beneficiario ?? '');
    CAMPOS_PATRIMONIALES.forEach((c) =>
      setValor(c.clave, datos[c.clave as keyof DatosObjetoEspacio]),
    );

    fotosExistentes = Array.isArray(datos.fotos) ? datos.fotos : [];
    renderFotosExistentes();
    fotosNuevas = [];
    renderFotosNuevas();
    listo = true;
  };

  const limpiar = (): void => {
    datosActuales = {};
    campos.forEach((el) => {
      el.value = '';
    });
    setValor('estado_conservacion', 'bueno');
    setValor('categoria', categoriaMueblePorDefecto(categoriasCargadas)?.id ?? '');
    fotosExistentes = [];
    renderFotosExistentes();
    fotosNuevas = [];
    renderFotosNuevas();
    listo = true;
  };

  const cargar = async (url: string): Promise<void> => {
    await cargarCatalogos();
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      throw new Error(`No se pudieron cargar las propiedades del objeto (${res.status}).`);
    }
    const datos: DatosObjetoEspacio = await res.json();
    precargar(datos);
  };

  const recolectar = (): { datos: Record<string, string>; fotos: File[] } => {
    const datos: Record<string, string> = {};
    campos.forEach((el, clave) => {
      datos[clave] = el.value.trim();
    });
    datos.objeto_id = datosActuales.objeto_id ? String(datosActuales.objeto_id) : '';
    return { datos, fotos: [...fotosNuevas] };
  };

  camaraInput?.addEventListener('change', () => {
    agregarFotos(camaraInput.files);
    camaraInput.value = '';
  });
  galeriaInput?.addEventListener('change', () => {
    agregarFotos(galeriaInput.files);
    galeriaInput.value = '';
  });

  const controlador: ControladorCamposObjeto = {
    cargar,
    precargar,
    limpiar,
    estaListo: () => listo,
    recolectar,
  };
  controladores.set(scope, controlador);
  return controlador;
}

