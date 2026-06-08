import { useState, useEffect, useRef } from 'react';
import { Search, User, RefreshCw, Play, Square, Command, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { useAuth } from '../context/AuthContext';
import './Topbar.css';

const SEARCH_ITEMS = [
  { title: 'Tổng quan', path: '/', description: 'Xem thống kê hệ thống' },
  { title: 'Lưu trữ', path: '/drive', description: 'Quản lý Drive và kết nối' },
  { title: 'Luồng công việc', path: '/workflow', description: 'Cấu hình và theo dõi luồng AI' },
  { title: 'Lịch đăng', path: '/calendar', description: 'Cài đặt khung giờ chạy Auto' },
  { title: 'Dữ liệu SP', path: '/database', description: 'Quản lý file sản phẩm nguồn' },
  { title: 'Cài đặt', path: '/settings', description: 'Cấu hình mạng xã hội' }
];

const Topbar = () => {
  const { user } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const searchRef = useRef(null);

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

  // Handle Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close search on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target) && !e.target.closest('.search-dropdown')) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredItems = SEARCH_ITEMS.filter(item => 
    item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleKeyDown = (e) => {
    if (!isSearchOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        navigate(filteredItems[selectedIndex].path);
        setIsSearchOpen(false);
        setSearchQuery('');
        searchRef.current?.blur();
      }
    } else if (e.key === 'Escape') {
      setIsSearchOpen(false);
      searchRef.current?.blur();
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-search" style={{ position: 'relative' }}>
        <Search size={16} className="search-icon" />
        <input 
          ref={searchRef}
          type="text" 
          placeholder="Tìm kiếm trang, tính năng... (Ctrl + K)" 
          className="search-input glow-primary"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSelectedIndex(0);
            setIsSearchOpen(true);
          }}
          onFocus={() => setIsSearchOpen(true)}
          onKeyDown={handleKeyDown}
        />
        <div className="search-shortcut">
          <Command size={12} style={{marginRight: '2px'}} /> K
        </div>

        {/* Dropdown Kết quả tìm kiếm */}
        {isSearchOpen && (
          <div className="search-dropdown">
            {filteredItems.length > 0 ? (
              filteredItems.map((item, idx) => (
                <div 
                  key={idx} 
                  className={`search-result-item ${idx === selectedIndex ? 'active' : ''}`}
                  onClick={() => {
                    navigate(item.path);
                    setIsSearchOpen(false);
                    setSearchQuery('');
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="search-result-info">
                    <h4>{item.title}</h4>
                    <p>{item.description}</p>
                  </div>
                  <ChevronRight size={14} className="search-result-arrow" />
                </div>
              ))
            ) : (
              <div className="search-empty">
                <p>Không tìm thấy kết quả phù hợp cho "{searchQuery}"</p>
              </div>
            )}
          </div>
        )}
      </div>

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
    </header>
  );
};

export default Topbar;
