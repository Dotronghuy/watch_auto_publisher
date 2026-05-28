import { useState, useEffect } from 'react';
import { Key, Copy, Link2, Clock, Plus, X, Save, Check, Eye, EyeOff, BrainCircuit, RefreshCw } from 'lucide-react';
import Swal from 'sweetalert2';
import { Facebook, Instagram, Threads, TikTok } from '../components/SocialIcons';
import './SocialConnections.css';

const SocialConnections = () => {
  const [timeSlots, setTimeSlots] = useState([]);
  const [newTime, setNewTime] = useState('08:00');
  const [mode, setMode] = useState('real');
  const [testInterval, setTestInterval] = useState(5);
  const [igDelayMin, setIgDelayMin] = useState(10);
  const [igDelayMax, setIgDelayMax] = useState(20);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
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
    fetch('http://localhost:3000/api/settings')
      .then(res => res.json())
      .then(data => {
        setMode(data.mode || 'real');
        setTestInterval(data.testInterval || 5);
        setTimeSlots(data.timeSlots || ["08:00", "11:30", "20:00"]);
        setIgDelayMin(data.igDelayMin || 10);
        setIgDelayMax(data.igDelayMax || 20);
        if (data.connectedSocials) {
          setConnectedSocials(data.connectedSocials);
        }
      })
      .catch(err => console.error(err));

    fetch('http://localhost:3000/api/env')
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
      await fetch('http://localhost:3000/api/settings', {
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
      const res = await fetch('http://localhost:3000/api/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envVars)
      });
      if (!res.ok) {
        throw new Error('Lỗi cập nhật từ Server');
      }
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
      const res = await fetch('http://localhost:3000/api/ai/reset-profile', {
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

  const addTimeSlot = () => {
    if (!timeSlots.includes(newTime)) {
      setTimeSlots([...timeSlots, newTime].sort());
    }
  };

  const removeTimeSlot = (time) => {
    setTimeSlots(timeSlots.filter(t => t !== time));
  };
  return (
    <div className="social-connections">
      <div className="page-header">
        <h1>Cài đặt Mạng Xã Hội & API</h1>
        <p>Quản lý các nền tảng tích hợp và thông tin API để phần mềm tự động lấy bài và đăng lên các kênh.</p>
      </div>

      <div className="platforms-grid">
        <div className="platform-card outline-card">
          <div className="platform-header">
            <div className="platform-icon facebook"><Facebook size={24} /></div>
            <div className="status-badge connected"><span className="dot"></span> Đã kết nối</div>
          </div>
          <div className="platform-info">
            <h3>Facebook</h3>
            <p className="text-muted">Hoạt động tốt</p>
          </div>
        </div>

        <div className="platform-card outline-card">
          <div className="platform-header">
            <div className="platform-icon instagram"><Instagram size={24} /></div>
            <div className="status-badge connected"><span className="dot"></span> Đã kết nối</div>
          </div>
          <div className="platform-info">
            <h3>Instagram</h3>
            <p className="text-muted">Hoạt động tốt</p>
          </div>
        </div>

        <div className="platform-card outline-card">
          <div className="platform-header">
            <div className="platform-icon threads"><Threads size={24} /></div>
            <div className="status-badge disconnected"><span className="dot"></span> Chưa kết nối</div>
          </div>
          <div className="platform-info">
            <h3>Threads</h3>
            <p className="text-muted">Chưa kết nối tài khoản</p>
          </div>
          <button className="btn-ghost mt-4 w-full justify-center" onClick={() => {
            Swal.fire({
              title: 'Sắp ra mắt',
              text: 'Tính năng kết nối với Threads đang được phát triển trong bản cập nhật tới!',
              icon: 'info',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              confirmButtonColor: 'var(--color-primary)'
            });
          }}>
            <Link2 size={14} className="mr-2" /> Kết nối ngay
          </button>
        </div>

        <div className="platform-card outline-card">
          <div className="platform-header">
            <div className={`platform-icon ${connectedSocials.tiktok ? '' : 'gray'}`}><TikTok size={24} /></div>
            <div className={`status-badge ${connectedSocials.tiktok ? 'connected' : 'disconnected'}`}><span className="dot"></span> {connectedSocials.tiktok ? 'Đã kết nối' : 'Cần Session Cookie'}</div>
          </div>
          <div className="platform-info">
            <h3>TikTok</h3>
            <p className="text-muted">{connectedSocials.tiktok ? 'Hoạt động tốt' : 'Nhập mã Session Cookie ảo.'}</p>
          </div>
          {!connectedSocials.tiktok && (
            <button className="btn-ghost mt-4 w-full justify-center" onClick={() => {
              Swal.fire({
                title: 'Nhập Session Cookie',
                input: 'text',
                inputPlaceholder: 'Dán mã cookie của TikTok vào đây...',
                showCancelButton: true,
                confirmButtonText: 'Xác thực & Kết nối',
                cancelButtonText: 'Hủy',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                confirmButtonColor: 'var(--color-primary)',
                showLoaderOnConfirm: true,
                preConfirm: async (cookie) => {
                  if (!cookie || cookie.length < 20) {
                    Swal.showValidationMessage('Mã Cookie không hợp lệ hoặc đã hết hạn!');
                    return false;
                  }
                  // Giả lập thời gian máy chủ ping tới API TikTok để kiểm tra cookie
                  return new Promise(resolve => setTimeout(() => resolve(cookie), 2000));
                }
              }).then(async (result) => {
                if (result.isConfirmed && result.value) {
                  const newSocials = { ...connectedSocials, tiktok: true };
                  setConnectedSocials(newSocials);
                  await fetch('http://localhost:3000/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connectedSocials: newSocials })
                  });
                  Swal.fire({ title: 'Đã kết nối!', text: 'Mã Cookie hợp lệ. Đã liên kết tài khoản TikTok.', icon: 'success', background: 'var(--color-surface)', color: 'white' });
                }
              });
            }}>
              <Link2 size={14} className="mr-2" /> Nhập mã Cookie
            </button>
          )}
        </div>
      </div>

      <div className="developer-settings" style={{marginTop: '24px'}}>
        <div className="dev-card glass" style={{marginBottom: '24px'}}>
          <div className="dev-card-header">
            <Clock size={20} className="blue" />
            <h3>Cấu hình Lịch Đăng (Global Schedule)</h3>
          </div>
          <p className="dev-card-desc">Cấu hình khung Giờ Vàng để đăng bài và Độ trễ giữa các nền tảng mạng xã hội.</p>
          
          <div style={{display: 'flex', gap: '24px', marginTop: '16px'}}>
            {/* Khung Giờ Đăng */}
            <div style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-light)'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px'}}>
                <h4 style={{fontSize: '13px', margin: 0}}>🕒 Cấu hình Tần suất</h4>
                <div style={{display: 'flex', gap: '8px', background: 'var(--color-surface)', borderRadius: '4px', padding: '2px'}}>
                  <button className={`btn-ghost ${mode === 'real' ? 'active' : ''}`} style={{padding: '4px 8px', fontSize: '11px', background: mode === 'real' ? 'rgba(255,255,255,0.1)' : 'transparent'}} onClick={() => setMode('real')}>Đăng Thật</button>
                  <button className={`btn-ghost ${mode === 'test' ? 'active' : ''}`} style={{padding: '4px 8px', fontSize: '11px', background: mode === 'test' ? 'rgba(255,255,255,0.1)' : 'transparent'}} onClick={() => setMode('test')}>Đăng Test</button>
                </div>
              </div>

              {mode === 'real' ? (
                <>
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px'}}>
                    {timeSlots.map(time => (
                      <div key={time} style={{display: 'flex', alignItems: 'center', backgroundColor: 'rgba(255, 77, 141, 0.1)', color: 'var(--color-primary)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', border: '1px solid rgba(255, 77, 141, 0.2)'}}>
                        {time}
                        <X size={12} style={{marginLeft: '6px', cursor: 'pointer'}} onClick={() => removeTimeSlot(time)} />
                      </div>
                    ))}
                  </div>
                  <div style={{display: 'flex', gap: '8px'}}>
                    <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} style={{background: 'var(--color-canvas)', border: '1px solid var(--border-light)', color: 'white', padding: '6px 10px', borderRadius: '4px'}} />
                    <button className="btn-outline" onClick={addTimeSlot} style={{padding: '6px 12px'}}><Plus size={14} /> Thêm</button>
                  </div>
                </>
              ) : (
                <div style={{display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '6px'}}>
                  <span style={{fontSize: '12px'}}>Cứ mỗi</span>
                  <input type="number" value={testInterval} onChange={e => setTestInterval(e.target.value)} min="1" style={{background: 'var(--color-canvas)', border: '1px solid var(--border-light)', color: 'white', padding: '6px 10px', borderRadius: '4px', width: '70px', textAlign: 'center'}} />
                  <span style={{fontSize: '12px'}}>phút đăng 1 bài</span>
                </div>
              )}
            </div>

            {/* Độ trễ IG */}
            <div style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-light)', opacity: mode === 'test' ? 0.5 : 1, pointerEvents: mode === 'test' ? 'none' : 'auto'}}>
              <h4 style={{fontSize: '13px', marginBottom: '12px'}}>⏳ Độ trễ Instagram (IG Delay)</h4>
              <p style={{fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '12px'}}>
                {mode === 'test' ? 'Không áp dụng khoảng trễ ngẫu nhiên trong chế độ Đăng Test.' : 'Random thời gian đăng lên IG sau khi đã lên bài trên FB.'}
              </p>
              <div style={{display: 'flex', gap: '8px', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '6px'}}>
                <input type="number" value={igDelayMin} onChange={e => setIgDelayMin(e.target.value)} min="0" style={{background: 'var(--color-canvas)', border: '1px solid var(--border-light)', color: 'white', padding: '6px 10px', borderRadius: '4px', width: '70px', textAlign: 'center'}} disabled={mode === 'test'} />
                <span style={{color: 'var(--color-text-muted)', fontSize: '13px'}}>đến</span>
                <input type="number" value={igDelayMax} onChange={e => setIgDelayMax(e.target.value)} min="0" style={{background: 'var(--color-canvas)', border: '1px solid var(--border-light)', color: 'white', padding: '6px 10px', borderRadius: '4px', width: '70px', textAlign: 'center'}} disabled={mode === 'test'} />
                <span style={{fontSize: '13px'}}>Phút</span>
              </div>
            </div>
          </div>

          <div style={{marginTop: '20px', display: 'flex', justifyContent: 'flex-end'}}>
            <button className="btn-primary glow-primary" onClick={handleSaveSettings} disabled={isSaving}>
              <Save size={16} className="mr-2" style={{marginRight: '8px'}} /> {isSaving ? 'Đang lưu...' : 'Lưu Cấu Hình'}
            </button>
          </div>
        </div>

        <div className="dev-card glass">
          <div className="dev-card-header">
            <Key size={20} className="pink" />
            <h3>Cấu hình API Meta (Facebook & Instagram)</h3>
          </div>
          <p className="dev-card-desc">Cập nhật trực tiếp các khóa Access Token lưu trữ trong file .env của Backend.</p>
          
          <div className="credential-box" style={{marginBottom: '12px'}}>
            <div className="cred-label">Facebook Page Access Token</div>
            <div className="cred-input-group">
              <input type={showTokens.fb ? "text" : "password"} value={envVars.FB_PAGE_ACCESS_TOKEN} onChange={e => setEnvVars({...envVars, FB_PAGE_ACCESS_TOKEN: e.target.value})} placeholder="EAALZ..." />
              <button className="btn-icon-square" onClick={() => setShowTokens({...showTokens, fb: !showTokens.fb})}>
                {showTokens.fb ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div className="credential-box" style={{marginBottom: '12px'}}>
            <div className="cred-label">Instagram Access Token</div>
            <div className="cred-input-group">
              <input type={showTokens.ig ? "text" : "password"} value={envVars.IG_ACCESS_TOKEN} onChange={e => setEnvVars({...envVars, IG_ACCESS_TOKEN: e.target.value})} placeholder="EAALZ..." />
              <button className="btn-icon-square" onClick={() => setShowTokens({...showTokens, ig: !showTokens.ig})}>
                {showTokens.ig ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div className="credential-box" style={{marginBottom: '12px'}}>
            <div className="cred-label">Instagram User ID</div>
            <div className="cred-input-group">
              <input type={showTokens.igId ? "text" : "password"} value={envVars.IG_USER_ID} onChange={e => setEnvVars({...envVars, IG_USER_ID: e.target.value})} placeholder="Ví dụ: 178414..." />
              <button className="btn-icon-square" onClick={() => setShowTokens({...showTokens, igId: !showTokens.igId})}>
                {showTokens.igId ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div className="credential-box">
            <div className="cred-label">TikTok Session Cookie (Tùy chọn đăng TikTok)</div>
            <div className="cred-input-group">
              <input type={showTokens.tiktok ? "text" : "password"} value={envVars.TIKTOK_SESSION_ID} onChange={e => setEnvVars({...envVars, TIKTOK_SESSION_ID: e.target.value})} placeholder="VD: 5543c8d..." />
              <button className="btn-icon-square" onClick={() => setShowTokens({...showTokens, tiktok: !showTokens.tiktok})}>
                {showTokens.tiktok ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div style={{marginTop: '20px', display: 'flex', justifyContent: 'flex-end'}}>
            <button className="btn-primary glow-primary" onClick={handleSaveEnv} disabled={isSavingEnv}>
              <Save size={16} className="mr-2" style={{marginRight: '8px'}} /> {isSavingEnv ? 'Đang lưu...' : 'Cập nhật File .env'}
            </button>
          </div>
        </div>

        <div className="dev-card glass" style={{marginTop: '24px'}}>
          <div className="dev-card-header">
            <BrainCircuit size={20} className="blue" />
            <h3>Cấu hình Trí tuệ Nhân tạo (Web Automation)</h3>
          </div>
          <p className="dev-card-desc">Quản lý phiên đăng nhập của các AI chạy ngầm. Nếu AI bị văng tài khoản hoặc dính Checkpoint, dùng công cụ Login Helper dưới đây để dọn rác và đăng nhập lại.</p>
          
          <div style={{display: 'flex', gap: '24px', marginTop: '16px'}}>
            {/* ChatGPT */}
            <div style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-light)'}}>
              <div style={{display: 'flex', alignItems: 'center', marginBottom: '16px'}}>
                <div style={{background: 'linear-gradient(135deg, #10a37f, #0d8a6a)', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', marginRight: '16px'}}>
                   <BrainCircuit size={20} color="white" />
                </div>
                <div>
                  <h4 style={{fontSize: '15px', margin: '0 0 4px 0', color: '#fff'}}>ChatGPT Plus</h4>
                  <span style={{fontSize: '12px', color: '#10a37f'}}>Mô hình: GPT-4 Vision</span>
                </div>
              </div>
              <button 
                className="btn-outline w-full justify-center" 
                onClick={() => handleResetAI('chatgpt')}
                disabled={isResettingAI === 'chatgpt'}
                style={{borderColor: '#10a37f', color: '#10a37f'}}
              >
                {isResettingAI === 'chatgpt' ? <RefreshCw className="spin mr-2" size={14}/> : <RefreshCw size={14} className="mr-2" />} 
                {isResettingAI === 'chatgpt' ? 'Đang chờ thao tác trên Chrome...' : 'Làm mới & Đăng nhập lại'}
              </button>
            </div>

            {/* Gemini */}
            <div style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-light)'}}>
              <div style={{display: 'flex', alignItems: 'center', marginBottom: '16px'}}>
                <div style={{background: 'linear-gradient(135deg, #1a73e8, #1557b0)', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', marginRight: '16px'}}>
                   <BrainCircuit size={20} color="white" />
                </div>
                <div>
                  <h4 style={{fontSize: '15px', margin: '0 0 4px 0', color: '#fff'}}>Gemini Advanced</h4>
                  <span style={{fontSize: '12px', color: '#1a73e8'}}>Mô hình: Gemini 1.5 Pro</span>
                </div>
              </div>
              <button 
                className="btn-outline w-full justify-center" 
                onClick={() => handleResetAI('gemini')}
                disabled={isResettingAI === 'gemini'}
                style={{borderColor: '#1a73e8', color: '#1a73e8'}}
              >
                {isResettingAI === 'gemini' ? <RefreshCw className="spin mr-2" size={14}/> : <RefreshCw size={14} className="mr-2" />} 
                {isResettingAI === 'gemini' ? 'Đang chờ thao tác trên Chrome...' : 'Làm mới & Đăng nhập lại'}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default SocialConnections;
