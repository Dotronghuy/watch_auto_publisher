import { useState, useEffect } from 'react';
import { Key, Copy, Link2, Clock, Plus, X, Save, Check, Eye, EyeOff, BrainCircuit, RefreshCw, Sparkles, Trash2, AlertCircle, Play, CheckCircle2, XCircle, FileText, ChevronDown, ChevronRight, Settings, Users } from 'lucide-react';
import Swal from 'sweetalert2';
import { Facebook, Instagram, Threads, TikTok } from '../components/SocialIcons';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import './SocialConnections.css';

const SocialConnections = () => {
  const { user } = useAuth();
  const [timeSlots, setTimeSlots] = useState([]);
  const [newTime, setNewTime] = useState('');
  const [mode, setMode] = useState('real');
  const [testInterval, setTestInterval] = useState(5);
  const [igDelayMin, setIgDelayMin] = useState(10);
  const [igDelayMax, setIgDelayMax] = useState(20);
  const [isSaving, setIsSaving] = useState(false);
  const [connectedSocials, setConnectedSocials] = useState({
    facebook: true,
    instagram: true,
    threads: false,
    tiktok: false
  });
  const [envVars, setEnvVars] = useState({
    FB_PAGE_ACCESS_TOKEN: '',
    IG_ACCESS_TOKEN: '',
    IG_USER_ID: '',
    TIKTOK_SESSION_ID: ''
  });
  const [isSavingEnv, setIsSavingEnv] = useState(false);
  const [showTokens, setShowTokens] = useState({ fb: false, ig: false, igId: false, tiktok: false });
  const [isResettingAI, setIsResettingAI] = useState(null);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        setMode(data.mode || 'real');
        setTestInterval(data.testInterval || 5);
        setTimeSlots(Array.isArray(data.timeSlots) ? data.timeSlots : []);
        setIgDelayMin(data.igDelayMin || 10);
        setIgDelayMax(data.igDelayMax || 20);
        if (data.connectedSocials) {
          setConnectedSocials(data.connectedSocials);
        }
      })
      .catch(err => console.error(err));

    fetch('/api/env')
      .then(res => res.json())
      .then(data => {
        setEnvVars({
          FB_PAGE_ACCESS_TOKEN: data.FB_PAGE_ACCESS_TOKEN || '',
          IG_ACCESS_TOKEN: data.IG_ACCESS_TOKEN || '',
          IG_USER_ID: data.IG_USER_ID || '',
          TIKTOK_SESSION_ID: data.TIKTOK_SESSION_ID || ''
        });
      })
      .catch(err => console.error('Lỗi khi fetch env', err));
  }, []);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, testInterval, timeSlots, igDelayMin, igDelayMax })
      });
      Swal.fire({
        title: 'Thành công',
        text: 'Đã lưu cấu hình và khởi động lại lịch hẹn thành công!',
        icon: 'success',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        confirmButtonColor: 'var(--color-primary)'
      });
    } catch (e) {
      Swal.fire('Lỗi', 'Không thể lưu cấu hình', 'error');
    }
    setIsSaving(false);
  };

  const handleSaveEnv = async () => {
    setIsSavingEnv(true);
    try {
      const res = await fetch('/api/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envVars)
      });
      if (!res.ok) throw new Error('Lỗi cập nhật từ Server');
      Swal.fire({
        title: 'Thành công',
        text: 'Đã cập nhật khóa Access Token vào file .env!',
        icon: 'success',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        confirmButtonColor: 'var(--color-primary)'
      });
    } catch (e) {
      Swal.fire('Lỗi', 'Không thể lưu file .env. Vui lòng kiểm tra lại server.', 'error');
    }
    setIsSavingEnv(false);
  };

  const handleResetAI = async (provider) => {
    setIsResettingAI(provider);
    Swal.fire({
      title: 'Đang mở cửa sổ đăng nhập',
      text: 'Vui lòng thao tác trên cửa sổ Chrome vừa bật lên. Đăng nhập xong, hãy ĐÓNG TRÌNH DUYỆT để lưu Profile!',
      icon: 'info',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
    });
    
    try {
      const res = await fetch('/api/ai/reset-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider })
      });
      if (!res.ok) throw new Error('Lỗi backend');
      
      Swal.fire({
        title: 'Thành công',
        text: `Đã lưu profile đăng nhập của ${provider.toUpperCase()} thành công!`,
        icon: 'success',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        confirmButtonColor: 'var(--color-primary)'
      });
    } catch (e) {
      Swal.fire('Lỗi', 'Có lỗi xảy ra khi gọi Login Helper.', 'error');
    }
    setIsResettingAI(null);
  };

  const autoSaveSettings = async (updates) => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch (e) {
      console.error('Lỗi auto save:', e);
    }
  };

  const addTimeSlot = () => {
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (newTime && timeRegex.test(newTime)) {
      let formattedTime = newTime;
      if (formattedTime.length === 4) formattedTime = '0' + formattedTime;
      
      if (!timeSlots.includes(formattedTime)) {
        const updated = [...timeSlots, formattedTime].sort();
        setTimeSlots(updated);
        setNewTime('');
        autoSaveSettings({ timeSlots: updated });
      } else {
        setNewTime('');
      }
    } else if (newTime) {
      Swal.fire({
        title: 'Sai định dạng',
        text: 'Vui lòng nhập đúng định dạng 24h (VD: 08:30, 14:00)',
        icon: 'error',
        background: 'var(--color-surface)',
        color: 'white',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000
      });
    }
  };

  const removeTimeSlot = (time) => {
    const updated = timeSlots.filter(t => t !== time);
    setTimeSlots(updated);
    autoSaveSettings({ timeSlots: updated });
  };

  return (
    <div className="social-connections">
      {/* ─── Page Header ─── */}
      <div className="page-header">
        <h1>Cài đặt Mạng Xã Hội & API</h1>
        <p>Quản lý nền tảng tích hợp, lịch đăng bài và khóa API để hệ thống tự động vận hành.</p>
      </div>

      {/* ═══ Platform Status Cards ═══ */}
      <div className="platforms-grid">
        <div className="platform-card outline-card">
          <div className="platform-header">
            <div className="platform-icon facebook"><Facebook size={22} /></div>
            <div className="status-badge connected"><span className="dot"></span> Đã kết nối</div>
          </div>
          <div className="platform-info">
            <h3>Facebook</h3>
            <p className="text-muted">Fanpage hoạt động tốt</p>
          </div>
        </div>

        <div className="platform-card outline-card">
          <div className="platform-header">
            <div className="platform-icon instagram"><Instagram size={22} /></div>
            <div className="status-badge connected"><span className="dot"></span> Đã kết nối</div>
          </div>
          <div className="platform-info">
            <h3>Instagram</h3>
            <p className="text-muted">Đăng ảnh & carousel</p>
          </div>
        </div>

        <div className="platform-card outline-card">
          <div className="platform-header">
            <div className="platform-icon threads"><Threads size={22} /></div>
            <div className="status-badge coming-soon"><span className="dot"></span> Sắp ra mắt</div>
          </div>
          <div className="platform-info">
            <h3>Threads</h3>
            <p className="text-muted">Đang phát triển</p>
          </div>
          <span className="coming-soon-label"><Sparkles size={12} /> Bản cập nhật tới</span>
        </div>

        <div className="platform-card outline-card">
          <div className="platform-header">
            <div className={`platform-icon ${connectedSocials.tiktok ? '' : 'gray'}`}><TikTok size={22} /></div>
            <div className={`status-badge ${connectedSocials.tiktok ? 'connected' : 'coming-soon'}`}>
              <span className="dot"></span> {connectedSocials.tiktok ? 'Đã kết nối' : 'Sắp ra mắt'}
            </div>
          </div>
          <div className="platform-info">
            <h3>TikTok</h3>
            <p className="text-muted">{connectedSocials.tiktok ? 'Hoạt động tốt' : 'Mobile Automation'}</p>
          </div>
          {!connectedSocials.tiktok && (
            <span className="coming-soon-label"><Sparkles size={12} /> Bản cập nhật tới</span>
          )}
        </div>
      </div>

      {/* ═══ Settings Sections ═══ */}
      <div className="settings-sections">

        {/* ── Section 1 & 2: Chỉ Admin mới được xem ── */}
        {user && user.role === 'admin' && (
          <>
            {/* ── Section 1: Lịch Đăng ── */}
            <div className="section-card">
              <div className="section-header">
                <div className="icon-circle blue"><Clock size={16} /></div>
                <h3>Lịch Đăng & Tần Suất</h3>
              </div>
              <p className="section-desc">Cấu hình khung giờ đăng bài và khoảng trễ giữa các nền tảng mạng xã hội.</p>

              <div className="schedule-grid">
                {/* Left: Tần suất */}
                <div className="schedule-panel">
                  <h4>🕒 Khung giờ đăng</h4>
                  <div className="mode-switcher">
                    <button className={mode === 'real' ? 'active' : ''} onClick={() => { setMode('real'); autoSaveSettings({ mode: 'real' }); }}>Đăng Thật</button>
                    <button className={mode === 'test' ? 'active' : ''} onClick={() => { setMode('test'); autoSaveSettings({ mode: 'test' }); }}>Đăng Test</button>
                  </div>

                  {mode === 'real' ? (
                    <>
                      <div className="time-slots-wrap">
                        {timeSlots.map(time => (
                          <div key={time} className="time-chip">
                            {time}
                            <X size={12} onClick={() => removeTimeSlot(time)} />
                          </div>
                        ))}
                      </div>
                      <div className="time-add-row">
                        <input
                          className="time-input"
                          type="text"
                          placeholder="VD: 14:30"
                          maxLength="5"
                          autoComplete="off"
                          value={newTime}
                          onChange={e => {
                            let val = e.target.value.replace(/[^\d:]/g, '');
                            if (val.length === 2 && !val.includes(':') && e.target.value.length > newTime.length) {
                              val += ':';
                            }
                            setNewTime(val);
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') addTimeSlot(); }}
                        />
                        <button className="btn-outline" onClick={addTimeSlot} style={{padding: '6px 14px', fontSize: '12px'}}><Plus size={14} /> Thêm</button>
                      </div>
                    </>
                  ) : (
                    <div className="test-row">
                      <span>Cứ mỗi</span>
                      <input className="delay-input" type="number" autoComplete="off" value={testInterval} onChange={e => setTestInterval(e.target.value)} onBlur={() => autoSaveSettings({ testInterval })} min="1" />
                      <span>phút đăng 1 bài</span>
                    </div>
                  )}
                </div>

                {/* Right: IG Delay */}
                <div className={`schedule-panel ${mode === 'test' ? 'panel-disabled' : ''}`}>
                  <h4>⏳ Độ trễ Instagram</h4>
                  <p className="panel-desc">
                    {mode === 'test' ? 'Không áp dụng trong chế độ Đăng Test.' : 'Thời gian chờ random trước khi đẩy bài từ FB sang IG.'}
                  </p>
                  <div className="delay-row">
                    <input className="delay-input" type="number" autoComplete="off" value={igDelayMin} onChange={e => setIgDelayMin(e.target.value)} onBlur={() => autoSaveSettings({ igDelayMin })} min="0" disabled={mode === 'test'} />
                    <span className="delay-label">đến</span>
                    <input className="delay-input" type="number" autoComplete="off" value={igDelayMax} onChange={e => setIgDelayMax(e.target.value)} onBlur={() => autoSaveSettings({ igDelayMax })} min="0" disabled={mode === 'test'} />
                    <span className="delay-label">Phút</span>
                  </div>
                </div>
              </div>

              <div className="section-footer">
                <button className="btn-primary glow-primary" onClick={handleSaveSettings} disabled={isSaving}>
                  <Save size={14} style={{marginRight: '6px'}} /> {isSaving ? 'Đang lưu...' : 'Lưu Cấu Hình'}
                </button>
              </div>
            </div>

            {/* ── Section 2: API Tokens ── */}
            <div className="section-card">
              <div className="section-header">
                <div className="icon-circle pink"><Key size={16} /></div>
                <h3>Khóa API (Access Token)</h3>
              </div>
              <p className="section-desc">Cập nhật trực tiếp các khóa Access Token vào file .env. Thông tin được mã hóa và chỉ lưu trên máy cục bộ.</p>

              <div className="tokens-grid">
                <div className="token-box">
                  <label>Facebook Page Access Token</label>
                  <div className="token-input-row">
                    <input type={showTokens.fb ? "text" : "password"} autoComplete="off" value={envVars.FB_PAGE_ACCESS_TOKEN} onChange={e => setEnvVars({...envVars, FB_PAGE_ACCESS_TOKEN: e.target.value})} placeholder="EAALZ..." />
                    <button onClick={() => setShowTokens({...showTokens, fb: !showTokens.fb})}>{showTokens.fb ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  </div>
                </div>

                <div className="token-box">
                  <label>Instagram Access Token</label>
                  <div className="token-input-row">
                    <input type={showTokens.ig ? "text" : "password"} autoComplete="off" value={envVars.IG_ACCESS_TOKEN} onChange={e => setEnvVars({...envVars, IG_ACCESS_TOKEN: e.target.value})} placeholder="EAALZ..." />
                    <button onClick={() => setShowTokens({...showTokens, ig: !showTokens.ig})}>{showTokens.ig ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  </div>
                </div>

                <div className="token-box">
                  <label>Instagram User ID</label>
                  <div className="token-input-row">
                    <input type={showTokens.igId ? "text" : "password"} autoComplete="off" value={envVars.IG_USER_ID} onChange={e => setEnvVars({...envVars, IG_USER_ID: e.target.value})} placeholder="VD: 178414..." />
                    <button onClick={() => setShowTokens({...showTokens, igId: !showTokens.igId})}>{showTokens.igId ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  </div>
                </div>

                <div className="token-box">
                  <label>TikTok Session Cookie (Tùy chọn)</label>
                  <div className="token-input-row">
                    <input type={showTokens.tiktok ? "text" : "password"} autoComplete="off" value={envVars.TIKTOK_SESSION_ID} onChange={e => setEnvVars({...envVars, TIKTOK_SESSION_ID: e.target.value})} placeholder="VD: 5543c8d..." />
                    <button onClick={() => setShowTokens({...showTokens, tiktok: !showTokens.tiktok})}>{showTokens.tiktok ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  </div>
                </div>
              </div>

              <div className="section-footer">
                <button className="btn-primary glow-primary" onClick={handleSaveEnv} disabled={isSavingEnv}>
                  <Save size={14} style={{marginRight: '6px'}} /> {isSavingEnv ? 'Đang lưu...' : 'Cập nhật File .env'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Section 3: AI Login ── */}
        <div className="section-card">
          <div className="section-header">
            <div className="icon-circle green"><BrainCircuit size={16} /></div>
            <h3>Trí Tuệ Nhân Tạo (Web Automation)</h3>
          </div>
          <p className="section-desc">Quản lý phiên đăng nhập AI chạy ngầm. Nếu bị văng hoặc dính Checkpoint, dùng Login Helper để dọn rác và đăng nhập lại.</p>

          <div className="ai-grid">
            <div className="ai-card">
              <div className="ai-card-top">
                <div className="ai-avatar chatgpt"><BrainCircuit size={20} color="white" /></div>
                <div>
                  <div className="ai-name">ChatGPT Plus</div>
                  <div className="ai-model chatgpt">Mô hình: GPT-4 Vision</div>
                </div>
              </div>
              <button
                className="btn-outline w-full justify-center"
                onClick={() => handleResetAI('chatgpt')}
                disabled={isResettingAI === 'chatgpt'}
                style={{borderColor: '#10a37f', color: '#10a37f', fontSize: '12px'}}
              >
                {isResettingAI === 'chatgpt' ? <RefreshCw className="spin" size={14} style={{marginRight: '6px'}}/> : <RefreshCw size={14} style={{marginRight: '6px'}} />}
                {isResettingAI === 'chatgpt' ? 'Đang chờ thao tác...' : 'Làm mới & Đăng nhập lại'}
              </button>
            </div>

            <div className="ai-card">
              <div className="ai-card-top">
                <div className="ai-avatar gemini"><BrainCircuit size={20} color="white" /></div>
                <div>
                  <div className="ai-name">Gemini Advanced</div>
                  <div className="ai-model gemini">Mô hình: Gemini 1.5 Pro</div>
                </div>
              </div>
              <button
                className="btn-outline w-full justify-center"
                onClick={() => handleResetAI('gemini')}
                disabled={isResettingAI === 'gemini'}
                style={{borderColor: '#4285f4', color: '#4285f4', fontSize: '12px'}}
              >
                {isResettingAI === 'gemini' ? <RefreshCw className="spin" size={14} style={{marginRight: '6px'}}/> : <RefreshCw size={14} style={{marginRight: '6px'}} />}
                {isResettingAI === 'gemini' ? 'Đang chờ thao tác...' : 'Làm mới & Đăng nhập lại'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Section 4: User Management (Admin Only) ── */}
        {user && user.role === 'admin' && (
          <div className="section-card" style={{ borderColor: 'var(--color-primary)', background: 'linear-gradient(to right, rgba(255, 77, 141, 0.05), transparent)' }}>
            <div className="section-header">
              <div className="icon-circle pink"><Users size={16} /></div>
              <h3 style={{ color: 'var(--color-primary)' }}>Quản lý Nhân sự (Admin)</h3>
            </div>
            <p className="section-desc">Phân quyền truy cập, tạo tài khoản và quản lý mật khẩu cho nhân viên trong hệ thống.</p>
            
            <div className="section-footer" style={{ borderTop: 'none', padding: '0 20px 20px 20px', justifyContent: 'flex-start' }}>
              <Link to="/settings/users" className="btn-primary glow-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
                Truy cập trang Quản lý Nhân sự <ChevronRight size={16} />
              </Link>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default SocialConnections;
