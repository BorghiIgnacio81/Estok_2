// =============================================================================
// GENERADOR VISUAL ESPACIAL · MODAL DE 3 PASOS (motor reutilizable)
// -----------------------------------------------------------------------------
// Componente GENÉRICO que cualquier nivel de la jerarquía de almacenamiento
// puede abrir con `abrirGeneradorVisualEspacial({ nivel, contexto, ... })`:
//
//   PASO 1 → Configuración de elementos (selectores rápidos por nivel).
//   PASO 2 → Galería de 4 plantillas 2D (miniaturas vectoriales).
//   PASO 3 → Inserción + ajuste fino en un lienzo arrastrable/redimensionable.
//
// También expone «Crear en blanco» en todos los pasos: saltea las plantillas y
// delega el alta manual en el callback del nivel que abrió el modal.
//
// NOTA DE IMPLEMENTACIÓN: el proyecto NO usa React (Astro + TypeScript vanilla,
// ver package.json). El archivo conserva la extensión .tsx pedida por el
// requerimiento, pero su contenido es TypeScript puro que construye DOM con
// plantillas: sin JSX, sin runtime adicional. El componente sólo se monta al
// abrirse y se desmonta al cerrar (cero peso en el layout de las páginas).
// =============================================================================

import { crearLienzoAjuste } from '../lib/generadorVisualEspacial/lienzoAjuste';
import {
  configuracionDeNivel,
  geometriaSugerida,
  nombreDeNivel,
  presetsDeNivel,
} from '../lib/generadorVisualEspacial/presetsEspaciales';
import type {
  ConfiguracionNivel,
  ElementoEspacial,
  ParametrosGeneradorEspacial,
  PresetEspacial,
} from '../lib/generadorVisualEspacial/presetsEspaciales';
import {
  htmlPaso1,
  htmlPaso2,
  htmlPaso3,
  htmlPasos,
  htmlResumen,
} from '../lib/generadorVisualEspacial/htmlGenerador';
import { escapeHtml } from '../lib/escapeHtml';
import { showToast } from '../lib/toast';

/** Contrato que implementa cada nivel para persistir la plantilla. */
export interface OpcionesGeneradorVisualEspacial extends ParametrosGeneradorEspacial {
  /** Alta de UN elemento con su nombre y geometría ya definidos. */
  crearElemento: (elemento: ElementoEspacial) => Promise<boolean>;
  /** «Crear en blanco»: alta manual sin plantilla (comportamiento original). */
  crearEnBlanco?: () => boolean | void | Promise<boolean | void>;
  /** Refresco único al terminar la inserción (evita N repintados). */
  alInsertar?: () => void;
}

const ID_RAIZ = 'gveRaiz';

/** Quita cualquier instancia previa (el modal es único en el documento). */
function limpiarInstancia(): void {
  document.getElementById(ID_RAIZ)?.remove();
  document.body.classList.remove('gve-bloqueo-scroll');
}

/**
 * Abre el Generador Visual Espacial 2D en el nivel indicado.
 * Idempotente: si ya había un modal abierto, lo reemplaza.
 */
