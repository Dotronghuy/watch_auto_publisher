import { useState, useEffect } from 'react';
import { Search, User, RefreshCw, Play, Square, Command } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from './ThemeToggle';
import CommandPalette from './CommandPalette';
import './Topbar.css';

const Topbar = () => {
  const { user } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/dashboard');
        const data = await res.json();
        setIsRunning(data.activeWorkflows > 0);
      } catch (e) {}
    };
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Mở palette bằng Ctrl+K / Cmd+K hoặc phím "/"
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = e.target?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.target?.isContentEditable) {
          e.preventDefault();
          setPaletteOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header className="topbar">
      <button
        className="topbar-search"
        onClick={() => setPaletteOpen(true)}
        aria-label="Tìm kiếm nhanh (Ctrl+K)"
        title="Tìm kiếm nhanh — Ctrl+K hoặc /"
      >
        <Search size={16} className="search-icon" />
        <span className="search-placeholder">Tìm kiếm trang, tính năng...</span>
        <span className="search-shortcut">
          <Command size={12} style={{ marginRight: '2px' }} /> K
        </span>
      </button>

      <div className="topbar-actions">
        <button className="btn-outline" onClick={async () => {
          try {
            await fetch('/api/trigger-sync', { method: 'POST' });
            Swal.fire('Thành công', 'Đã gửi lệnh quét Google Sheet!', 'success');
          } catch (e) {
            Swal.fire('Lỗi', 'Không thể đồng bộ', 'error');
          }
        }}>
          <RefreshCw size={14} style={{marginRight: '6px'}} /> 
          Đồng bộ Sheet
        </button>

        {isRunning ? (
          <button className="btn-primary" style={{ backgroundColor: 'var(--color-danger)' }} onClick={async () => {
            try {
              await fetch('/api/stop-workflow', { method: 'POST' });
              Swal.fire({
                title: 'Đã gửi lệnh Dừng',
                text: 'Hệ thống đã yêu cầu dừng tiến trình. Backend sẽ dừng an toàn sau bước hiện tại.',
                icon: 'warning', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
                background: 'var(--color-surface)', color: 'var(--color-text)'
              });
            } catch(e) {}
            setIsRunning(false);
          }}>
            <Square size={14} style={{marginRight: '6px'}} fill="currentColor" />
            Dừng Auto
          </button>
        ) : (
          <button className="btn-primary glow-primary" onClick={async () => {
            Swal.fire({
              title: 'Kích hoạt hệ thống',
              text: 'Đang bắt đầu bốc bài chạy luồng AI...',
              icon: 'info', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000,
              background: 'var(--color-surface)', color: 'var(--color-text)'
            });
            setIsRunning(true);
            try {
              await fetch('/api/trigger-workflow', { method: 'POST' });
            } catch (e) {}
          }}>
            <Play size={14} style={{marginRight: '6px'}} />
            Chạy luồng ngay
          </button>
        )}

        <ThemeToggle />

        <div className="divider"></div>

        <div className="user-avatar-container" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="user-info" style={{ textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-main)' }}>{user?.username || 'Toby'}</span>
            <span style={{ fontSize: '11px', color: user?.role === 'admin' ? 'var(--color-primary)' : 'var(--text-dim)', fontWeight: '500' }}>
              {user?.role === 'admin' ? 'Quản trị viên' : 'Nhân viên'}
            </span>
          </div>
          <div className="user-avatar" style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)' }}>
            <User size={18} />
          </div>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </header>
  );
};

export default Topbar;
