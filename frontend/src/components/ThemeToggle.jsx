import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

const MODES = ['light', 'dark', 'system'];
const MODE_META = {
  light: { icon: Sun, label: 'Sáng' },
  dark: { icon: Moon, label: 'Tối' },
  system: { icon: Monitor, label: 'Tự động' }
};

const applyTheme = (mode) => {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
};

const ThemeToggle = () => {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem('zenwatch_theme') || 'system';
    } catch (e) {
      return 'system';
    }
  });

  useEffect(() => {
    applyTheme(mode);
    try { localStorage.setItem('zenwatch_theme', mode); } catch (e) {}

    if (mode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [mode]);

  const cycle = () => setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]);

  const { icon: Icon, label } = MODE_META[mode];
  return (
    <button
      className="theme-toggle"
      onClick={cycle}
      title={`Giao diện: ${label} — bấm để đổi`}
      aria-label={`Chế độ giao diện: ${label}`}
    >
      <Icon size={15} />
      <span className="theme-toggle-label">{label}</span>
    </button>
  );
};

export default ThemeToggle;
