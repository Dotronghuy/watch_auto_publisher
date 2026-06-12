import { Activity, BarChart2, Send, HardDrive, Share2, Database, CheckCircle, Clock, TrendingUp, Zap, Calendar, ArrowRight, Play, RefreshCw, ScanSearch, Heart, MessageCircle, Repeat2 } from 'lucide-react';
import { Facebook, Instagram, TikTok, Threads } from '../components/SocialIcons';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';

// Animated counter component
const AnimatedNumber = ({ value }) => {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    if (start === end) return;
    
    const duration = 600;
    const startTime = performance.now();
    
    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) requestAnimationFrame(animate);
      else prevRef.current = end;
    };
    
    requestAnimationFrame(animate);
  }, [value]);

  return <>{display.toLocaleString()}</>;
};

const Dashboard = () => {
  const [settings, setSettings] = useState({ timeSlots: [] });
  const [engagement, setEngagement] = useState({
    totalLikes: 0, totalComments: 0, totalShares: 0, postCount: 0,
    byPlatform: {
      facebook: { likes: 0, comments: 0, shares: 0, posts: 0 },
      instagram: { likes: 0, comments: 0, shares: 0, posts: 0 }
    }
  });
  const [stats, setStats] = useState({
    activeWorkflows: 0, totalPosts: 0, successRate: 100,
    storageUsed: 0, storageLimit: 2048,
    socialHealth: { connected: 0, total: 4, platforms: {} },
    dbHealth: 100, recentActivities: []
  });
  const [isTracking, setIsTracking] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // Lấy danh sách tài khoản 1 lần
    fetch('/api/accounts').then(r => r.json()).then(data => setAccounts(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const accParam = selectedAccount ? `&accountId=${selectedAccount}` : '';
        const [statsRes, settingsRes, engagementRes] = await Promise.all([
          fetch(`/api/dashboard?timeRange=7days`),
          fetch('/api/settings'),
          fetch(`/api/dashboard/engagement?${accParam}`)
        ]);
        const statsData = await statsRes.json();
        const settingsData = await settingsRes.json();
        const engagementData = await engagementRes.json();
        setStats(statsData);
        setSettings(settingsData);
        if (engagementData.today) setEngagement(engagementData.today);
      } catch (err) { console.error(err); }
    };
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [selectedAccount]);

  const storagePercent = stats.storageUsed > 0 ? Math.min(100, (stats.storageUsed / (stats.storageLimit || 2048)) * 100) : 0;
  const platforms = stats.socialHealth?.platforms || {};
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  const upcomingSlots = (settings.timeSlots || []).filter(slot => slot > currentTime);
  const passedSlots = (settings.timeSlots || []).filter(slot => slot <= currentTime);

  // Tính % cho thanh ngang FB/IG
  const totalEng = engagement.totalLikes + engagement.totalComments + engagement.totalShares;
  const fbTotal = engagement.byPlatform.facebook.likes + engagement.byPlatform.facebook.comments + engagement.byPlatform.facebook.shares;
  const igTotal = engagement.byPlatform.instagram.likes + engagement.byPlatform.instagram.comments + engagement.byPlatform.instagram.shares;
  const fbPercent = totalEng > 0 ? (fbTotal / totalEng * 100) : 50;
  const igPercent = totalEng > 0 ? (igTotal / totalEng * 100) : 50;

  const trackNow = async () => {
    setIsTracking(true);
    try {
      const accParam = selectedAccount ? `?accountId=${selectedAccount}` : '';
      const res = await fetch(`/api/dashboard/track-now${accParam}`, { method: 'POST' });
      const data = await res.json();
      if (data.today) setEngagement(data.today);
    } catch (err) { console.error(err); }
    setIsTracking(false);
  };

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

        <div className="stat-card">
          <div className="stat-header">
            <h3>Nền tảng kết nối</h3>
            <div className="stat-icon-wrapper pink"><Share2 size={14} /></div>
          </div>
          <div className="stat-value"><h2>{stats.socialHealth?.connected || 0}<span className="unit">/ {stats.socialHealth?.total || 4}</span></h2></div>
        </div>

        <div className="stat-card" onClick={() => navigate('/workflow')}>
          <div className="stat-header">
            <h3>Luồng đang chạy</h3>
            <div className="stat-icon-wrapper green"><Activity size={14} /></div>
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
        {/* ─── Engagement Widget (thay thế biểu đồ cũ) ─── */}
        <div className="engagement-section">
          <div className="engagement-header">
            <h3>
              <span className="engagement-icon"><TrendingUp size={14} /></span>
              Tương tác hôm nay
            </h3>
            <div className="engagement-meta">
              <select className="eng-account-select" value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}>
                <option value="">Tất cả tài khoản</option>
                {accounts.filter(a => a.isActive).map(acc => (
                  <option key={acc.id} value={acc.id}>{acc.name}</option>
                ))}
              </select>
              <span className="engagement-post-count">{engagement.postCount} bài</span>
              <button className={`eng-refresh-btn ${isTracking ? 'spinning' : ''}`} onClick={trackNow} disabled={isTracking} title="Quét tương tác ngay">
                <RefreshCw size={12} />
              </button>
              <span className="engagement-live-dot"></span>
              <span className="engagement-live-label">LIVE</span>
            </div>
          </div>

          {/* 3 Metric Cards */}
          <div className="engagement-metrics">
            <div className="eng-card eng-likes">
              <div className="eng-card-icon"><Heart size={16} /></div>
              <div className="eng-card-body">
                <div className="eng-card-value"><AnimatedNumber value={engagement.totalLikes} /></div>
                <div className="eng-card-label">Lượt thích</div>
              </div>
            </div>
            <div className="eng-card eng-comments">
              <div className="eng-card-icon"><MessageCircle size={16} /></div>
              <div className="eng-card-body">
                <div className="eng-card-value"><AnimatedNumber value={engagement.totalComments} /></div>
                <div className="eng-card-label">Bình luận</div>
              </div>
            </div>
            <div className="eng-card eng-shares">
              <div className="eng-card-icon"><Repeat2 size={16} /></div>
              <div className="eng-card-body">
                <div className="eng-card-value"><AnimatedNumber value={engagement.totalShares} /></div>
                <div className="eng-card-label">Chia sẻ</div>
              </div>
            </div>
          </div>

          {/* Platform Breakdown */}
          <div className="engagement-breakdown">
            <div className="breakdown-header">
              <span className="breakdown-title">Phân bổ theo nền tảng</span>
            </div>
            
            <div className="breakdown-bar-container">
              <div className="breakdown-stacked-bar">
                <div className="breakdown-bar-fb" style={{width: `${fbPercent}%`}}></div>
                <div className="breakdown-bar-ig" style={{width: `${igPercent}%`}}></div>
              </div>
            </div>

            <div className="breakdown-legend">
              <div className="breakdown-item">
                <span className="breakdown-dot fb"></span>
                <Facebook size={12} />
                <span className="breakdown-platform-name">Facebook</span>
                <span className="breakdown-detail">
                  {engagement.byPlatform.facebook.likes}❤️ {engagement.byPlatform.facebook.comments}💬 {engagement.byPlatform.facebook.shares}🔄
                </span>
              </div>
              <div className="breakdown-item">
                <span className="breakdown-dot ig"></span>
                <Instagram size={12} />
                <span className="breakdown-platform-name">Instagram</span>
                <span className="breakdown-detail">
                  {engagement.byPlatform.instagram.likes}❤️ {engagement.byPlatform.instagram.comments}💬
                </span>
              </div>
            </div>
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
