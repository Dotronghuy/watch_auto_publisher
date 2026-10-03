import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Cloud, 
  Workflow, 
  Calendar, 
  Database, 
  Settings, 
  LogOut,
  MessageCircle,
  ShoppingBag,
  Send
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import './Sidebar.css';

const Sidebar = () => {
  const { hasPermission, logout } = useAuth();

  // Fetch unreplied count for CRM badge
  const [unrepliedCount, setUnrepliedCount] = useState(0);
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch('/api/crm/conversations');
        const data = await res.json();
        setUnrepliedCount(data.filter(c => c.needs_reply).length);
      } catch (e) { /* ignore */ }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 10000);
    return () => clearInterval(interval);
  }, []);

  const allNavItems = [
    { name: 'Tổng quan', path: '/', icon: LayoutDashboard, permission: 'dashboard' },
    { name: 'Lưu trữ', path: '/drive', icon: Cloud, permission: 'drive' },
    { name: 'Luồng công việc', path: '/workflow', icon: Workflow, permission: 'workflow' },
    { name: 'Lịch đăng', path: '/calendar', icon: Calendar, permission: 'calendar' },
    { name: 'Hộp thư (CRM)', path: '/inbox', icon: MessageCircle, permission: 'inbox' },
    { name: 'Shopee Manager', path: '/shopee', icon: ShoppingBag, permission: 'shopee' },
    { name: 'Dữ liệu SP', path: '/database', icon: Database, permission: 'database' },
    { name: 'Zalo Auto Post', path: '/zenwatch/zalo', icon: Send, permission: 'zalo' },
    { name: 'Cài đặt', path: '/settings', icon: Settings, permission: 'settings' }
  ];

  const navItems = allNavItems.filter(item => hasPermission(item.permission));

  const handleLogout = (e) => {
    e.preventDefault();
    logout();
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-icon glass animate-float" style={{ padding: 0, overflow: 'hidden' }}>
          <img src="/logo-z.png" alt="ZenWatch Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div className="logo-text">
          <h2>ZenWatch Flow</h2>
        </div>
      </div>

      <nav className="sidebar-nav">
        <ul>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.path}>
                <NavLink 
                  to={item.path} 
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.div 
                          layoutId="active-nav-bg"
                          className="nav-link-bg"
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        />
                      )}
                      <Icon size={20} className="nav-icon" />
                      <span className="nav-text">{item.name}</span>
                      {item.path === '/inbox' && unrepliedCount > 0 && (
                        <span className="sidebar-badge">{unrepliedCount}</span>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <ul className="footer-links">
          <li>
            <a href="#" className="footer-link" onClick={handleLogout}>
              <LogOut size={18} />
              <span>Đăng xuất</span>
            </a>
          </li>
        </ul>
      </div>
    </aside>
  );
};

export default Sidebar;
