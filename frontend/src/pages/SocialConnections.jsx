import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Copy, Link2, Clock, Plus, X, Save, Check, Eye, EyeOff, BrainCircuit, RefreshCw, Sparkles, Trash2, AlertCircle, Play, CheckCircle2, XCircle, FileText, ChevronDown, ChevronRight, Settings, Users, Edit2, MessageSquare } from 'lucide-react';
import Swal from 'sweetalert2';
import { Facebook, Instagram, Threads, TikTok } from '../components/SocialIcons';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import api from './ShopeeManager/apiClient';
import './SocialConnections.css';

const SocialConnections = () => {
  const { user } = useAuth();
  const [timeSlots, setTimeSlots] = useState([]);
  const [newTime, setNewTime] = useState('');
  const [mode, setMode] = useState('real');
  const [testInterval, setTestInterval] = useState(5);
  const [igDelayMin, setIgDelayMin] = useState(10);
  const [igDelayMax, setIgDelayMax] = useState(20);
  
  // AI Chatbot Settings
  const [botEnabled, setBotEnabled] = useState(false);
  const [botPauseHours, setBotPauseHours] = useState(2);
  const [botDelayMin, setBotDelayMin] = useState(3);
  const [botDelayMax, setBotDelayMax] = useState(8);

  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  // API Power Toggles (Nhóm 1: Dùng API trực tiếp)
  const [allowAutoFill, setAllowAutoFill] = useState(true);
  const [allowShopee, setAllowShopee] = useState(true);
  const [allowChatbot, setAllowChatbot] = useState(true);

  // API Power Toggles (Nhóm 2: Thay thế Playwright)
  const [allowContent, setAllowContent] = useState(false);
  const [allowImage, setAllowImage] = useState(false);
  const [allowTracking, setAllowTracking] = useState(false);
  const [allowZalo, setAllowZalo] = useState(false);

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
  const [isSyncingImages, setIsSyncingImages] = useState(false);

  const [accounts, setAccounts] = useState([]);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountForm, setAccountForm] = useState({ id: '', name: '', fbAccessToken: '', fbPageId: '', igAccessToken: '', igUserId: '', isActive: true });


  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        setMode(data.mode || 'real');
        setTestInterval(data.testInterval || 5);
        setTimeSlots(Array.isArray(data.timeSlots) ? data.timeSlots : []);
        setIgDelayMin(data.igDelayMin || 10);
        setIgDelayMax(data.igDelayMax || 20);
        
        setBotEnabled(data.botEnabled || false);
        setBotPauseHours(data.botPauseHours || 2);
        setBotDelayMin(data.botDelayMin || 3);
        setBotDelayMax(data.botDelayMax || 8);
        if (data.connectedSocials) {
          setConnectedSocials(data.connectedSocials);
        }
      })
      .catch(err => console.error(err));

    api.getSetting('gemini_api_key')
      .then(key => { if (key) setGeminiApiKey(key); })
      .catch(err => console.error(err));
      
    api.getSetting('gemini_allow_autofill').then(val => { if (val === 'false') setAllowAutoFill(false); });
    api.getSetting('gemini_allow_shopee').then(val => { if (val === 'false') setAllowShopee(false); });
    api.getSetting('gemini_allow_chatbot').then(val => { if (val === 'false') setAllowChatbot(false); });
    api.getSetting('gemini_allow_content').then(val => { if (val === 'true') setAllowContent(true); });
    api.getSetting('gemini_allow_image').then(val => { if (val === 'true') setAllowImage(true); });
    api.getSetting('gemini_allow_tracking').then(val => { if (val === 'true') setAllowTracking(true); });
    api.getSetting('gemini_allow_zalo').then(val => { if (val === 'true') setAllowZalo(true); });
    
    fetch('/api/accounts')
      .then(res => res.json())
      .then(data => {
        setAccounts(Array.isArray(data) ? data : []);
      })
      .catch(err => console.error('Lỗi khi fetch accounts', err));

  }, []);



  
  const handleSaveAccounts = async (newAccounts) => {
    try {
      await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccounts)
      });
      setAccounts(newAccounts);
      Swal.fire({ title: 'Thành công', text: 'Đã cập nhật danh sách tài khoản!', icon: 'success', background: 'var(--color-surface)', color: 'white' });
    } catch (e) {
      Swal.fire('Lỗi', 'Không thể lưu danh sách tài khoản', 'error');
    }
  };

  const handleOpenAccountModal = (acc = null) => {
    if (acc) {
      setEditingAccount(acc);
      setAccountForm(acc);
    } else {
      setEditingAccount(null);
      setAccountForm({ id: 'acc_' + Date.now(), name: '', fbAccessToken: '', fbPageId: '', igAccessToken: '', igUserId: '', isActive: true });
    }
    setIsAccountModalOpen(true);
  };

  const handleCloseAccountModal = () => {
    setIsAccountModalOpen(false);
    setEditingAccount(null);
  };

  const handleSubmitAccount = () => {
    if (!accountForm.name) return Swal.fire('Lỗi', 'Vui lòng nhập Tên tài khoản', 'error');
    
    let newAccounts;
    if (editingAccount) {
      newAccounts = accounts.map(a => a.id === editingAccount.id ? accountForm : a);
    } else {
      newAccounts = [...accounts, accountForm];
    }
    
    handleSaveAccounts(newAccounts);
    handleCloseAccountModal();
  };

  const handleDeleteAccount = (id) => {
    Swal.fire({
      title: 'Xóa tài khoản?',
      text: 'Bạn có chắc chắn muốn xóa tài khoản này không?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ff4d8d',
      cancelButtonColor: 'var(--color-surface-light)',
      confirmButtonText: 'Xóa ngay',
      cancelButtonText: 'Hủy'
    }).then((result) => {
      if (result.isConfirmed) {
        const newAccounts = accounts.filter(a => a.id !== id);
        handleSaveAccounts(newAccounts);
      }
    });
  };

  const handleToggleAccountActive = (id) => {
    const newAccounts = accounts.map(a => {
      if (a.id === id) return { ...a, isActive: !a.isActive };
      return a;
    });
    // Optimistic UI update
    setAccounts(newAccounts);
    fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newAccounts)
    }).catch(() => setAccounts(accounts)); // Revert if failed
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

  const handleSaveGeminiKey = async () => {
    try {
      await api.saveEnvSetting('gemini_api_key', geminiApiKey);
      Swal.fire({ title: 'Thành công', text: 'Đã lưu Khóa API Gemini vào file .env và hệ thống!', icon: 'success', background: 'var(--color-surface)', color: 'white' });
    } catch (e) {
      Swal.fire('Lỗi', 'Không thể lưu Khóa API Gemini', 'error');
    }
  };

  const handleToggleApiPower = async (key, value, setter) => {
    setter(value);
    try {
      await api.saveEnvSetting(key, value ? 'true' : 'false');
    } catch (e) {
      console.error('Lỗi khi lưu toggle API:', e);
    }
  };

  const handleSyncImages = async () => {
    setIsSyncingImages(true);
    try {
      Swal.fire({
        toast: true, position: 'top-end', icon: 'info', 
        title: 'Đang đồng bộ ảnh từ Google Sheets ngầm...', 
        showConfirmButton: false, timer: 3000
      });
      await fetch('/api/crm/bot/sync-images', { method: 'POST' });
    } catch(e) {
      console.error(e);
    }
    setTimeout(() => setIsSyncingImages(false), 3000);
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


            </div>

            
            {/* ── AI Chatbot Settings ── */}
            <div className="section-card">
              <div className="section-header">
                <div className="icon-circle green"><MessageSquare size={16} /></div>
                <h3>Cài Đặt Chatbot Tư Vấn (Gemini)</h3>
              </div>
              <p className="section-desc">Cấu hình cho trợ lý ảo tự động trả lời khách hàng qua Inbox.</p>

              <div className="schedule-grid">
                <div className="schedule-panel">
                  <h4>Trạng thái Chatbot</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginTop: '10px' }}>
                    <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '50px', height: '24px' }}>
                      <input 
                        type="checkbox" 
                        checked={botEnabled} 
                        onChange={(e) => { setBotEnabled(e.target.checked); autoSaveSettings({ botEnabled: e.target.checked }); }} 
                        style={{ opacity: 0, width: 0, height: 0, margin: 0 }} 
                      />
                      <span className="slider round" style={{ 
                        position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, 
                        backgroundColor: botEnabled ? '#10b981' : '#3f4147', borderRadius: '24px', transition: '.4s' 
                      }}>
                        <span style={{ 
                          position: 'absolute', content: '""', height: '18px', width: '18px', left: botEnabled ? '28px' : '3px', 
                          bottom: '3px', backgroundColor: 'white', borderRadius: '50%', transition: '.4s' 
                        }}></span>
                      </span>
                    </label>
                    <span style={{ color: botEnabled ? '#10b981' : '#8a8b91', fontWeight: 'bold' }}>
                      {botEnabled ? 'Đang bật' : 'Đang tắt'}
                    </span>
                  </div>

                  <h4 style={{ marginTop: '20px' }}>Tự động bật lại Bot</h4>
                  <p className="text-muted" style={{ fontSize: '12px', marginBottom: '8px' }}>
                    Sau khi Nhân viên can thiệp, Bot sẽ tự động bật lại sau bao lâu?
                  </p>
                  <div className="delay-row">
                    <input className="delay-input" type="number" autoComplete="off" value={botPauseHours} onChange={e => setBotPauseHours(e.target.value)} onBlur={() => autoSaveSettings({ botPauseHours })} min="1" />
                    <span className="delay-label">Giờ</span>
                  </div>
                </div>

                <div className="schedule-panel">
                  <h4>⏳ Độ trễ trả lời của Bot</h4>
                  <p className="panel-desc">
                    Thời gian chờ random trước khi Bot gửi tin nhắn để tạo cảm giác tự nhiên như người thật đang gõ.
                  </p>
                  <div className="delay-row">
                    <input className="delay-input" type="number" autoComplete="off" value={botDelayMin} onChange={e => setBotDelayMin(e.target.value)} onBlur={() => autoSaveSettings({ botDelayMin })} min="0" />
                    <span className="delay-label">đến</span>
                    <input className="delay-input" type="number" autoComplete="off" value={botDelayMax} onChange={e => setBotDelayMax(e.target.value)} onBlur={() => autoSaveSettings({ botDelayMax })} min="0" />
                    <span className="delay-label">Giây</span>
                  </div>
                </div>
              </div>

              {/* Gemini API Key input block */}
              <div style={{ marginTop: '20px', padding: '16px', background: 'var(--color-surface-light)', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#10b981' }}>
                  <Key size={16} /> Khóa Gemini API (Cấu hình)
                </h4>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input 
                      type={showGeminiKey ? "text" : "password"} 
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder="AIzaSy..." 
                      style={{ width: '100%', padding: '10px 40px 10px 12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'white', borderRadius: '8px', fontFamily: 'monospace' }} 
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGeminiKey(); }}
                    />
                    <div 
                      onClick={() => setShowGeminiKey(!showGeminiKey)} 
                      style={{ position: 'absolute', right: '12px', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                      title={showGeminiKey ? 'Ẩn Key' : 'Hiện Key'}
                    >
                      {showGeminiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </div>
                  </div>
                  <button 
                    onClick={handleSaveGeminiKey}
                    className="btn-primary glow-primary" 
                    style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                  >
                    <Save size={16} /> Lưu Key
                  </button>
                </div>
                
                {/* Toggles for API Source */}
                <div style={{ margin: '16px 0 12px', borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '12px' }}>
                  <div style={{ fontWeight: 'bold', color: '#e2e8f0', fontSize: '13px', marginBottom: '4px' }}>Phân bổ Nguồn API cho:</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <AnimatePresence>
                    {(() => {
                      const allItems = [
                        { id: 'autofill', key: 'gemini_allow_autofill', state: allowAutoFill, setState: setAllowAutoFill, color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.05)', border: 'rgba(6, 182, 212, 0.2)', title: '⚡ Tool Cào Dữ Liệu (Auto Fill Sheet)', desc: 'Trích xuất thông số, dịch tự động từ ảnh', index: 0 },
                        { id: 'shopee', key: 'gemini_allow_shopee', state: allowShopee, setState: setAllowShopee, color: '#FF4D8D', bg: 'rgba(255, 77, 141, 0.05)', border: 'rgba(255, 77, 141, 0.2)', title: '🛍️ Shopee Manager', desc: 'Xào nấu nội dung, sinh mô tả SEO theo Template', index: 1 },
                        { id: 'chatbot', key: 'gemini_allow_chatbot', state: allowChatbot, setState: setAllowChatbot, color: '#10b981', bg: 'rgba(16, 185, 129, 0.05)', border: 'rgba(16, 185, 129, 0.2)', title: '🤖 Chatbot Tư Vấn', desc: 'Fallback trả lời văn bản và phân tích ảnh (Vision)', index: 2 },
                        { id: 'content', key: 'gemini_allow_content', state: allowContent, setState: setAllowContent, color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.05)', border: 'rgba(139, 92, 246, 0.2)', title: '📝 Viết Content MXH', desc: 'Viết caption FB, IG, Reels (hiện dùng ChatGPT Plus qua Playwright)', index: 3 },
                        { id: 'image', key: 'gemini_allow_image', state: allowImage, setState: setAllowImage, color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.05)', border: 'rgba(245, 158, 11, 0.2)', title: '🎨 Tạo Ảnh Nền AI', desc: 'Ghép ảnh đồng hồ vào nền (hiện dùng ChatGPT Plus). Tắt = dùng ảnh gốc', index: 4 },
                        { id: 'tracking', key: 'gemini_allow_tracking', state: allowTracking, setState: setAllowTracking, color: '#EC4899', bg: 'rgba(236, 72, 153, 0.05)', border: 'rgba(236, 72, 153, 0.2)', title: '📊 Tracking Feedback', desc: 'Gửi feedback huấn luyện AI khi bài viết có tương tác tốt', index: 5 },
                        { id: 'zalo', key: 'gemini_allow_zalo', state: allowZalo, setState: setAllowZalo, color: '#06B6D4', bg: 'rgba(6, 182, 212, 0.05)', border: 'rgba(6, 182, 212, 0.2)', title: '📱 Zalo Content', desc: 'Viết bài đăng nhóm Zalo CTV (hiện dùng Gemini Plus qua Playwright)', index: 6 }
                      ];

                      const topItems = allItems.filter(i => i.state).sort((a,b) => a.index - b.index);
                      const bottomItems = allItems.filter(i => !i.state).sort((a,b) => a.index - b.index);
                      
                      const combinedList = [
                        ...topItems,
                        ...(bottomItems.length > 0 ? [{ isDivider: true, id: 'divider_playwright' }] : []),
                        ...bottomItems
                      ];

                      return combinedList.map((item) => {
                        if (item.isDivider) {
                          return (
                            <motion.div 
                              layout 
                              key={item.id}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              style={{ margin: '6px 0 2px', borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '12px' }}
                            >
                              <div style={{ fontWeight: 'bold', color: '#e2e8f0', fontSize: '13px', marginBottom: '4px' }}>Playwright</div>
                            </motion.div>
                          );
                        }

                        return (
                          <motion.div 
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ type: "spring", stiffness: 350, damping: 25 }}
                            key={item.id} 
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: item.bg, padding: '10px 14px', borderRadius: '8px', border: `1px solid ${item.border}` }}
                          >
                            <div>
                              <div style={{ color: item.color, fontWeight: 'bold', fontSize: '13px' }}>{item.title}</div>
                              <div style={{ color: 'var(--color-text-muted)', fontSize: '11px', marginTop: '2px' }}>{item.desc}</div>
                            </div>
                            <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '20px' }}>
                              <input type="checkbox" checked={item.state} onChange={(e) => handleToggleApiPower(item.key, e.target.checked, item.setState)} style={{ opacity: 0, width: 0, height: 0, margin: 0 }} />
                              <span className="slider round" style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: item.state ? item.color : '#3f4147', borderRadius: '24px', transition: '.4s' }}>
                                <span style={{ position: 'absolute', content: '""', height: '14px', width: '14px', left: item.state ? '23px' : '3px', bottom: '3px', backgroundColor: 'white', borderRadius: '50%', transition: '.4s' }}></span>
                              </span>
                            </label>
                          </motion.div>
                        );
                      });
                    })()}
                  </AnimatePresence>
                </div>


              </div>

              <div className="section-footer">
                <button 
                  className="btn-outline" 
                  onClick={handleSyncImages} 
                  disabled={isSyncingImages}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <RefreshCw size={14} className={isSyncingImages ? 'spin' : ''} />
                  Đồng bộ Ảnh Gốc (Lớp 2)
                </button>
              </div>
            </div>

            {/* ── Section 2: Quản lý Tài Khoản Đăng Bài ── */}
            <div className="section-card">
              <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div className="icon-circle pink"><Users size={16} /></div>
                  <h3>Danh sách Tài Khoản Đăng Bài</h3>
                </div>
                <button className="btn-primary glow-primary" onClick={() => handleOpenAccountModal()} style={{ padding: '6px 12px', fontSize: '12px' }}>
                  <Plus size={14} style={{marginRight: '4px'}} /> Thêm tài khoản
                </button>
              </div>
              <p className="section-desc">Quản lý nhiều Fanpage / Instagram để AI viết bài khác nhau cho từng kênh.</p>

              <div className="accounts-list" style={{ marginTop: '15px' }}>
                {accounts.length === 0 ? (
                   <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-muted)' }}>Chưa có tài khoản nào. Hãy thêm tài khoản đầu tiên.</div>
                ) : (
                   <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                     {accounts.map(acc => (
                       <div key={acc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--color-surface-light)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                           <div onClick={() => handleToggleAccountActive(acc.id)} style={{ cursor: 'pointer', color: acc.isActive ? '#10a37f' : 'var(--color-text-muted)' }}>
                             {acc.isActive ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                           </div>
                           <div>
                             <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--color-text)' }}>{acc.name}</h4>
                             <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px', display: 'flex', gap: '8px' }}>
                               {acc.fbAccessToken ? <span style={{ color: '#1877f2' }}>FB: Đã liên kết</span> : <span>FB: Trống</span>}
                               {acc.igAccessToken ? <span style={{ color: '#e1306c' }}>IG: Đã liên kết</span> : <span>IG: Trống</span>}
                             </div>
                           </div>
                         </div>
                         <div style={{ display: 'flex', gap: '8px' }}>
                           <button onClick={() => handleOpenAccountModal(acc)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}><Edit2 size={16} /></button>
                           <button onClick={() => handleDeleteAccount(acc.id)} style={{ background: 'none', border: 'none', color: '#ff4d8d', cursor: 'pointer' }}><Trash2 size={16} /></button>
                         </div>
                       </div>
                     ))}
                   </div>
                )}
              </div>
            </div>

            {/* Modal Sửa Tài Khoản */}
            {isAccountModalOpen && (
              <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="modal-content" style={{ background: 'var(--color-surface)', width: '500px', borderRadius: '12px', padding: '24px', position: 'relative' }}>
                  <button onClick={handleCloseAccountModal} style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--color-text)', cursor: 'pointer' }}><X size={20} /></button>
                  <h3 style={{ marginTop: 0, marginBottom: '20px' }}>{editingAccount ? 'Sửa Tài Khoản' : 'Thêm Tài Khoản'}</h3>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--color-text-muted)' }}>Tên Gợi Nhớ</label>
                      <input type="text" value={accountForm.name} onChange={e => setAccountForm({...accountForm, name: e.target.value})} style={{ width: '100%', padding: '10px', background: 'var(--color-surface-light)', border: '1px solid var(--color-border)', color: 'white', borderRadius: '6px' }} placeholder="VD: Fanpage Chính" />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--color-text-muted)' }}>Facebook Page Access Token</label>
                      <input type="text" value={accountForm.fbAccessToken} onChange={e => setAccountForm({...accountForm, fbAccessToken: e.target.value})} style={{ width: '100%', padding: '10px', background: 'var(--color-surface-light)', border: '1px solid var(--color-border)', color: 'white', borderRadius: '6px' }} placeholder="EAALZ..." />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--color-text-muted)' }}>Facebook Page ID (Tùy chọn)</label>
                      <input type="text" value={accountForm.fbPageId} onChange={e => setAccountForm({...accountForm, fbPageId: e.target.value})} style={{ width: '100%', padding: '10px', background: 'var(--color-surface-light)', border: '1px solid var(--color-border)', color: 'white', borderRadius: '6px' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--color-text-muted)' }}>Instagram Access Token</label>
                      <input type="text" value={accountForm.igAccessToken} onChange={e => setAccountForm({...accountForm, igAccessToken: e.target.value})} style={{ width: '100%', padding: '10px', background: 'var(--color-surface-light)', border: '1px solid var(--color-border)', color: 'white', borderRadius: '6px' }} placeholder="EAALZ..." />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--color-text-muted)' }}>Instagram User ID</label>
                      <input type="text" value={accountForm.igUserId} onChange={e => setAccountForm({...accountForm, igUserId: e.target.value})} style={{ width: '100%', padding: '10px', background: 'var(--color-surface-light)', border: '1px solid var(--color-border)', color: 'white', borderRadius: '6px' }} placeholder="178414..." />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
                    <button onClick={handleCloseAccountModal} style={{ padding: '8px 16px', background: 'var(--color-surface-light)', border: 'none', color: 'white', borderRadius: '6px', cursor: 'pointer' }}>Hủy</button>
                    <button onClick={handleSubmitAccount} className="btn-primary glow-primary" style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Lưu Tài Khoản</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Section 3: AI Login ── */}
          </>
        )}

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
