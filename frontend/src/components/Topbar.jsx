import { useState, useEffect } from 'react';
import { Search, Bell, Zap, User, RefreshCw, Play, Square } from 'lucide-react';
import Swal from 'sweetalert2';
import './Topbar.css';

const Topbar = () => {
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/dashboard');
        const data = await res.json();
        setIsRunning(data.activeWorkflows > 0);
      } catch (e) {}
    };
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, []);
  return (
    <header className="topbar">
      <div className="topbar-search">
        <Search size={18} className="search-icon" />
        <input 
          type="text" 
          placeholder="Tìm kiếm luồng, tệp, hoặc dữ liệu..." 
          className="search-input glow-primary"
        />
        <div className="search-shortcut">⌘K</div>
      </div>

      <div className="topbar-actions">
        <button className="icon-btn" onClick={() => {
            Swal.fire({
              title: 'Hệ thống tối ưu',
              text: 'Mọi luồng xử lý AI đều đang ở trạng thái tốt nhất.',
              icon: 'success',
              toast: true,
              position: 'top-end',
              showConfirmButton: false,
              timer: 3000,
              background: 'var(--color-surface)',
              color: 'var(--color-text)'
            });
          }}>
          <Zap size={18} />
        </button>
        <button className="icon-btn" onClick={() => {
            Swal.fire({
              title: 'Không có thông báo mới',
              text: 'Bạn đã đọc hết tất cả thông báo.',
              icon: 'info',
              toast: true,
              position: 'top-end',
              showConfirmButton: false,
              timer: 3000,
              background: 'var(--color-surface)',
              color: 'var(--color-text)'
            });
          }}>
          <Bell size={18} />
          <span className="badge"></span>
        </button>
        
        <div className="divider"></div>

        <button className="btn-outline" onClick={async () => {
          try {
            await fetch('http://localhost:3000/api/trigger-sync', { method: 'POST' });
            Swal.fire('Thành công', 'Đã gửi lệnh quét Google Sheet!', 'success');
          } catch (e) {
            console.error(e);
            Swal.fire('Lỗi', 'Không thể đồng bộ', 'error');
          }
        }}>
          <RefreshCw size={14} style={{marginRight: '6px'}} /> 
          Đồng bộ Sheet
        </button>

        {isRunning ? (
          <button className="btn-primary" style={{ backgroundColor: 'var(--color-danger)' }} onClick={async () => {
            try {
              await fetch('http://localhost:3000/api/stop-workflow', { method: 'POST' });
              Swal.fire({
                title: 'Đã gửi lệnh Dừng',
                text: 'Hệ thống đã yêu cầu dừng tiến trình. Backend sẽ dừng an toàn sau bước hiện tại.',
                icon: 'warning',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000,
                background: 'var(--color-surface)',
                color: 'var(--color-text)'
              });
            } catch(e) {
              Swal.fire('Lỗi', 'Không thể kết nối Backend để dừng.', 'error');
            }
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
              icon: 'info',
              toast: true,
              position: 'top-end',
              showConfirmButton: false,
              timer: 2000,
              background: 'var(--color-surface)',
              color: 'var(--color-text)'
            });
            
            setIsRunning(true);
            try {
              await fetch('http://localhost:3000/api/trigger-workflow', { method: 'POST' });
            } catch (e) {
              console.error(e);
              Swal.fire('Lỗi', 'Không thể khởi động luồng', 'error');
            }
          }}>
            <Play size={14} style={{marginRight: '6px'}} />
            Chạy luồng ngay
          </button>
        )}

        <div className="user-avatar">
          <div className="avatar-placeholder">
            <User size={16} />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Topbar;
