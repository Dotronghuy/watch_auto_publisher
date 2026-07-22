import { useState, useEffect, useRef } from 'react';
import { Play, Square, Settings, Link as LinkIcon, Circle } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

async function readApiResponse(response) {
  const body = await response.text();
  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    return { message: body };
  }
}

function getApiError(data, fallback) {
  return data?.message || data?.error || fallback;
}

export default function AutoFillSheet() {
  const [sheetUrl, setSheetUrl] = useState(() => localStorage.getItem('autofill_sheetUrl') || '');
  const [status, setStatus] = useState('idle');
  const [logs, setLogs] = useState([]);
  const [backendOnline, setBackendOnline] = useState(null);
  // Hide Excel upload to match exact mockup design
  const [aiTone, setAiTone] = useState(() => localStorage.getItem('autofill_aiTone') || 'Thu hút (Engaging)');
  const logEndRef = useRef(null);
  const runWasActiveRef = useRef(false);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/autofill/status');
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(getApiError(data, 'Backend không phản hồi'));

        setBackendOnline(true);
        setStatus(data.isRunning ? 'running' : 'idle');
        runWasActiveRef.current = Boolean(data.isRunning);
      } catch (err) {
        setBackendOnline(false);
        setStatus('idle');
        console.warn('Không thể kết nối Backend:', err.message);
      }
    };

    checkStatus();
    
    const eventSource = new EventSource('/api/autofill/log-stream');
    eventSource.onopen = () => setBackendOnline(true);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.msg) {
        setLogs(prev => [...prev, { time: data.time, msg: data.msg }]);
      }
      if (data.status) {
        if (data.status === 'running') {
          runWasActiveRef.current = true;
        } else if (data.status === 'idle' && runWasActiveRef.current) {
          setLogs(prev => [...prev, {
            time: new Date().toLocaleTimeString('vi-VN'),
            msg: '[System] ⚠️ Backend vừa khởi động lại nên tiến trình trước đã bị ngắt. Các dòng đã lưu vẫn được giữ; bấm Bắt đầu để chạy tiếp.'
          }]);
          runWasActiveRef.current = false;
        } else if (data.status === 'done') {
          runWasActiveRef.current = false;
        }
        setStatus(data.status);
      }
    };
    eventSource.onerror = () => setBackendOnline(false);
    return () => eventSource.close();
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const startAutoFill = async () => {
    if (!sheetUrl) return alert('Vui lòng nhập đường dẫn Google Sheet!');

    setLogs([]);
    try {
      // Luôn kiểm tra lại để phân biệt Backend offline với lỗi Playwright thật.
      const statusRes = await fetch('/api/autofill/status');
      const backendStatus = await readApiResponse(statusRes);
      if (!statusRes.ok) {
        throw new Error(getApiError(backendStatus, 'Backend đang tắt hoặc đang khởi động lại'));
      }

      setBackendOnline(true);
      if (!backendStatus.hasCredentials) {
        throw new Error('Chưa có credentials.json để đọc/ghi Google Sheet. Vui lòng cấu hình ở Backend!');
      }

      const res = await fetch('/api/autofill/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl, aiTone })
      });
      const data = await readApiResponse(res);
      if (!res.ok || !data.success) {
        throw new Error(getApiError(data, 'Backend từ chối khởi động tiến trình'));
      }
      runWasActiveRef.current = true;
      setStatus('running');
    } catch (err) {
      const isNetworkError = err instanceof TypeError || /failed to fetch|networkerror/i.test(err.message);
      if (isNetworkError) setBackendOnline(false);
      const message = isNetworkError
        ? 'Không kết nối được Backend. Hãy mở lại hệ thống và giữ cửa sổ chạy tool.'
        : err.message;
      alert('Lỗi khi bắt đầu: ' + message);
    }
  };

  const stopAutoFill = async () => {
    try {
      const res = await fetch('/api/autofill/stop', { method: 'POST' });
      const data = await readApiResponse(res);
      if (!res.ok) throw new Error(getApiError(data, 'Không thể dừng tiến trình'));

      if (!data.success) {
        runWasActiveRef.current = false;
        setStatus('idle');
        setLogs(prev => [...prev, {
          time: new Date().toLocaleTimeString('vi-VN'),
          msg: `[System] ${getApiError(data, 'Tool không còn chạy.')}`
        }]);
      }
    } catch (err) {
      alert('Lỗi khi dừng: ' + err.message);
    }
  };

  return (
    <div className="p-8 w-full flex flex-col gap-8 font-sans text-white bg-transparent min-h-[calc(100vh-60px)]">
      
      {/* HEADER SECTION */}
      <div className="mb-2">
        <h1 className="text-[26px] font-bold flex items-center gap-3">
          <span>Tool Cào Dữ liệu (Playwright + ChatGPT)</span>
          <span 
            className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(255,77,141,0.15)', color: '#FF4D8D' }}
          >
            NO AI API
          </span>
        </h1>
        <p className="mt-2 text-[13px]" style={{ color: '#94A3B8' }}>
          Playwright cào thông số sản phẩm và điều khiển ChatGPT để sinh content, không tiêu tốn API AI.
        </p>
      </div>

      {/* CONFIGURATION CARD */}
      <div className="rounded-xl flex flex-col" style={{ backgroundColor: '#161821', border: '1px solid #2D3349' }}>
        <div className="flex items-center gap-2 p-5 border-b" style={{ borderColor: '#2D3349' }}>
          <Settings className="w-5 h-5" style={{ color: '#FF4D8D' }} />
          <h2 className="text-[15px] font-bold text-white tracking-wide">Cấu hình Hệ thống (Configuration Parameters)</h2>
        </div>

        <div className="p-6 flex flex-col gap-6">
          {backendOnline === false && (
            <div className="rounded-lg px-4 py-3 text-[12px] leading-5" style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)', color: '#FCA5A5' }}>
              Backend đang OFFLINE. Hãy mở lại hệ thống và giữ cửa sổ chạy tool, sau đó bấm Bắt đầu lại.
            </div>
          )}
          <div className="rounded-lg px-4 py-3 text-[12px] leading-5" style={{ backgroundColor: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', color: '#86EFAC' }}>
            Engine an toàn: dùng một phiên Playwright cho toàn bộ danh sách, giữ nguyên ô Sheet đã có dữ liệu và chỉ điền thông số còn trống. Credentials Google chỉ dùng để đọc/ghi Sheet.
          </div>

          {/* Row 1: URL */}
          <div>
            <label className="block text-[11px] font-bold mb-2" style={{ color: '#e2e8f0' }}>Đường dẫn Google Sheet (URL)</label>
            <div 
              className="flex items-center gap-3 rounded-lg px-4 py-3 transition-colors" 
              style={{ backgroundColor: '#0B0F19', border: '1px solid #2D3349' }}
              onFocusCapture={(e) => e.currentTarget.style.borderColor = '#FF4D8D'}
              onBlurCapture={(e) => e.currentTarget.style.borderColor = '#2D3349'}
            >
              <LinkIcon className="h-4 w-4 shrink-0" style={{ color: '#94A3B8' }} />
              <input
                type="text"
                className="w-full text-[13px] bg-transparent focus:outline-none font-mono"
                style={{ color: '#e2e8f0' }}
                placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs..."
                value={sheetUrl}
                onChange={(e) => {
                  setSheetUrl(e.target.value);
                  localStorage.setItem('autofill_sheetUrl', e.target.value);
                }}
                disabled={status === 'running'}
              />
            </div>
          </div>

          {/* Row 2: AI Tone Only */}
          <div className="mt-2">
            <label className="block text-[11px] font-bold mb-2" style={{ color: '#e2e8f0' }}>Giọng điệu ChatGPT (Generation Tone)</label>
            <div className="flex flex-wrap gap-3 mt-1.5 p-3 rounded-lg border border-dashed" style={{ backgroundColor: '#0B0F19', borderColor: '#2D3349' }}>
              {['Chuyên nghiệp', 'Thu hút (Engaging)', 'Kỹ thuật', 'Thuyết phục'].map((tone) => (
                <button
                  key={tone}
                  onClick={() => {
                    setAiTone(tone);
                    localStorage.setItem('autofill_aiTone', tone);
                  }}
                  disabled={status === 'running'}
                  className="px-5 py-2 rounded-lg text-[12px] font-bold transition-all border"
                  style={{
                    backgroundColor: aiTone === tone ? 'rgba(255,77,141,0.1)' : 'transparent',
                    color: aiTone === tone ? '#FF4D8D' : '#94A3B8',
                    borderColor: aiTone === tone ? '#FF4D8D' : '#2D3349'
                  }}
                  onMouseEnter={(e) => { if (aiTone !== tone) e.currentTarget.style.borderColor = '#515C67'; }}
                  onMouseLeave={(e) => { if (aiTone !== tone) e.currentTarget.style.borderColor = '#2D3349'; }}
                >
                  {tone}
                </button>
              ))}
            </div>
          </div>

          {/* Row 3: Big Button */}
          <div className="mt-4">
            {status !== 'running' || backendOnline === false ? (
              <button
                onClick={startAutoFill}
                className="w-full font-bold py-4 rounded-lg flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.99] transition-all tracking-wider text-[13px]"
                style={{ background: 'linear-gradient(to right, #FF4D8D, #FF2A6D)', color: '#FFFFFF', border: 'none' }}
              >
                <Play className="w-4 h-4 fill-current" />
                BẮT ĐẦU PLAYWRIGHT (START PROCESS)
              </button>
            ) : (
              <button
                onClick={stopAutoFill}
                className="w-full font-bold py-4 rounded-lg flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.99] transition-all tracking-wider text-[13px]"
                style={{ backgroundColor: '#EF4444', color: '#FFFFFF', border: 'none' }}
              >
                <Square className="w-4 h-4 fill-current" />
                DỪNG HỆ THỐNG (STOP EXECUTION)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* TERMINAL SECTION */}
      <div className="rounded-xl border overflow-hidden flex flex-col h-[280px] mt-2" style={{ backgroundColor: '#0A0A0B', borderColor: '#2D3349' }}>
        <div className="px-4 py-2.5 flex items-center justify-between border-b" style={{ backgroundColor: '#161821', borderColor: '#2D3349' }}>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#FF5F56' }}></div>
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#FFBD2E' }}></div>
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#27C93F' }}></div>
          </div>
          <div className="text-[11px] font-mono" style={{ color: '#94A3B8' }}>terminal_output.log</div>
          <div className="flex items-center gap-1.5">
            <Circle
              className={cn("w-1.5 h-1.5 fill-current", status === 'running' ? "animate-pulse" : "")}
              style={{ color: backendOnline === false ? '#EF4444' : '#22C55E' }}
            />
            <span className="text-[10px] font-mono tracking-widest font-bold" style={{ color: backendOnline === false ? '#EF4444' : '#22C55E' }}>
              {backendOnline === false ? 'OFFLINE' : status === 'running' ? 'RUNNING' : 'READY'}
            </span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto font-mono text-[13px] p-5 custom-scrollbar" style={{ color: '#22C55E', backgroundColor: '#0A0A0B' }}>
          {logs.length === 0 ? (
            <div className="flex flex-col gap-2 opacity-90">
              <div>&gt; System initialized. Awaiting commands...</div>
              <div>&gt; Playwright + ChatGPT engine ready (AI API disabled)...</div>
              <div className="mt-1 animate-pulse">&gt; _</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 opacity-90">
              {logs.map((log, i) => (
                <div key={i} className="break-words">
                  <span className="mr-2">&gt;</span>{log.msg}
                </div>
              ))}
              <div className="animate-pulse">&gt; _</div>
            </div>
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
