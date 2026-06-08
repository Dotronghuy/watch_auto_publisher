import { Activity, BarChart2, Send, HardDrive, Share2, Database, CheckCircle, Clock, TrendingUp, Zap, Calendar, ArrowRight, Play, RefreshCw, ScanSearch } from 'lucide-react';
import { Facebook, Instagram, TikTok, Threads } from '../components/SocialIcons';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import './Dashboard.css';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div style={{
        background: 'rgba(18,18,24,.95)', border: '1px solid rgba(255,255,255,.1)',
        borderRadius: '8px', padding: '8px 12px', backdropFilter: 'blur(8px)'
      }}>
        <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: '#fff' }}>{label}</p>
        <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--color-primary)' }}>
          {payload[0].value} bài đăng
        </p>
      </div>
    );
  }
  return null;
};

const Dashboard = () => {
  const [timeRange, setTimeRange] = useState('7days');
  const [settings, setSettings] = useState({ timeSlots: [] });
  const [stats, setStats] = useState({
    activeWorkflows: 0, totalPosts: 0, successRate: 100,
    storageUsed: 0, storageLimit: 2048, chartData: [],
    socialHealth: { connected: 0, total: 4, platforms: {} },
    dbHealth: 100, recentActivities: []
  });
  const navigate = useNavigate();

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [statsRes, settingsRes] = await Promise.all([
          fetch(`/api/dashboard?timeRange=${timeRange}`),
          fetch('/api/settings')
        ]);
        const statsData = await statsRes.json();
        const settingsData = await settingsRes.json();
        setStats({ ...statsData, chartData: Array.isArray(statsData.chartData) ? statsData.chartData : [] });
        setSettings(settingsData);
      } catch (err) { console.error(err); }
    };
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [timeRange]);

  const storagePercent = stats.storageUsed > 0 ? Math.min(100, (stats.storageUsed / (stats.storageLimit || 2048)) * 100) : 0;
  const platforms = stats.socialHealth?.platforms || {};
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  const upcomingSlots = (settings.timeSlots || []).filter(slot => slot > currentTime);
  const passedSlots = (settings.timeSlots || []).filter(slot => slot <= currentTime);

  return (
    <div className="dashboard">
      {/* ─── Header ─── */}
      <div className="dashboard-header">
        <h1>Chào mừng trở lại, Toby!</h1>
        <div className="status-indicator">
          <span className="status-dot green"></span>
          <p>Hệ thống hoạt động ổn định. {stats.activeWorkflows} luồng đang xử lý dữ liệu.</p>
        </div>
      </div>

      {/* ═══ Stats Grid ═══ */}
      <div className="stats-grid">
        <div className="stat-card" onClick={() => navigate('/database')}>
          <div className="stat-header">
            <h3>Tổng bài đã đăng</h3>
            <div className="stat-icon-wrapper blue"><Send size={14} /></div>
          </div>
          <div className="stat-value"><h2>{stats.totalPosts}</h2></div>
        </div>

        <div className="stat-card" onClick={() => navigate('/calendar')}>
          <div className="stat-header">
            <h3>Tỷ lệ duyệt</h3>
            <div className="stat-icon-wrapper green"><CheckCircle size={14} /></div>
          </div>
          <div className="stat-value"><h2>{stats.successRate}<span className="unit">%</span></h2></div>
          <div className="progress-bar-container">
            <div className="progress-bar-fill green" style={{width: `${stats.successRate}%`}}></div>
          </div>
        </div>

        <div className="stat-card" onClick={() => navigate('/drive')}>
          <div className="stat-header">
            <h3>Dung lượng Drive</h3>
            <div className="stat-icon-wrapper orange"><HardDrive size={14} /></div>
          </div>
          <div className="stat-value"><h2>{stats.storageUsed}<span className="unit">GB</span></h2></div>
          <div className="progress-bar-container">
            <div className="progress-bar-fill blue" style={{width: `${storagePercent}%`}}></div>
          </div>
        </div>

        <div className="stat-card" onClick={() => navigate('/workflow')}>
          <div className="stat-header">
            <h3>Luồng đang chạy</h3>
            <div className="stat-icon-wrapper pink"><Activity size={14} /></div>
          </div>
          <div className="stat-value"><h2>{stats.activeWorkflows}<span className="unit">Active</span></h2></div>
        </div>
      </div>

      {/* ═══ Quick Actions Bar ═══ */}
      <div className="quick-actions-bar">
        <button className="qa-btn primary" onClick={() => navigate('/workflow')}>
          <Play size={13} /> Chạy luồng ngay
        </button>
        <button className="qa-btn" onClick={() => navigate('/calendar')}>
          <Calendar size={13} /> Xem lịch đăng
        </button>
        <button className="qa-btn" onClick={async () => {
          await fetch('/api/trigger-sync', { method: 'POST' });
        }}>
          <RefreshCw size={13} /> Đồng bộ dữ liệu
        </button>
        <button className="qa-btn" onClick={() => navigate('/database')}>
          <ScanSearch size={13} /> Quản lý sản phẩm
        </button>
      </div>

      {/* ═══ Main Content ═══ */}
      <div className="dashboard-main">
        {/* ─── Chart ─── */}
        <div className="chart-section">
          <div className="chart-header">
            <h3>
              <span className="chart-icon"><BarChart2 size={14} /></span>
              Số bài đã đăng
            </h3>
            <select className="time-range-select" value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
              <option value="7days">7 ngày qua</option>
              <option value="today">Hôm nay</option>
              <option value="yesterday">Hôm qua</option>
              <option value="this_month">Tháng này</option>
              <option value="last_month">Tháng trước</option>
            </select>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.chartData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,.35)', fontSize: 10 }} dy={6} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,.25)', fontSize: 10 }} width={24} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={36}>
                  {stats.chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.value > 0 ? 'url(#barGrad)' : 'rgba(255,255,255,.04)'} />
                  ))}
                </Bar>
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ─── Sidebar ─── */}
        <div className="dashboard-sidebar">
          {/* Today Schedule */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <h4><Clock size={13} style={{color: '#a5b4fc'}} /> Lịch đăng hôm nay</h4>
              <span className="view-link" onClick={() => navigate('/calendar')}>Xem ↗</span>
            </div>
            <div className="schedule-slots">
              {(settings.timeSlots || []).length > 0 ? (
                <>
                  {passedSlots.map((slot, i) => (
                    <div key={`p-${i}`} className="slot-item done">
                      <CheckCircle size={12} />
                      <span className="slot-time">{slot}</span>
                      <span className="slot-status">Đã qua</span>
                    </div>
                  ))}
                  {upcomingSlots.map((slot, i) => (
                    <div key={`u-${i}`} className="slot-item upcoming">
                      <Clock size={12} />
                      <span className="slot-time">{slot}</span>
                      <span className="slot-status">Sắp tới</span>
                    </div>
                  ))}
                </>
              ) : (
                <div className="slot-empty">Chưa cài đặt khung giờ</div>
              )}
            </div>
          </div>

          {/* Platform Status */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <h4><Share2 size={13} style={{color: '#60a5fa'}} /> Trạng thái nền tảng</h4>
            </div>
            <div className="platform-grid">
              <div className={`platform-chip ${platforms.facebook ? 'active' : ''}`}>
                <Facebook size={13} />
                <span>Facebook</span>
                <span className={`chip-dot ${platforms.facebook ? 'on' : 'off'}`}></span>
              </div>
              <div className={`platform-chip ${platforms.instagram ? 'active' : ''}`}>
                <Instagram size={13} />
                <span>Instagram</span>
                <span className={`chip-dot ${platforms.instagram ? 'on' : 'off'}`}></span>
              </div>
              <div className={`platform-chip ${platforms.tiktok ? 'active' : ''}`}>
                <TikTok size={13} />
                <span>TikTok</span>
                <span className={`chip-dot ${platforms.tiktok ? 'on' : 'off'}`}></span>
              </div>
              <div className={`platform-chip ${platforms.threads ? 'active' : ''}`}>
                <Threads size={13} />
                <span>Threads</span>
                <span className={`chip-dot ${platforms.threads ? 'on' : 'off'}`}></span>
              </div>
            </div>
          </div>

          {/* DB + Storage Mini */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <h4><Database size={13} style={{color: '#34d399'}} /> Sức khỏe hệ thống</h4>
            </div>
            <div className="health-mini-grid">
              <div className="health-mini">
                <div className="health-mini-label">Database</div>
                <div className="health-mini-value green">100%</div>
                <div className="progress-bar-container"><div className="progress-bar-fill green" style={{width: '100%'}}></div></div>
              </div>
              <div className="health-mini">
                <div className="health-mini-label">Drive</div>
                <div className="health-mini-value blue">{storagePercent.toFixed(1)}%</div>
                <div className="progress-bar-container"><div className="progress-bar-fill blue" style={{width: `${storagePercent}%`}}></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Bottom: Recent Activity ═══ */}
      <div className="activity-section">
        <div className="activity-section-header">
          <h3><span className="section-icon"><Activity size={13} /></span> Hoạt động gần đây</h3>
          <span className="view-link">Xem tất cả</span>
        </div>
        <div className="activity-grid">
          {stats.recentActivities && stats.recentActivities.length > 0 ? (
            stats.recentActivities.slice(0, 6).map((act, idx) => {
              let Icon = Clock, colorClass = 'pink', borderClass = 'info';
              if (act.type === 'success') { Icon = CheckCircle; colorClass = 'green'; borderClass = 'success'; }
              if (act.type === 'info') { Icon = Activity; colorClass = 'blue'; borderClass = 'info'; }
              return (
                <div key={idx} className={`activity-card ${borderClass}`}>
                  <div className={`activity-card-icon ${colorClass}`}><Icon size={13} /></div>
                  <div className="activity-card-body">
                    <p>{act.message}</p>
                    <span>{new Date(act.timestamp).toLocaleString('vi-VN')}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="activity-card success">
              <div className="activity-card-icon green"><CheckCircle size={13} /></div>
              <div className="activity-card-body">
                <p>Hệ thống khởi tạo thành công.</p>
                <span>Vừa xong</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
