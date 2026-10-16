// =============================================================================
// TIPOS DEL DASHBOARD (payload de /api/objetos/estadisticas/)
// Extraido de pages/index.astro (Fase A refactor preventivo).
// =============================================================================

  // ===========================================================================
  // CONTRATO ANALÍTICO - Tipos del payload de /api/objetos/estadisticas/
  // ===========================================================================
  export interface DecisionPorUsuario {
    usuario_id: string;
    usuario_nombre: string;
    vender_publicado: number;
    vender_no_publicado: number;
    conservar: number;
    tirar: number;
    sin_decision: number;
  }

  export interface UltimoObjetoResumen {
    id: string;
    nombre: string;
    tipo: string | null;
    valor_estimado: number | null;
    fecha_registro: string;
  }

  export interface EstadisticasDashboard {
    total_objetos: number;
    valor_total_inventario: number;
    valor_promedio: number;
    total_ubicaciones: number;
    total_contenedores: number;
    objetos_por_categoria: Record<string, number>;
    valor_por_categoria: Record<string, number>;
    objetos_por_estado: Record<string, number>;
    objetos_por_carga: Record<string, number>;
    decisiones_por_usuario: DecisionPorUsuario[];
    ultimos_objetos: UltimoObjetoResumen[];
  }
