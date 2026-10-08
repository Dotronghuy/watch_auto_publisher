const VALID_MODES = ['light', 'dark', 'system'];

const applyTheme = (mode) => {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
};

let mode = 'system';
try {
  const saved = localStorage.getItem('zenwatch_theme');
  if (VALID_MODES.includes(saved)) mode = saved;
} catch (e) {}

const listeners = new Set();

export const getThemeMode = () => mode;

export const setThemeMode = (m) => {
  if (!VALID_MODES.includes(m)) return;
  mode = m;
  try { localStorage.setItem('zenwatch_theme', m); } catch (e) {}
  applyTheme(m);
  listeners.forEach((fn) => fn(m));
};

export const subscribeThemeMode = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (mode === 'system') applyTheme('system');
});