export function abrirGeneradorVisualEspacial(opciones: OpcionesGeneradorVisualEspacial): void {
  limpiarInstancia();

  const nivel = opciones.nivel;
  let config: ConfiguracionNivel = configuracionDeNivel(nivel, opciones.configuracionInicial);
  let presets: PresetEspacial[] = presetsDeNivel(nivel, config);
  let paso: 1 | 2 | 3 = 1;
  let presetId: string | null = presets[0]?.id ?? null;
  let elementos: ElementoEspacial[] = [];
  let insertando = false;

  const raiz = document.createElement('div');
  raiz.id = ID_RAIZ;
  raiz.className = 'gve-root';
  raiz.setAttribute('role', 'dialog');
  raiz.setAttribute('aria-modal', 'true');
  raiz.setAttribute('aria-labelledby', 'gveTitulo');
  document.body.appendChild(raiz);
  document.body.classList.add('gve-bloqueo-scroll');

  function cerrar(): void {
    document.removeEventListener('keydown', alTeclear);
    document.body.classList.remove('gve-bloqueo-scroll');
    raiz.remove();
  }

  function alTeclear(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') cerrar();
  }
  document.addEventListener('keydown', alTeclear);

  // El clic en el fondo oscuro (fuera del panel) cierra el modal.
  raiz.addEventListener('click', (ev) => {
    if (ev.target === raiz) cerrar();
  });

  function irAPaso(nuevo: 1 | 2 | 3): void {
    if (nuevo === 2) {
      presets = presetsDeNivel(nivel, config);
      if (!presetId || !presets.some((p) => p.id === presetId)) {
        presetId = presets[0]?.id ?? null;
      }
    }
    paso = nuevo;
    render();
  }

  function usarPlantilla(): void {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    elementos = preset.elementos.map((el) => ({ ...el }));
    paso = 3;
    render();
  }

  function dividir(indice: number): void {
    const el = elementos[indice];
    if (!el || el.height < 12) return;
    const mitad = Math.round((el.height / 2) * 100) / 100;
    const copia: ElementoEspacial = {
      ...el,
      nombre: `${el.nombre} B`,
      top: Math.round((el.top + mitad) * 100) / 100,
      height: mitad,
    };
    el.nombre = `${el.nombre} A`;
    el.height = mitad;
    elementos.splice(indice + 1, 0, copia);
  }

  async function crearEnBlanco(boton: HTMLButtonElement): Promise<void> {
    if (!opciones.crearEnBlanco) {
      cerrar();
      return;
    }
    boton.disabled = true;
    try {
      const resultado = await opciones.crearEnBlanco();
      if (resultado === false) {
        showToast('❌ No se pudo crear el espacio en blanco. Intentá de nuevo.', 'error');
        boton.disabled = false;
        return;
      }
      showToast('✅ Espacio en blanco creado. Ajustalo desde el mapa 2D.', 'success');
      cerrar();
    } catch {
      showToast('❌ Error de conexión al crear el espacio en blanco.', 'error');
      boton.disabled = false;
    }
  }

  async function insertar(boton: HTMLButtonElement): Promise<void> {
    if (insertando || elementos.length === 0) return;
    insertando = true;
    const textoOriginal = boton.textContent ?? 'Insertar en el mapa';
    boton.disabled = true;
    boton.textContent = 'Insertando…';
    let insertados = 0;
    for (const el of elementos) {
      try {
        if (await opciones.crearElemento({ ...el })) insertados += 1;
      } catch {
        // Un fallo puntual no aborta el resto de la plantilla.
      }
    }
    insertando = false;
    if (insertados > 0) {
      const sufijo = insertados === 1 ? '' : 's';
      showToast(
        `✅ ${insertados} espacio${sufijo} insertado${sufijo} desde la plantilla. Arrastralo${sufijo} para retocar.`,
        'success',
      );
      opciones.alInsertar?.();
      cerrar();
      return;
    }
    showToast('❌ No se pudo insertar la plantilla. Revisá la conexión e intentá de nuevo.', 'error');
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }

  function cuerpoPaso(): string {
    if (paso === 2) return htmlPaso2(presets, presetId);
    if (paso === 3) return htmlPaso3(elementos);
    return htmlPaso1(nivel, config);
  }

  function piePaso(): string {
    const crearBlanco =
      '<button type="button" class="gve-btn gve-btn--fantasma" data-gve-crear-blanco>✏️ Crear en blanco</button>';
    if (paso === 1) {
      return `<div class="gve-pie-izq">${crearBlanco}</div>
        <button type="button" class="gve-btn gve-btn--primario" data-gve-siguiente>Ver 4 plantillas 2D →</button>`;
    }
    if (paso === 2) {
      return `<button type="button" class="gve-btn gve-btn--secundario" data-gve-volver-1>← Volver</button>
        <div class="gve-pie-izq">${crearBlanco}</div>
        <button type="button" class="gve-btn gve-btn--primario" data-gve-usar${presetId ? '' : ' disabled'}>Usar esta plantilla →</button>`;
    }
    const total = elementos.length;
    return `<button type="button" class="gve-btn gve-btn--secundario" data-gve-volver-2>← Plantillas</button>
      <div class="gve-pie-izq">${crearBlanco}</div>
      <button type="button" class="gve-btn gve-btn--primario" data-gve-insertar${total === 0 ? ' disabled' : ''}>
        Insertar ${total} espacio${total === 1 ? '' : 's'} en el mapa
      </button>`;
  }

  function render(): void {
    raiz.innerHTML = `<div class="gve-panel">
      <header class="gve-cab">
        <div class="gve-cab-texto">
          <p class="gve-nivel">${nombreDeNivel(nivel)}</p>
          <h2 class="gve-titulo" id="gveTitulo">${escapeHtml(opciones.contexto.titulo)}</h2>
          ${opciones.contexto.descripcion ? `<p class="gve-sub">${escapeHtml(opciones.contexto.descripcion)}</p>` : ''}
        </div>
        <button type="button" class="gve-cerrar" data-gve-cerrar aria-label="Cerrar el generador visual">✕</button>
      </header>
      ${htmlPasos(paso)}
      <div class="gve-cuerpo">${cuerpoPaso()}</div>
      <footer class="gve-pie">${piePaso()}</footer>
    </div>`;
    enlazar();
  }

  function enlazar(): void {
    raiz
      .querySelectorAll<HTMLElement>('[data-gve-cerrar]')
      .forEach((btn) => btn.addEventListener('click', cerrar));

    raiz.querySelectorAll<HTMLSelectElement>('[data-gve-campo]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const clave = sel.dataset.gveCampo as keyof ConfiguracionNivel;
        config[clave] = Number(sel.value);
        if (config.mueblesAltos > config.muebles) {
          config.mueblesAltos = config.muebles;
          const altos = raiz.querySelector<HTMLSelectElement>('[data-gve-campo="mueblesAltos"]');
          if (altos) altos.value = String(config.mueblesAltos);
        }
        presets = presetsDeNivel(nivel, config);
        const resumen = raiz.querySelector<HTMLElement>('[data-gve-resumen]');
        if (resumen) resumen.innerHTML = htmlResumen(nivel, config);
      });
    });

    raiz.querySelectorAll<HTMLElement>('[data-gve-preset]').forEach((tarjeta) => {
      tarjeta.addEventListener('click', () => {
        presetId = tarjeta.dataset.gvePreset ?? null;
        raiz.querySelectorAll<HTMLElement>('[data-gve-preset]').forEach((otra) => {
          const activa = otra === tarjeta;
          otra.classList.toggle('gve-preset--activo', activa);
          otra.setAttribute('aria-pressed', String(activa));
        });
        const usar = raiz.querySelector<HTMLButtonElement>('[data-gve-usar]');
        if (usar) usar.disabled = presetId === null;
      });
    });

    raiz.querySelector('[data-gve-siguiente]')?.addEventListener('click', () => irAPaso(2));
    raiz.querySelector('[data-gve-volver-1]')?.addEventListener('click', () => irAPaso(1));
    raiz.querySelector('[data-gve-volver-2]')?.addEventListener('click', () => irAPaso(2));
    raiz.querySelector('[data-gve-usar]')?.addEventListener('click', usarPlantilla);
    raiz.querySelectorAll<HTMLButtonElement>('[data-gve-crear-blanco]').forEach((btn) => {
      btn.addEventListener('click', () => void crearEnBlanco(btn));
    });
    raiz.querySelector<HTMLButtonElement>('[data-gve-insertar]')?.addEventListener('click', (ev) => {
      void insertar(ev.currentTarget as HTMLButtonElement);
    });

    raiz.querySelector('[data-gve-agregar]')?.addEventListener('click', () => {
      const indice = elementos.length;
      elementos.push({
        nombre: `Subdivisión ${indice + 1}`,
        icono: '🧩',
        ...geometriaSugerida(indice),
      });
      render();
    });

    raiz.querySelectorAll<HTMLInputElement>('[data-gve-nombre]').forEach((input) => {
      input.addEventListener('input', () => {
        const indice = Number(input.dataset.gveNombre);
        const el = elementos[indice];
        if (!el) return;
        el.nombre = input.value;
        const rotulo = raiz.querySelector<HTMLElement>(
          `[data-gve-item="${indice}"] .gve-lienzo-nombre`,
        );
        if (rotulo) rotulo.textContent = input.value;
      });
    });

    raiz.querySelectorAll<HTMLElement>('[data-gve-quitar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        elementos.splice(Number(btn.dataset.gveQuitar), 1);
        render();
      });
    });

    raiz.querySelectorAll<HTMLElement>('[data-gve-dividir]').forEach((btn) => {
      btn.addEventListener('click', () => {
        dividir(Number(btn.dataset.gveDividir));
        render();
      });
    });

    const hostLienzo = raiz.querySelector<HTMLElement>('[data-gve-lienzo]');
    if (hostLienzo) {
      crearLienzoAjuste({ host: hostLienzo, elementos, alEditar: () => undefined });
    }
  }

  render();
  raiz.querySelector<HTMLButtonElement>('[data-gve-cerrar]')?.focus();
}
