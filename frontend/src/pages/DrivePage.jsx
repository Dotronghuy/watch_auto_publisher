import { Activity, Database, Link2, RefreshCw, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import './DrivePage.css';

const DrivePage = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/dashboard');
        const data = await res.json();
        setStats(data);
      } catch(err) { console.error(err); }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSync = async () => {
    Swal.fire({ title: 'Đang đồng bộ...', didOpen: () => Swal.showLoading(), background: 'var(--color-surface)', color: 'white' });
    await fetch('http://localhost:3000/api/trigger-sync', { method: 'POST' });
    Swal.fire({ title: 'Thành công', text: 'Đã kích hoạt đồng bộ dữ liệu.', icon: 'success', background: 'var(--color-surface)', color: 'white' });
  };



  return (
    <div className="drive-page">
      <div className="page-header">
        <h1>Drive & Dashboard</h1>
        <p>Quản lý các luồng công việc đang hoạt động và các liên kết lưu trữ file bên ngoài.</p>
      </div>

      <div className="top-widgets">
        <div className="widget-card glass">
          <div className="widget-header">
            <div className="widget-title">
              <Activity size={18} className="pink" />
              <h3>Tổng quan Hệ thống</h3>
            </div>
          </div>
          
          <div className="system-metrics">
            <div
              className="metric-box"
              onClick={() => navigate('/workflow')}
              style={{ cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(16,185,129,0.25)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <div className="metric-header">
                <span>LUỒNG ĐANG HOẠT ĐỘNG</span>
                <div className="metric-icon green-bg"><Activity size={14} /></div>
              </div>
              <div className="metric-value">
                <h2>{stats ? stats.activeWorkflows : 0}</h2>
                <span className="of-total" style={{ color: '#6ee7b7', fontSize: '11px' }}>
                  🔗 Xem luồng công việc ↗
                </span>
              </div>
              <div className="progress-bar-container mt-2">
                <div className="progress-bar-fill green" style={{width: `${stats ? (stats.activeWorkflows > 0 ? 100 : 0) : 0}%`}}></div>
              </div>
            </div>

            <div
              className="metric-box"
              onClick={() => window.open('https://drive.google.com/drive/folders/1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl', '_blank')}
              style={{ cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(99,102,241,0.25)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <div className="metric-header">
                <span>DUNG LƯỢNG DRIVE</span>
                <div className="metric-icon blue-bg"><Database size={14} /></div>
              </div>
              <div className="metric-value">
                <h2>
                  {stats ? stats.storageUsed : 0}
                  <span className="unit" style={{ fontSize: '0.5em', marginLeft: '4px' }}>GB</span>
                  <span style={{ fontSize: '0.32em', color: 'var(--color-text-dim)', marginLeft: '8px', fontWeight: 400 }}>/ {stats?.storageLimit || 2048} GB</span>
                </h2>
                <span className="of-total" style={{ color: '#6ee7b7', fontSize: '11px' }}>
                  🔗 Mở Google Drive ↗
                </span>
              </div>
              <div className="progress-bar-container mt-2" title={`${stats ? ((stats.storageUsed / (stats.storageLimit || 2048)) * 100).toFixed(1) : 0}% đã dùng`}>
                <div className="progress-bar-fill blue" style={{ width: `${stats ? Math.min(100, (stats.storageUsed / (stats.storageLimit || 2048)) * 100) : 0}%` }}></div>
              </div>
            </div>
          </div>
        </div>

        <div className="widget-card glass">
          <div className="widget-header">
            <div className="widget-title">
              <RefreshCw size={18} className="blue" />
              <h3>Thao tác Nhanh</h3>
            </div>
          </div>
          <div className="quick-actions-list">
            <div className="action-item" onClick={() => navigate('/settings')} style={{cursor: 'pointer'}}>
              <div className="action-icon pink-bg"><Link2 size={16} /></div>
              <div className="action-text">
                <h4>Kết nối Ứng dụng Mới</h4>
                <p>Xác thực kết nối OAuth</p>
              </div>
            </div>
            <div className="action-item" onClick={handleSync} style={{cursor: 'pointer'}}>
              <div className="action-icon blue-bg"><RefreshCw size={16} /></div>
              <div className="action-text">
                <h4>Đồng bộ Dữ liệu Bắt buộc</h4>
                <p>Cập nhật tất cả các model đang chạy</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="analytics-section glass">
        <div className="analytics-header">
          <div className="widget-title">
            <Activity size={18} className="pink" />
            <h3>Phân tích Hiệu suất Bài đăng</h3>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 12, color: 'var(--color-text-muted)' }}>
          <Activity size={40} style={{ opacity: 0.3 }} />
          <p style={{ margin: 0, fontSize: 14 }}>Dữ liệu hiệu suất sẽ hiển thị ở đây sau khi tích hợp API thống kê.</p>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Tính năng đang phát triển (Phase 3)</p>
        </div>
      </div>

      <div className="bottom-widgets">
        <div className="drive-manager-card glass cursor-pointer" onClick={() => window.open('https://drive.google.com/drive/folders/1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl?usp=sharing', '_blank')} style={{cursor: 'pointer'}}>
          <div className="drive-logo-box">
            <Database size={32} className="blue" />
          </div>
          <h3>Quản lý Dữ Liệu SP</h3>
        </div>

        <div className="sync-logs-card glass">
          <div className="widget-header" style={{ marginBottom: '12px' }}>
            <div className="widget-title">
              <Clock size={18} className="pink" />
              <h3>Nhật ký Đồng bộ (Sync Logs)</h3>
            </div>
            <a href="#" className="view-logs" onClick={(e) => {
              e.preventDefault();
              Swal.fire({
                title: 'Nhật ký Toàn Hệ Thống',
                html: `<div style="text-align: left; max-height: 400px; overflow-y: auto;">
                  ${stats && stats.recentActivities ? stats.recentActivities.map(act => `<p style="margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
                    <b style="color: var(--color-primary);">${new Date(act.timestamp).toLocaleTimeString()}:</b> ${act.message}
                  </p>`).join('') : '<p>Chưa có lịch sử.</p>'}
                </div>`,
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                confirmButtonColor: 'var(--color-primary)',
                width: '600px'
              });
            }}>Xem tất cả</a>
          </div>
          
          <div className="logs-list">
            {stats && stats.recentActivities && stats.recentActivities.length > 0 ? (
              stats.recentActivities.slice(0, 3).map((act, idx) => (
                <div className="log-item" key={idx}>
                  <div className={`log-icon ${act.type === 'success' ? 'success' : (act.type === 'error' ? 'warning' : 'blue-bg')}`}>
                    {act.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  </div>
                  <div className="log-content">
                    <h4>{act.message}</h4>
                    <p>{new Date(act.timestamp).toLocaleTimeString()}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="log-item">
                <div className="log-icon success"><CheckCircle2 size={14} /></div>
                <div className="log-content">
                  <h4>Hệ thống khởi tạo</h4>
                  <p>Sẵn sàng hoạt động</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DrivePage;
