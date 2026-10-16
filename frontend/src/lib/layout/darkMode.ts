// =============================================================================
// DARK MODE TOGGLE (layout)
// Extraído de layouts/BaseLayout.astro (Fase A · refactor preventivo).
// =============================================================================


  // ===========================================================================
  // DARK MODE TOGGLE
  // ===========================================================================

  const darkModeToggle = document.getElementById('darkModeToggle')!;
  const sunIcon = document.getElementById('sunIcon')!;
  const moonIcon = document.getElementById('moonIcon')!;

  function setDarkMode(enabled: boolean) {
    if (enabled) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('estok_dark_mode', 'true');
      sunIcon?.classList.remove('hidden');
      moonIcon?.classList.add('hidden');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('estok_dark_mode', 'false');
      sunIcon?.classList.add('hidden');
      moonIcon?.classList.remove('hidden');
    }
  }

  // Inicializar desde localStorage o preferencia del sistema
  const savedDarkMode = localStorage.getItem('estok_dark_mode');
  if (savedDarkMode === 'true') {
    setDarkMode(true);
  } else if (savedDarkMode === null && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    setDarkMode(true);
  }

  darkModeToggle?.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    setDarkMode(!isDark);
  });
