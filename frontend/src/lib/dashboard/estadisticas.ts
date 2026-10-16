// =============================================================================
// DASHBOARD - Orquestador (refs DOM, boton Mudanza, carga de estadisticas)
// Extraido de pages/index.astro (Fase A refactor preventivo).
// =============================================================================

import { getAuthHeaders, getCachedUser, API_BASE_URL } from '../../services/auth';
import { initGodMode } from '../godMode';
import './iaEstado';
import './pwa';
import {
  renderBarChart,
  renderUltimos,
  renderCategorias,
  renderBarrasApiladas,
  renderPieSVG,
  ESTADO_LABELS,
} from './graficos';
import type { EstadisticasDashboard } from './tipos';

  const loadingState = document.getElementById('loadingState')!;
  const errorState = document.getElementById('errorState')!;
  const errorMessage = document.getElementById('errorMessage')!;
  const retryBtn = document.getElementById('retryBtn')!;
  const dashboardContent = document.getElementById('dashboardContent')!;

  // ===========================================================================
  // BOTÓN "MUDANZA" — VISIBILIDAD RESTRINGIDA
  // Se renderiza SOLO si el usuario posee MÁS DE UN Estok activo en su arreglo
  // de membresías (user.estoks.length > 1). Con uno solo, NO se inserta en el DOM.
  // ===========================================================================
  const mudanzaBtnContainer = document.getElementById('mudanzaBtnContainer');
  const usuarioCacheado = getCachedUser();
  if (mudanzaBtnContainer && usuarioCacheado && (usuarioCacheado.estoks?.length || 0) > 1) {
    // SIMETRÍA WEB: el ancla ocupa todo su contenedor (flex-1 de la fila de
    // acciones rápidas) y centra la imagen, que escala exactamente igual que el
    // CTA "Nuevo Objeto" (h-24 / md:h-32 / lg:h-36 = 96/128/144px) para que las
    // dos acciones queden en paralelo con anchos proporcionales idénticos.
    // La imagen es 1:1 (1254×1254), por lo que h-* define también el ancho;
    // `w-auto max-w-full object-contain` evita deformación y desborde en móvil.
    mudanzaBtnContainer.innerHTML = `
      <a href="/mudanza" class="flex items-center justify-center w-full" aria-label="Mudanza Inter-Estok"
        title="Transferir contenedores y objetos entre tus Estoks">
        <img src="/mudanza.png" alt="Mudanza" class="h-24 md:h-32 lg:h-36 w-auto max-w-full hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer object-contain" />
      </a>`;
  }


  // ===========================================================================
  // CARGA DE ESTADÍSTICAS
  // ===========================================================================

  async function cargarEstadisticas() {
    loadingState.classList.remove('hidden');
    errorState.classList.add('hidden');
    dashboardContent.classList.add('hidden');

    try {
      const response = await fetch(`${API_BASE_URL}/objetos/estadisticas/`, {
        headers: getAuthHeaders(),
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (!response.ok) {
        throw new Error(`Error del servidor (${response.status})`);
      }

      const data = (await response.json()) as EstadisticasDashboard;

      // === Mosaicos de totales ===
      document.getElementById('kpiTotalObjetos')!.textContent = data.total_objetos.toString();
      document.getElementById('kpiValorTotal')!.textContent = `$${Number(data.valor_total_inventario).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
      document.getElementById('kpiUbicaciones')!.textContent = data.total_ubicaciones.toString();
      document.getElementById('kpiContenedores')!.textContent = (data.total_contenedores ?? 0).toString();

      // === Analíticas nativas (sin librerías externas) ===
      renderBarrasApiladas(data.decisiones_por_usuario || []);
      renderPieSVG('pieCategoriasContainer', data.objetos_por_categoria || {});



      // === Estado de conservación (barras) ===
      renderBarChart('estadosContainer', data.objetos_por_estado, ESTADO_LABELS, data.total_objetos);

      // === Últimos objetos ===
      renderUltimos(data.ultimos_objetos);

      // === Cargar cards dinámicas de categorías (11 Meli desde /api/categorias/) ===
      renderCategorias();


      // === Mostrar dashboard ===
      loadingState.classList.add('hidden');
      errorState.classList.add('hidden');
      dashboardContent.classList.remove('hidden');

    } catch (err: any) {
      console.error('Error al cargar estadísticas:', err);
      loadingState.classList.add('hidden');
      errorState.classList.remove('hidden');
      errorMessage.textContent = err.message || 'Error de conexión. Verifica que el servidor esté corriendo.';
    }
  }

  // ===========================================================================
  // RETRY
  // ===========================================================================

  retryBtn?.addEventListener('click', cargarEstadisticas);

  // Carga inicial inmediata de estadísticas. NO espera al chequeo de IA ni a
  // ningún otro paso: si el fetch falla, se muestra el estado de error con el
  // botón "Reintentar" en lugar de quedarse congelado en "Cargando estadísticas...".
  cargarEstadisticas();

  // ===========================================================================
  // ADMIN GLOBAL - Panel de Control (logica en ../lib/godMode.ts)
  // ===========================================================================
  initGodMode();

