// =============================================================================
// ROLES DE ESTOK - Helpers compartidos del navbar (desktop y móvil)
// Extraído de layouts/BaseLayout.astro (Fase A · refactor preventivo).
// =============================================================================

/** Clase Tailwind del badge según el rol del usuario dentro del Estok. */
export function getRoleBadgeClass(role: string | null): string {
  switch (role) {
    case 'Admin': return 'bg-purple-100 text-purple-700';
    case 'Editor': return 'bg-blue-100 text-blue-700';
    case 'Visualizador': return 'bg-gray-100 text-gray-700';
    default: return 'bg-gray-100 text-gray-500';
  }
}
