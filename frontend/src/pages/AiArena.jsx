import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const AiArena = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [persona, setPersona] = useState('');
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('Đang chờ...');
  const [currentConvId, setCurrentConvId] = useState(null);
  
  const messagesEndRef = useRef(null);

  useEffect(() => {
    // Check initial status
    axios.get('/api/arena/status').then(res => {
      setIsRunning(res.data.isRunning);
    });

    const eventSource = new EventSource('/api/arena/stream');
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'match_start') {
        setCurrentMatch(data.matchCount);
        setPersona(data.persona);
        setMessages([]);
        setStatus('Bắt đầu mô phỏng...');
      } else if (data.type === 'status') {
        setStatus(data.message);
      } else if (data.type === 'chat') {
        setMessages(prev => [...prev, { role: data.role, text: data.text }]);
        setCurrentConvId(data.conversationId);
      } else if (data.type === 'match_end') {
        setStatus(`Kết thúc trận ${data.matchCount}. Chờ lượt tiếp theo...`);
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleStart = async () => {
    try {
      await axios.post('/api/arena/start');
      setIsRunning(true);
    } catch(err) {
      alert('Lỗi khởi động: ' + err.message);
    }
  };

  const handleStop = async () => {
    try {
      await axios.post('/api/arena/stop');
      setIsRunning(false);
    } catch(err) {
      alert('Lỗi dừng: ' + err.message);
    }
  };

  const handleApprove = async () => {
    if (!currentConvId) return alert('Chưa có cuộc hội thoại nào để duyệt!');
    try {
      await axios.post(`/api/crm/conversations/${currentConvId}/approve`);
      alert('✅ Đã lưu cuộc hội thoại này vào Dataset (Approved)!');
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  };

  return (
    <div className="p-6 h-screen flex flex-col bg-gray-50">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            ⚔️ Đấu Trường AI <span className="text-sm font-normal text-gray-500">(Bot vs Bot Simulation)</span>
          </h1>
          <p className="text-gray-600 text-sm mt-1">Hệ thống sinh dữ liệu tự động cho việc Fine-tuning mô hình.</p>
        </div>
        <div className="flex gap-3">
          {isRunning ? (
            <button 
              onClick={handleStop} 
              style={{ backgroundColor: '#dc2626', color: 'white', padding: '8px 24px', borderRadius: '6px', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}
            >
              ⏹ Dừng Giả Lập
            </button>
          ) : (
            <button 
              onClick={handleStart} 
              style={{ backgroundColor: '#2563eb', color: 'white', padding: '8px 24px', borderRadius: '6px', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}
            >
              ▶ Bắt Đầu Giả Lập
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* Left Panel: Customer AI */}
        <div className="w-1/3 flex flex-col bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
          <div className="p-4 bg-gray-100 border-b border-gray-200">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">👤 Khách Hàng Ảo (Customer AI)</h2>
            <div className="mt-2 text-sm text-gray-600 bg-white p-3 rounded border border-gray-200 h-24 overflow-y-auto">
              <span className="font-semibold text-gray-700">Tính cách được cấp: </span> 
              {persona || 'Chưa bắt đầu...'}
            </div>
          </div>
          <div className="p-4 flex-1 flex flex-col justify-center items-center text-center text-gray-400">
            <div className="text-4xl mb-4">🎭</div>
            <p className="text-sm">Đóng giả khách hàng thực tế với muôn vàn tình huống ngẫu nhiên.</p>
          </div>
        </div>

        {/* Center Panel: Chat Arena */}
        <div className="w-1/3 flex flex-col bg-white rounded-xl shadow border border-gray-200 overflow-hidden relative">
          <div className="p-4 bg-blue-50 border-b border-blue-100 flex justify-between items-center">
            <h2 className="font-bold text-blue-900">💬 Đấu Trường (Trận #{currentMatch})</h2>
            <span className="text-xs px-2 py-1 bg-white border border-blue-200 rounded text-blue-700 animate-pulse">
              {status}
            </span>
          </div>
          
          <div className="flex-1 p-4 overflow-y-auto bg-gray-50 flex flex-col gap-4">
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-gray-400 italic text-sm">
                Đang chờ 2 AI giao tiếp...
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'customer' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                  msg.role === 'customer' 
                    ? 'bg-white border border-gray-200 text-gray-800 rounded-bl-none shadow-sm' 
                    : 'bg-blue-600 text-white rounded-br-none shadow-sm'
                }`}>
                  <p className="text-[10px] uppercase font-bold mb-1 opacity-60">
                    {msg.role === 'customer' ? 'Khách Hàng' : 'Bot Bán Hàng'}
                  </p>
                  <div className="text-sm whitespace-pre-wrap">
                    {msg.text.split(/!\[.*?\]\((.*?)\)/g).map((part, i) => 
                      i % 2 === 1 ? (
                        <img key={i} src={part} alt="Product" className="mt-2 rounded-lg max-w-full h-auto max-h-48 object-cover" />
                      ) : (
                        <span key={i}>{part}</span>
                      )
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Action Bar */}
          <div className="p-4 bg-white border-t border-gray-200">
            <button 
              onClick={handleApprove}
              disabled={messages.length === 0}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: messages.length === 0 ? '#d1d5db' : '#22c55e',
                color: messages.length === 0 ? '#6b7280' : 'white',
                borderRadius: '6px',
                fontWeight: 'bold',
                border: 'none',
                cursor: messages.length === 0 ? 'not-allowed' : 'pointer'
              }}
            >
              ⭐ Duyệt Hội Thoại Này (Approve)
            </button>
            <p className="text-xs text-center text-gray-400 mt-2">Duyệt nếu bạn thấy Bot xử lý tình huống này quá hay.</p>
          </div>
        </div>

        {/* Right Panel: Bot AI */}
        <div className="w-1/3 flex flex-col bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
          <div className="p-4 bg-gray-100 border-b border-gray-200">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">🤖 Bot Bán Hàng (Sale AI)</h2>
            <div className="mt-2 text-sm text-gray-600 bg-white p-3 rounded border border-gray-200 h-24 overflow-y-auto">
              <span className="font-semibold text-gray-700">Trạng thái: </span> 
              Đang sử dụng hệ thống RAG + Vector DB hiện tại để xử lý tình huống Khách hàng đưa ra.
            </div>
          </div>
          <div className="p-4 flex-1 flex flex-col justify-center items-center text-center text-gray-400">
            <div className="text-4xl mb-4">🧠</div>
            <p className="text-sm">Học cách ứng xử từ dữ liệu cũ và cố gắng chốt đơn trong mọi hoàn cảnh.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiArena;
