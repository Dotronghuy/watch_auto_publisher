import { Activity, Database, Link2, RefreshCw, AlertTriangle, CheckCircle2, Clock, ScanSearch, HardDrive, BarChart3, ChevronRight, Zap, TrendingUp } from 'lucide-react';
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
        const res = await fetch('/api/dashboard');
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
    await fetch('/api/trigger-sync', { method: 'POST' });
    Swal.fire({ title: 'Thành công', text: 'Đã kích hoạt đồng bộ dữ liệu.', icon: 'success', background: 'var(--color-surface)', color: 'white', confirmButtonColor: 'var(--color-primary)' });
  };

  const handleScanDrive = async () => {
    Swal.fire({
      title: 'Khởi tạo luồng quét...',
      text: 'Tiến trình sẽ chạy ngầm. Quá trình quét mất khoảng 15-20 phút tuỳ số lượng.',
      didOpen: () => Swal.showLoading(),
      background: 'var(--color-surface)', color: 'white', timer: 3000
    });
    try {
      const res = await fetch('/api/trigger-scan', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        Swal.fire({ title: 'Cảnh báo', text: data.message, icon: 'warning', background: 'var(--color-surface)', color: 'white' });
      }
    } catch(err) {
      Swal.fire({ title: 'Lỗi', text: 'Không kết nối được Backend', icon: 'error', background: 'var(--color-surface)', color: 'white' });
    }
  };

  const storagePercent = stats ? Math.min(100, (stats.storageUsed / (stats.storageLimit || 2048)) * 100) : 0;
  const socialConnected = stats?.socialHealth?.connected || 2;
  const totalPosts = stats?.totalPosts || 0;
  const maxChart = stats?.chartData ? Math.max(...stats.chartData.map(d => d.value), 1) : 1;

  return (
    <div className="drive-page">
      {/* ─── Page Header ─── */}
      <div className="page-header">
        <h1>Lưu trữ & Tổng quan</h1>
        <p>Quản lý tài nguyên lưu trữ, kết nối dịch vụ và theo dõi hoạt động hệ thống.</p>
      </div>

      {/* ═══ Stat Cards ═══ */}
      <div className="stat-cards-row">
        <div className="stat-card" onClick={() => navigate('/workflow')}>
          <div className="stat-card-header">
            <span className="stat-card-label">Luồng hoạt động</span>
            <div className="stat-card-icon green"><Activity size={16} /></div>
          </div>
          <div className="stat-card-value">{stats ? stats.activeWorkflows : 0}</div>
          <div className="progress-bar-container">
            <div className="progress-bar-fill green" style={{width: stats?.activeWorkflows > 0 ? '100%' : '0%'}}></div>
          </div>
          <div className="stat-card-footer"><span className="link-hint">Xem luồng công việc ↗</span></div>
        </div>

        <div className="stat-card" onClick={() => window.open('https://drive.google.com/drive/folders/1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl', '_blank')}>
          <div className="stat-card-header">
            <span className="stat-card-label">Dung lượng Drive</span>
            <div className="stat-card-icon blue"><HardDrive size={16} /></div>
          </div>
          <div className="stat-card-value">
            {stats ? stats.storageUsed : 0}<span className="unit">GB</span>
            <span className="limit-text">/ {stats?.storageLimit || 2048} GB</span>
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar-fill blue" style={{width: `${storagePercent}%`}}></div>
          </div>
          <div className="stat-card-footer"><span className="link-hint">Mở Google Drive ↗</span></div>
        </div>

        <div className="stat-card" onClick={() => navigate('/database')}>
          <div className="stat-card-header">
            <span className="stat-card-label">Tổng bài đã đăng</span>
            <div className="stat-card-icon pink"><TrendingUp size={16} /></div>
          </div>
          <div className="stat-card-value">{totalPosts}</div>
          <div className="progress-bar-container">
            <div className="progress-bar-fill pink" style={{width: totalPosts > 0 ? '100%' : '0%'}}></div>
          </div>
          <div className="stat-card-footer"><span className="link-hint">Xem dữ liệu SP ↗</span></div>
        </div>

        <div className="stat-card" onClick={() => navigate('/settings')}>
          <div className="stat-card-header">
            <span className="stat-card-label">Nền tảng kết nối</span>
            <div className="stat-card-icon purple"><Zap size={16} /></div>
          </div>
          <div className="stat-card-value">
            {socialConnected}<span className="unit">/ 4</span>
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar-fill green" style={{width: `${(socialConnected / 4) * 100}%`}}></div>
          </div>
          <div className="stat-card-footer"><span className="link-hint">Quản lý kết nối ↗</span></div>
        </div>
      </div>

      {/* ═══ Main Content Grid ═══ */}
      <div className="content-grid">
        {/* ─── Chart / Analytics ─── */}
        <div className="section-card">
          <div className="section-header">
            <div className="section-title">
              <div className="icon-circle pink"><BarChart3 size={15} /></div>
              <h3>Bài đăng 7 ngày qua</h3>
            </div>
          </div>
          {stats?.chartData && stats.chartData.some(d => d.value > 0) ? (
            <div className="chart-bars">
              {stats.chartData.map((d, i) => (
                <div className="chart-bar-col" key={i}>
                  {d.value > 0 && <span className="chart-bar-value">{d.value}</span>}
                  <div
                    className={`chart-bar ${d.value > 0 ? 'pink' : 'dim'}`}
                    style={{ height: `${Math.max(4, (d.value / maxChart) * 100)}%` }}
                  ></div>
                  <span className="chart-bar-label">{d.name.split(' ')[0]}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="analytics-empty">
              <Activity size={36} />
              <span className="empty-title">Chưa có dữ liệu biểu đồ</span>
              <span className="empty-sub">Biểu đồ sẽ hiển thị khi có bài đăng</span>
            </div>
          )}
        </div>

        {/* ─── Quick Actions ─── */}
        <div className="section-card">
          <div className="section-header">
            <div className="section-title">
              <div className="icon-circle blue"><Zap size={15} /></div>
              <h3>Thao tác Nhanh</h3>
            </div>
          </div>
          <div className="quick-actions-grid">
            <div className="action-row" onClick={() => navigate('/settings')}>
              <div className="action-icon" style={{background: 'rgba(255,77,141,.1)', color: 'var(--color-primary)'}}><Link2 size={15} /></div>
              <div className="action-info">
                <h4>Kết nối Ứng dụng Mới</h4>
                <p>Xác thực kết nối OAuth</p>
              </div>
              <ChevronRight size={14} className="action-arrow" />
            </div>
            <div className="action-row" onClick={handleScanDrive}>
              <div className="action-icon" style={{background: 'rgba(52,211,153,.1)', color: '#34d399'}}><ScanSearch size={15} /></div>
              <div className="action-info">
                <h4>Quét Dữ liệu Google Drive</h4>
                <p>Cập nhật file mới thủ công</p>
              </div>
              <ChevronRight size={14} className="action-arrow" />
            </div>
            <div className="action-row" onClick={handleSync}>
              <div className="action-icon" style={{background: 'rgba(96,165,250,.1)', color: '#60a5fa'}}><RefreshCw size={15} /></div>
              <div className="action-info">
                <h4>Đồng bộ Dữ liệu Bắt buộc</h4>
                <p>Cập nhật tất cả các model đang chạy</p>
              </div>
              <ChevronRight size={14} className="action-arrow" />
            </div>
            <div className="action-row" onClick={() => window.open('https://drive.google.com/drive/folders/1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl', '_blank')}>
              <div className="action-icon" style={{background: 'rgba(167,139,250,.1)', color: '#a78bfa'}}><Database size={15} /></div>
              <div className="action-info">
                <h4>Quản lý Google Drive</h4>
                <p>Mở thư mục dữ liệu sản phẩm</p>
              </div>
              <ChevronRight size={14} className="action-arrow" />
            </div>
          </div>
        </div>

        {/* ─── Sync Logs (full width) ─── */}
        <div className="section-card full-width">
          <div className="section-header">
            <div className="section-title">
              <div className="icon-circle green"><Clock size={15} /></div>
              <h3>Nhật ký Đồng bộ</h3>
            </div>
            <a href="#" className="view-all-link" onClick={(e) => {
              e.preventDefault();
              Swal.fire({
                title: 'Nhật ký Toàn Hệ Thống',
                html: `<div style="text-align: left; max-height: 400px; overflow-y: auto;">
                  ${stats && stats.recentActivities ? stats.recentActivities.map(act => `<p style="margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
                    <b style="color: var(--color-primary);">${new Date(act.timestamp).toLocaleTimeString()}:</b> ${act.message}
                  </p>`).join('') : '<p>Chưa có lịch sử.</p>'}
                </div>`,
                background: 'var(--color-surface)', color: 'var(--color-text)',
                confirmButtonColor: 'var(--color-primary)', width: '600px'
              });
            }}>Xem tất cả →</a>
          </div>

          <div className="logs-list">
            {stats && stats.recentActivities && stats.recentActivities.length > 0 ? (
              stats.recentActivities.slice(0, 4).map((act, idx) => (
                <div className={`log-entry ${act.type === 'success' ? 'success' : (act.type === 'error' ? 'warning' : 'info')}`} key={idx}>
                  <div className={`log-icon ${act.type === 'success' ? 'success' : (act.type === 'error' ? 'warning' : 'info')}`}>
                    {act.type === 'success' ? <CheckCircle2 size={14} /> : act.type === 'error' ? <AlertTriangle size={14} /> : <Activity size={14} />}
                  </div>
                  <div className="log-body">
                    <h4>{act.message}</h4>
                    <p>{new Date(act.timestamp).toLocaleString('vi-VN')}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="log-entry success">
                <div className="log-icon success"><CheckCircle2 size={14} /></div>
                <div className="log-body">
                  <h4>Cơ sở dữ liệu sẵn sàng</h4>
                  <p>Hệ thống hoạt động bình thường</p>
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
