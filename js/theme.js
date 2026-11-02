(() => {
  const root = document.documentElement;
  const storageKey = 'lifefabs-theme';
  const logoSelector = 'img[data-logo-dark][data-logo-light]';
  function getSavedTheme() {
    try { const saved = localStorage.getItem(storageKey); return saved === 'light' || saved === 'dark' ? saved : 'dark'; }
    catch (_) { return 'dark'; }
  }
  function applyTheme(theme, persist = false) {
    const chosen = theme === 'light' ? 'light' : 'dark';
    root.dataset.theme = chosen;
    document.querySelectorAll(logoSelector).forEach(img => {
      img.src = chosen === 'dark' ? img.dataset.logoDark : img.dataset.logoLight;
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = chosen === 'dark' ? '#05070d' : '#f7f8fc';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const toLight = chosen === 'dark';
      button.setAttribute('aria-pressed', String(chosen === 'light'));
      button.setAttribute('aria-label', toLight ? 'Switch to bright theme' : 'Switch to dark theme');
      button.title = toLight ? 'Switch to bright theme' : 'Switch to dark theme';
      const icon = button.querySelector('.theme-toggle-icon');
      const label = button.querySelector('.theme-toggle-label');
      if (icon) icon.textContent = toLight ? '☼' : '◐';
      if (label) label.textContent = toLight ? 'Bright mode' : 'Dark mode';
    });
    if (persist) {
      try { localStorage.setItem(storageKey, chosen); } catch (_) { /* Storage may be disabled. */ }
    }
  }
  applyTheme(getSavedTheme());
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-theme-toggle]');
    if (!button) return;
    applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
})();
