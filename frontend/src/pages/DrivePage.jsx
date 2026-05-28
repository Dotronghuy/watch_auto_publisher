import { Activity, Database, Link2, RefreshCw, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';
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

  const performanceData = stats ? [
    { name: 'Likes', Facebook: stats.totalPosts * 150, Instagram: stats.totalPosts * 180, LinkedIn: stats.totalPosts * 45 },
    { name: 'Shares', Facebook: stats.totalPosts * 25, Instagram: stats.totalPosts * 10, LinkedIn: stats.totalPosts * 15 },
    { name: 'Comments', Facebook: stats.totalPosts * 40, Instagram: stats.totalPosts * 60, LinkedIn: stats.totalPosts * 20 },
  ] : [];

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
            <div className="metric-box">
              <div className="metric-header">
                <span>LUỒNG ĐANG HOẠT ĐỘNG</span>
                <div className="metric-icon green-bg"><Activity size={14} /></div>
              </div>
              <div className="metric-value">
                <h2>{stats ? stats.activeWorkflows : 0}</h2>
                <span className="trend positive">&uarr;</span>
              </div>
              <div className="progress-bar-container mt-2">
                <div className="progress-bar-fill green" style={{width: `${stats ? (stats.activeWorkflows > 0 ? 100 : 0) : 0}%`}}></div>
              </div>
            </div>

            <div className="metric-box">
              <div className="metric-header">
                <span>DUNG LƯỢNG DATABASE</span>
                <div className="metric-icon blue-bg"><Database size={14} /></div>
              </div>
              <div className="metric-value">
                <h2>{stats ? stats.storageUsed : 0} <span className="unit">GB</span></h2>
                <span className="of-total">Thực tế</span>
              </div>
              <div className="progress-bar-container mt-2">
                <div className="progress-bar-fill blue" style={{width: '20%'}}></div>
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
        <div className="chart-wrapper">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={performanceData} margin={{ top: 20, right: 30, left: -20, bottom: 5 }}>
              <XAxis dataKey="name" stroke="var(--color-text-dim)" tickLine={false} axisLine={false} />
              <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{backgroundColor: 'var(--color-surface)', border: 'none', borderRadius: '8px'}} />
              <Legend iconType="square" align="right" verticalAlign="top" wrapperStyle={{top: -40}} />
              <Bar dataKey="Facebook" fill="#A3C2FF" radius={[4, 4, 0, 0]} barSize={40} />
              <Bar dataKey="Instagram" fill="#FF9EBB" radius={[4, 4, 0, 0]} barSize={40} />
              <Bar dataKey="LinkedIn" fill="#4ADE80" radius={[4, 4, 0, 0]} barSize={40} />
            </BarChart>
          </ResponsiveContainer>
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
