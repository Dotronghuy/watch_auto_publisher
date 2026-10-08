import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Cloud, Workflow, CalendarDays, Inbox, ShoppingBag,
  Database, Send, Settings, Users, Search, Play, Square, RefreshCw,
  TrendingUp, Sun, Moon, Monitor, LogOut, CornerDownLeft
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { setThemeMode } from '../themeStore';
import './CommandPalette.css';

const normalize = (s) => (s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd');

const PAGES = [
  { title: 'Tổng quan', desc: 'Thống kê hệ thống & tương tác', path: '/', icon: LayoutDashboard, keywords: 'dashboard home tong quan' },
  { title: 'Lưu trữ', desc: 'Quản lý Drive & kết nối', path: '/drive', icon: Cloud, keywords: 'drive luu tru storage' },
  { title: 'Luồng công việc', desc: 'Cấu hình và theo dõi luồng AI', path: '/workflow', icon: Workflow, keywords: 'workflow luong cong viec ai' },
  { title: 'Lịch đăng', desc: 'Cài đặt khung giờ chạy Auto', path: '/calendar', icon: CalendarDays, keywords: 'calendar lich dang khung gio' },
  { title: 'Hộp thư (CRM)', desc: 'Tin nhắn & chăm sóc khách hàng', path: '/inbox', icon: Inbox, keywords: 'inbox crm hop thu tin nhan' },
  { title: 'Shopee Manager', desc: 'Quản lý sản phẩm Shopee', path: '/shopee', icon: ShoppingBag, keywords: 'shopee san pham' },
  { title: 'Dữ liệu SP', desc: 'Quản lý file sản phẩm nguồn', path: '/database', icon: Database, keywords: 'database du lieu sp san pham' },
  { title: 'Zalo Auto Post', desc: 'Tự động đăng bài Zalo', path: '/zenwatch/zalo', icon: Send, keywords: 'zalo dang bai' },
  { title: 'Cài đặt', desc: 'Cấu hình mạng xã hội & tài khoản', path: '/settings', icon: Settings, keywords: 'settings cai dat cau hinh' },
  { title: 'Quản lý người dùng', desc: 'Phân quyền tài khoản', path: '/settings/users', icon: Users, keywords: 'user nguoi dung phan quyen' }
];

const ACTIONS = [
  {
    title: 'Chạy luồng ngay', desc: 'Kích hoạt luồng đăng bài AI', icon: Play, keywords: 'chay luong ngay run start auto',
    run: async () => { await fetch('/api/trigger-workflow', { method: 'POST' }); }
  },
  {
    title: 'Dừng Auto', desc: 'Dừng tiến trình đang chạy', icon: Square, keywords: 'dung stop auto',
    run: async () => { await fetch('/api/stop-workflow', { method: 'POST' }); }
  },
  {
    title: 'Đồng bộ dữ liệu', desc: 'Quét Google Sheet mới nhất', icon: RefreshCw, keywords: 'dong bo sync sheet du lieu',
    run: async () => { await fetch('/api/trigger-sync', { method: 'POST' }); }
  },
  {
    title: 'Theo dõi tương tác ngay', desc: 'Cập nhật like/comment/share', icon: TrendingUp, keywords: 'theo doi tuong tac track now like',
    run: async () => { await fetch('/api/dashboard/track-now', { method: 'POST' }); }
  }
];

const THEMES = [
  { title: 'Giao diện: Sáng', desc: 'Chuyển sang giao diện sáng', icon: Sun, keywords: 'theme giao dien sang light', run: () => setThemeMode('light') },
  { title: 'Giao diện: Tối', desc: 'Chuyển sang giao diện tối', icon: Moon, keywords: 'theme giao dien toi dark', run: () => setThemeMode('dark') },
  { title: 'Giao diện: Hệ thống', desc: 'Theo chế độ sáng/tối của máy', icon: Monitor, keywords: 'theme giao dien he thong system', run: () => setThemeMode('system') }
];

const match = (item, q) => {
  const hay = normalize(`${item.title} ${item.desc || ''} ${item.keywords || ''}`);
  return normalize(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

const CommandPalette = ({ open, onClose }) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();
  const { logout } = useAuth();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const selectedRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!open) return null;

  const q = query.trim();
  const groups = [];
  if (q) {
    const hits = [];
    PAGES.forEach((p) => { if (match(p, q)) hits.push({ ...p, type: 'page' }); });
    ACTIONS.forEach((a) => { if (match(a, q)) hits.push({ ...a, type: 'action' }); });
    THEMES.forEach((t) => { if (match(t, q)) hits.push({ ...t, type: 'theme' }); });
    if (match({ title: 'Đăng xuất', desc: 'Thoát tài khoản hiện tại', keywords: 'dang xuat logout thoat' }, q)) {
      hits.push({ title: 'Đăng xuất', desc: 'Thoát tài khoản hiện tại', icon: LogOut, type: 'logout' });
    }
    groups.push({ label: 'Kết quả', items: hits });
  } else {
    groups.push({ label: 'Điều hướng', items: PAGES.map((p) => ({ ...p, type: 'page' })) });
    groups.push({ label: 'Hành động', items: ACTIONS.map((a) => ({ ...a, type: 'action' })) });
    groups.push({ label: 'Giao diện', items: THEMES.map((t) => ({ ...t, type: 'theme' })) });
    groups.push({ label: 'Khác', items: [{ title: 'Đăng xuất', desc: 'Thoát tài khoản hiện tại', icon: LogOut, type: 'logout' }] });
  }

  const flat = groups.flatMap((g) => g.items);
  const selIdx = Math.min(selected, flat.length - 1);

  const execute = async (item) => {
    onClose();
    if (item.type === 'page') navigate(item.path);
    else if (item.type === 'logout') logout();
    else await item.run();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => (s + 1) % Math.max(flat.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => (s - 1 + Math.max(flat.length, 1)) % Math.max(flat.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[selIdx]) execute(flat[selIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let runningIndex = -1;

  return (
    <div className="palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-label="Tìm kiếm nhanh">
        <div className="palette-input-row">
          <Search size={17} className="palette-search-icon" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Tìm trang, tính năng, hành động..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={onKeyDown}
          />
          <span className="palette-esc">Esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {flat.length === 0 && (
            <div className="palette-empty">
              Không tìm thấy kết quả cho "{query}"
            </div>
          )}
          {groups.map((g) => {
            if (g.items.length === 0) return null;
            return (
              <div key={g.label} className="palette-group">
                <div className="palette-group-label">{g.label}</div>
                {g.items.map((item) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  const active = idx === selIdx;
                  const Icon = item.icon;
                  return (
                    <button
                      key={`${item.type}-${item.title}`}
                      ref={active ? selectedRef : null}
                      className={`palette-item ${active ? 'active' : ''}`}
                      onMouseMove={() => setSelected(idx)}
                      onClick={() => execute(item)}
                    >
                      <span className="palette-item-icon"><Icon size={16} /></span>
                      <span className="palette-item-text">
                        <span className="palette-item-title">{item.title}</span>
                        <span className="palette-item-desc">{item.desc}</span>
                      </span>
                      {active && <CornerDownLeft size={14} className="palette-item-enter" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="palette-footer">
          <span><kbd>↑↓</kbd> điều hướng</span>
          <span><kbd>↵</kbd> chọn</span>
          <span><kbd>Esc</kbd> đóng</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
