import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Monitor, Check, ChevronDown } from 'lucide-react';

const MODES = ['light', 'dark', 'system'];
const MODE_META = {
  light: { icon: Sun, label: 'Sáng' },
  dark: { icon: Moon, label: 'Tối' },
  system: { icon: Monitor, label: 'Hệ thống' }
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
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

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

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (m) => {
    setMode(m);
    setOpen(false);
  };

  const { icon: Icon, label } = MODE_META[mode];
  return (
    <div className="theme-toggle-wrap" ref={wrapRef}>
      <button
        className="theme-toggle"
        onClick={() => setOpen(o => !o)}
        title="Chọn giao diện"
        aria-label={`Giao diện: ${label}`}
        aria-expanded={open}
      >
        <Icon size={15} />
        <span className="theme-toggle-label">{label}</span>
        <ChevronDown size={13} className={`theme-toggle-caret ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="theme-toggle-menu" role="menu">
          {MODES.map((m) => {
            const { icon: MIcon, label: mLabel } = MODE_META[m];
            const active = m === mode;
            return (
              <button
                key={m}
                role="menuitem"
                className={`theme-toggle-option ${active ? 'active' : ''}`}
                onClick={() => select(m)}
              >
                <MIcon size={15} />
                <span>{mLabel}</span>
                {active && <Check size={14} className="theme-toggle-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ThemeToggle;
