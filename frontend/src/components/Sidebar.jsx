import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Cloud, 
  Workflow, 
  Calendar, 
  Database, 
  Settings, 
  Upload, 
  HelpCircle, 
  LogOut 
} from 'lucide-react';
import Swal from 'sweetalert2';
import { motion } from 'framer-motion';
import './Sidebar.css';

const Sidebar = () => {
  const navItems = [
    { name: 'Tổng quan', path: '/', icon: LayoutDashboard },
    { name: 'Lưu trữ', path: '/drive', icon: Cloud },
    { name: 'Luồng công việc', path: '/workflow', icon: Workflow },
    { name: 'Lịch đăng', path: '/calendar', icon: Calendar },
    { name: 'Dữ liệu SP', path: '/database', icon: Database },
    { name: 'Cài đặt', path: '/settings', icon: Settings },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-icon glass">
          <Workflow size={20} color="var(--color-primary)" />
        </div>
        <div className="logo-text">
          <h2>Omni Flow</h2>
          <span>Gói Pro</span>
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
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <button 
          className="btn-upgrade glow-primary"
          onClick={() => {
            Swal.fire({
              title: 'Tài khoản VIP',
              text: 'Bạn đang sử dụng phiên bản phần mềm không giới hạn tài nguyên dành cho nội bộ.',
              icon: 'info',
              confirmButtonColor: 'var(--color-primary)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)'
            });
          }}
        >
          <Upload size={16} /> Nâng cấp ngay
        </button>
        <ul className="footer-links">
          <li>
            <a href="#" className="footer-link">
              <HelpCircle size={18} />
              <span>Trợ giúp</span>
            </a>
          </li>
          <li>
            <a href="#" className="footer-link">
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
