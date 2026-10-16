// =============================================================================
// DASHBOARD - AI HEARTBEAT (badge IA Conectada / Modo Manual)
// Extraido de pages/index.astro (Fase A refactor preventivo).
// =============================================================================

  // ===========================================================================
  // AI HEARTBEAT (PROTEGIDO)
  // ---------------------------------------------------------------------------
  // El navegador NO debe hablar directo con el motor de IA: la llamada sale
  // SIEMPRE por el backend (endpoint /objetos/test_ia_stress/) para no exponer
  // credenciales en el cliente ni disparar errores de conexión en bucle.
  //
  // El chequeo se deriva EXCLUSIVAMENTE de la variable de entorno PUBLIC_API_URL
  // (la misma que alimenta API_BASE_URL). Si NO está definida explícitamente en
  // el build, el chequeo se DESACTIVA por completo: el badge queda en
  // "Modo Manual" sin ningún fetch ni setInterval. Un fallo acá NUNCA aborta la
  // inicialización del resto del Dashboard.
  // ===========================================================================

  const AI_MODELS_URL = import.meta.env.PUBLIC_API_URL
    ? `${import.meta.env.PUBLIC_API_URL}/ai/models/`
    : null;

  const aiStatusBadge = document.getElementById('aiStatusBadge')!;
  const aiStatusDot = document.getElementById('aiStatusDot')!;
  const aiStatusText = document.getElementById('aiStatusText')!;

  async function checkAIAvailability(): Promise<boolean> {
    // Sin URL de IA derivada de PUBLIC_API_URL → chequeo deshabilitado.
    if (!AI_MODELS_URL) return false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(AI_MODELS_URL, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  async function updateAIStatus() {
    const connected = await checkAIAvailability();
    if (connected) {
      aiStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700';
      aiStatusDot.className = 'w-2 h-2 rounded-full bg-green-500';
      aiStatusText.textContent = 'IA Conectada';
    } else {
      aiStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500';
      aiStatusDot.className = 'w-2 h-2 rounded-full bg-gray-400';
      aiStatusText.textContent = 'Modo Manual';
    }
  }

  // Estado inicial: si el chequeo está deshabilitado, badge "Modo Manual" al toque.
  updateAIStatus();
  // El intervalo SOLO se programa si existe una URL de IA configurada.
  if (AI_MODELS_URL) setInterval(updateAIStatus, 30000);
