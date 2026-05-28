import { Activity, BarChart2, Calendar, FileText, Image as ImageIcon, Send, TrendingUp, Users, HardDrive, Share2, Database, CheckCircle, Clock } from 'lucide-react';
import { Facebook, Instagram, Linkedin, Twitter, TikTok, Threads } from '../components/SocialIcons';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import './Dashboard.css';

const Dashboard = () => {
  const [timeRange, setTimeRange] = useState('7days');
  const [stats, setStats] = useState({
    activeWorkflows: 0,
    totalPosts: 0,
    successRate: 100,
    storageUsed: 0,
    chartData: [
      { name: '01/01', value: 0 }
    ],
    socialHealth: { connected: 0, total: 4, platforms: {} },
    dbHealth: 100,
    recentActivities: []
  });
  const navigate = useNavigate();

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`http://localhost:3000/api/dashboard?timeRange=${timeRange}`);
        const data = await res.json();
        
        setStats({
          ...data,
          chartData: Array.isArray(data.chartData) ? data.chartData : []
        });
      } catch (err) {
        console.error('Failed to fetch stats', err);
      }
    };

    fetchStats();
    // Tự động làm mới mỗi 10 giây
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [timeRange]);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Chào mừng trở lại, Toby!</h1>
        <div className="status-indicator">
          <span className="status-dot green"></span>
          <p>Hệ thống hoạt động ổn định. {stats.activeWorkflows} luồng đang xử lý dữ liệu.</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card glass glow-primary">
          <div className="stat-header">
            <h3>TỔNG BÀI ĐÃ ĐĂNG</h3>
            <div className="stat-icon-wrapper blue">
              <Send size={16} />
            </div>
          </div>
          <div className="stat-value">
            <h2>{stats.totalPosts}</h2>
            <span className="trend positive">--</span>
          </div>
        </div>

        <div className="stat-card glass glow-primary">
          <div className="stat-header">
            <h3>TỶ LỆ DUYỆT</h3>
            <div className="stat-icon-wrapper green">
              <CheckCircle size={16} />
            </div>
          </div>
          <div className="stat-value">
            <h2>{stats.successRate}%</h2>
            <span className="trend positive">--</span>
          </div>
        </div>

        <div className="stat-card glass glow-primary" onClick={() => navigate('/drive')} style={{cursor: 'pointer'}}>
          <div className="stat-header">
            <h3>DUNG LƯỢNG ĐÃ DÙNG</h3>
            <div className="stat-icon-wrapper orange">
              <HardDrive size={16} />
            </div>
          </div>
          <div className="stat-value">
            <h2>{stats.storageUsed} <span className="unit">GB</span></h2>
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar-fill green" style={{width: '10%'}}></div>
          </div>
        </div>

        <div className="stat-card glass glow-primary cursor-pointer" onClick={() => navigate('/workflow')} style={{cursor: 'pointer'}}>
          <div className="stat-header">
            <h3>SỐ LUỒNG ĐANG CHẠY</h3>
            <div className="stat-icon-wrapper pink">
              <Activity size={16} />
            </div>
          </div>
          <div className="stat-value">
            <h2>{stats.activeWorkflows} <span className="unit">Active</span></h2>
          </div>
        </div>
      </div>

      <div className="dashboard-main">
        <div className="chart-section glass">
          <div className="chart-header">
            <h3>Số bài đã đăng được</h3>
            <div className="chart-actions">
              <select className="week-selector" value={timeRange} onChange={(e) => setTimeRange(e.target.value)} style={{
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--border-light)',
                padding: '6px 12px',
                borderRadius: '6px',
                outline: 'none',
                fontSize: '13px'
              }}>
                <option value="7days">7 ngày qua</option>
                <option value="today">Hôm nay</option>
                <option value="yesterday">Hôm qua</option>
                <option value="this_month">Tháng này</option>
                <option value="last_month">Tháng trước</option>
              </select>
            </div>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stats.chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: 'var(--color-text-muted)', fontSize: 12}} dy={10} />
                <Tooltip 
                  cursor={{fill: 'rgba(255,255,255,0.05)'}}
                  contentStyle={{backgroundColor: 'var(--color-surface-hover)', border: '1px solid var(--border-light)', borderRadius: '8px'}}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {stats.chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index % 2 === 0 ? 'var(--color-primary)' : 'var(--color-info)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="dashboard-sidebar">
          <div className="health-cards">
            <div className="health-card glass cursor-pointer" onClick={() => navigate('/settings')} style={{cursor: 'pointer'}}>
              <div className="health-header">
                <Share2 size={16} className="blue" />
                <span>SOCIAL HEALTH</span>
              </div>
              <div className="health-value">
                <h2>{stats.socialHealth.connected}/{stats.socialHealth.total}</h2>
                <span className="status-dot"></span>
              </div>
              <div className="social-icons">
                <Facebook size={14} className={stats.socialHealth.platforms?.facebook ? '' : 'text-muted dim'} />
                <Instagram size={14} className={stats.socialHealth.platforms?.instagram ? '' : 'text-muted dim'} />
                <TikTok size={14} className={stats.socialHealth.platforms?.tiktok ? '' : 'text-muted dim'} />
                <Threads size={14} className={stats.socialHealth.platforms?.threads ? '' : 'text-muted dim'} />
              </div>
            </div>

            <div className="health-card glass">
              <div className="health-header">
                <Database size={16} className="green" />
                <span>DB HEALTH</span>
              </div>
              <div className="health-value">
                <h2>100%</h2>
                <span className="unit">Opt</span>
              </div>
              <div className="progress-bar-container">
                <div className="progress-bar-fill green" style={{width: '100%'}}></div>
              </div>
            </div>
          </div>

          <div className="recent-activity glass">
            <div className="recent-header">
              <h3>Recent Activity</h3>
              <span className="view-all">View All</span>
            </div>
            <ul className="activity-list">
              {stats.recentActivities && stats.recentActivities.length > 0 ? (
                stats.recentActivities.slice(0, 5).map((act, index) => {
                  let Icon = Clock;
                  let colorClass = 'pink';
                  if (act.type === 'success') { Icon = CheckCircle; colorClass = 'green'; }
                  if (act.type === 'info') { Icon = Activity; colorClass = 'blue'; }

                  return (
                    <li key={act.id || index}>
                      <div className={`activity-icon ${colorClass}`}><Icon size={14} /></div>
                      <div className="activity-content">
                        <p>{act.message}</p>
                        <span>{new Date(act.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </li>
                  )
                })
              ) : (
                <li>
                  <div className="activity-icon blue"><CheckCircle size={14} /></div>
                  <div className="activity-content">
                    <p>Hệ thống khởi tạo thành công.</p>
                    <span>Just now</span>
                  </div>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
