import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Send, Plus, X, Clock, BarChart3, CheckCircle2, MessageSquare, Settings, Terminal, History, Zap } from 'lucide-react';
import Swal from 'sweetalert2';
import './ZenwatchZalo.css';



export default function ZenwatchZalo() {
  const [status, setStatus] = useState({ isRunning: false, logs: [] });
  const [config, setConfig] = useState({
    groups: [], phone: '', sheetUrl: '',
    postsPerSession: 7, delayMinutes: 2, cooldownDays: 2, contentTone: 'auto'
  });
  const [history, setHistory] = useState({ items: [], total: 0 });
  const [logFilter, setLogFilter] = useState('all');
  const [newGroup, setNewGroup] = useState('');
  const [configLoaded, setConfigLoaded] = useState(false);
  const [groupDropOpen, setGroupDropOpen] = useState(false);
  const groupDropRef = useRef(null);
  const logsEndRef = useRef(null);
  const saveTimerRef = useRef(null);

  // ── Fetch data ──
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/zenwatch/zalo/status');
      const data = await res.json();
      setStatus(data);
    } catch (e) {}
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/zenwatch/zalo/config');
      const data = await res.json();
      setConfig(data);
      setConfigLoaded(true);
    } catch (e) {}
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/zenwatch/zalo/history?limit=10');
      const data = await res.json();
      setHistory(data);
    } catch (e) {}
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchHistory();
    fetchStatus();
    const statusInterval = setInterval(fetchStatus, 2000);
    const historyInterval = setInterval(fetchHistory, 5000);
    return () => { clearInterval(statusInterval); clearInterval(historyInterval); };
  }, [fetchConfig, fetchHistory, fetchStatus]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [status.logs]);

  // ── Close dropdown on click outside ──
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (groupDropRef.current && !groupDropRef.current.contains(e.target)) {
        setGroupDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Auto-save config (debounced 800ms) ──
  const saveConfigToServer = useCallback(async (cfg) => {
    try {
      await fetch('/api/zenwatch/zalo/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg)
      });
    } catch (e) {
      console.error('Auto-save lỗi:', e);
    }
  }, []);

  useEffect(() => {
    if (!configLoaded) return; // Don't save on initial load
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveConfigToServer(config);
    }, 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [config, configLoaded, saveConfigToServer]);

  // ── Actions ──
  const handleStart = async () => {
    if (config.groups.length === 0) {
      Swal.fire({ title: 'Thiếu nhóm Zalo', text: 'Thêm ít nhất 1 nhóm!', icon: 'warning', background: 'var(--color-surface)', color: 'white' });
      return;
    }

    // Check Gemini login trước
    try {
      const checkRes = await fetch('/api/zenwatch/zalo/check-gemini');
      const checkData = await checkRes.json();
      if (!checkData.loggedIn) {
        Swal.fire({
          icon: 'error',
          title: '🔒 Chưa đăng nhập Gemini',
          html: `
            <p style="margin-bottom:12px">Tool cần tài khoản <b>Gemini Plus</b> để viết content AI.</p>
            <p>Hãy vào <b>Cài đặt → Đăng nhập AI → Gemini</b> để đăng nhập trước.</p>
          `,
          confirmButtonText: '→ Đi tới Cài đặt',
          showCancelButton: true,
          cancelButtonText: 'Đóng',
          background: '#1a1a2e',
          color: 'white',
          confirmButtonColor: '#ec4899',
        }).then((result) => {
          if (result.isConfirmed) {
            window.location.href = '/settings';
          }
        });
        return;
      }
    } catch (e) { /* skip check if API fails */ }

    try {
      const res = await fetch('/api/zenwatch/zalo/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchStatus();
    } catch (e) {
      Swal.fire({ title: 'Lỗi', text: e.message, icon: 'error', background: 'var(--color-surface)', color: 'white' });
    }
  };

  const handleStop = async () => {
    const confirm = await Swal.fire({
      title: 'Dừng chiến dịch?',
      text: 'Tool sẽ dừng sau khi hoàn thành bài đang đăng.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Dừng ngay',
      cancelButtonText: 'Hủy',
      background: 'var(--color-surface)',
      color: 'white',
      confirmButtonColor: '#ef4444'
    });
    if (!confirm.isConfirmed) return;
    await fetch('/api/zenwatch/zalo/stop', { method: 'POST' });
  };

  const updateConfig = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const addGroup = () => {
    if (!newGroup.trim()) return;
    setConfig(prev => ({ ...prev, groups: [...prev.groups, newGroup.trim()] }));
    setNewGroup('');
  };

  const removeGroup = (idx) => {
    setConfig(prev => ({ ...prev, groups: prev.groups.filter((_, i) => i !== idx) }));
  };

  const deleteHistory = async (id) => {
    try {
      const res = await fetch(`/api/zenwatch/zalo/history/${id}`, { method: 'DELETE' });
      if (res.ok) fetchHistory();
    } catch (e) {
      console.error('Lỗi xóa lịch sử:', e);
    }
  };

  // ── Filtered logs ──
  const filteredLogs = status.logs.filter(l => {
    if (logFilter === 'all') return true;
    if (logFilter === 'success') return l.type === 'success' || l.type === 'highlight';
    if (logFilter === 'error') return l.type === 'error' || l.type === 'warning';
    return true;
  });

  // ── Stats ──
  const todayCount = history.items.filter(i => {
    const d = new Date(i.postedAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  return (
    <div className="zalo-page">
      {/* HERO HEADER */}
      <div className="zalo-hero">
        <div className="zalo-hero-content">
          <div className="zalo-hero-badges">
            <span className={`badge-status ${status.isRunning ? 'running' : ''}`}>
              <span className="dot" /> {status.isRunning ? 'OPERATIONAL' : 'STANDBY'}
            </span>
            <span className="badge-tag">Zalo Automation</span>
          </div>
          <h1>Zalo Auto Post</h1>
        </div>
        <div className="zalo-hero-actions">
          {!status.isRunning ? (
            <button className="btn-cta" onClick={handleStart}>
              <Play size={18} /> Bắt đầu chiến dịch
            </button>
          ) : (
            <button className="btn-danger" onClick={handleStop}>
              <Square size={18} /> Dừng khẩn cấp
            </button>
          )}
        </div>
      </div>

      {/* STATS BAR */}
      <div className="zalo-stats-bar">
        <div className="stat-card">
          <div className="stat-header"><Zap size={15} className="stat-ic green" /><span className="stat-label">CHỜ LỆNH</span></div>
          <span className="stat-value">{status.isRunning ? <span className="green-val">Active</span> : history.total || 0}</span>
        </div>
        <div className="stat-card">
          <div className="stat-header"><BarChart3 size={15} className="stat-ic green" /><span className="stat-label">BÀI ĐĂNG HÔM NAY</span></div>
          <span className="stat-value"><span className="green-val">{todayCount}</span></span>
        </div>
        <div className="stat-card">
          <div className="stat-header"><MessageSquare size={15} className="stat-ic purple" /><span className="stat-label">NHÓM ZALO</span></div>
          <span className="stat-value">{config.groups.length}</span>
        </div>
        <div className="stat-card">
          <div className="stat-header"><History size={15} className="stat-ic amber" /><span className="stat-label">TỔNG BÀI ĐÃ ĐĂNG</span></div>
          <span className="stat-value">{history.total.toLocaleString()}</span>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="zalo-main">
        {/* CONFIG PANEL */}
        <div className="config-panel">
          <h2><Settings size={14} /> Cấu Hình</h2>

          {/* Groups — Custom Dropdown */}
          <div className="groups-dropdown-wrapper" ref={groupDropRef}>
            <label>Danh sách nhóm Zalo</label>
            <button className="groups-dropdown-trigger" onClick={() => setGroupDropOpen(p => !p)}>
              <span>{config.groups.length > 0 ? `${config.groups.length} nhóm đã chọn` : 'Chưa có nhóm nào'}</span>
              <span className={`arrow ${groupDropOpen ? 'open' : ''}`}>▾</span>
            </button>
            {groupDropOpen && (
              <div className="groups-dropdown-menu">
                <div className="groups-dropdown-add">
                  <input
                    value={newGroup}
                    onChange={e => setNewGroup(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addGroup()}
                    placeholder="+ Thêm nhóm mới..."
                    autoFocus
                  />
                  <button onClick={addGroup}><Plus size={14} /></button>
                </div>
                <div className="groups-dropdown-list">
                  {config.groups.length === 0 && (
                    <div className="groups-dropdown-empty">Nhập tên nhóm ở trên rồi Enter</div>
                  )}
                  {config.groups.map((g, i) => (
                    <div key={i} className="groups-dropdown-item">
                      <MessageSquare size={13} className="gdi-icon" />
                      <span className="gdi-name">{g}</span>
                      <button className="gdi-remove" onClick={() => removeGroup(i)}><X size={13} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="config-field">
            <label>Link Google Sheet (Data sản phẩm)</label>
            <input value={config.sheetUrl} onChange={e => updateConfig('sheetUrl', e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          </div>

          <div className="config-field">
            <label>SĐT liên hệ</label>
            <input value={config.phone} onChange={e => updateConfig('phone', e.target.value)} placeholder="0924341213" />
          </div>

          <div className="config-field">
            <label>Phong cách viết AI</label>
            <div className="config-note">📋 CTV / Bán sỉ (Gemini tự sáng tạo)</div>
          </div>

          <div className="config-row">
            <div className="config-field">
              <label>Số bài / phiên</label>
              <input type="number" value={config.postsPerSession} onChange={e => updateConfig('postsPerSession', parseInt(e.target.value) || 1)} min={1} max={50} />
            </div>
            <div className="config-field">
              <label>Nghỉ giữa bài (phút)</label>
              <input type="number" value={config.delayMinutes} onChange={e => updateConfig('delayMinutes', parseInt(e.target.value) || 1)} min={1} max={60} />
            </div>
          </div>

          <div className="config-field">
            <label>Cooldown (ngày, tránh trùng)</label>
            <input type="number" value={config.cooldownDays} onChange={e => updateConfig('cooldownDays', parseInt(e.target.value) || 1)} min={1} max={30} />
          </div>

          {/* History */}
          {history.items.length > 0 && (
            <div className="history-section">
              <h2><Clock size={14} /> Lịch Sử Gần Đây</h2>
              <table className="history-table">
                <thead>
                  <tr><th>Mã SP</th><th>Thời gian</th><th></th></tr>
                </thead>
                <tbody>
                  {history.items.slice(0, 8).map(item => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 500 }}>{item.productId}</td>
                      <td>{new Date(item.postedAt).toLocaleString('vi-VN')}</td>
                      <td>
                        <button className="btn-remove" onClick={() => deleteHistory(item.id)} title="Xóa">
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* LOGS PANEL */}
        <div className="logs-panel">
          <div className="logs-header">
            <h2>
              <Terminal size={16} />
              Live Terminal
              {status.isRunning && <span className="dot-live" />}
            </h2>
            <div className="logs-filters">
              {['all', 'success', 'error'].map(f => (
                <button key={f} className={logFilter === f ? 'active' : ''} onClick={() => setLogFilter(f)}>
                  {f === 'all' ? 'Tất cả' : f === 'success' ? '✅ Thành công' : '❌ Lỗi'}
                </button>
              ))}
            </div>
          </div>
          <div className="logs-body">
            {filteredLogs.length === 0 ? (
              <div className="logs-empty">
                {status.isRunning ? 'Đang chờ dữ liệu...' : 'Nhấn "Bắt đầu chiến dịch" để chạy tool'}
              </div>
            ) : (
              filteredLogs.map((log, idx) => (
                <div key={idx} className="log-line">
                  <span className="log-time">{log.time}</span>
                  <span className={`log-msg ${log.type || 'info'}`}>{log.message}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
