// Aplica el tema (guardado, o el del sistema si no hay uno) antes de pintar la página, para que no parpadee.
try {
  const t = localStorage.getItem('sigpar_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
} catch (e) { /* sin almacenamiento */ }
