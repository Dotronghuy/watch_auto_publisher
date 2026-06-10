import React, { useState, useEffect, useRef } from 'react';
import { Send, RefreshCw, MessageCircle, MessageSquare } from 'lucide-react';
import { Facebook, Instagram } from '../components/SocialIcons';
import Swal from 'sweetalert2';
import './InboxCRM.css';

const InboxCRM = () => {
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    if (activeConv) {
      fetchMessages(activeConv.id);
    }
  }, [activeConv]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/crm/conversations');
      const data = await res.json();
      setConversations(data);
    } catch (e) {
      console.error('Lỗi fetch conversations', e);
    }
  };

  const fetchMessages = async (convId) => {
    try {
      const res = await fetch(`/api/crm/conversations/${convId}/messages`);
      const data = await res.json();
      setMessages(data);
    } catch (e) {
      console.error('Lỗi fetch messages', e);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/crm/sync', { method: 'POST' });
      if (res.ok) {
        await fetchConversations();
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: 'Đồng bộ hoàn tất',
          showConfirmButton: false,
          timer: 2000
        });
      }
    } catch (e) {
      Swal.fire('Lỗi', 'Không thể đồng bộ', 'error');
    }
    setIsSyncing(false);
  };

  const handleSend = async () => {
    if (!replyText.trim() || !activeConv) return;
    setIsSending(true);
    
    // Optimistic UI update
    const tempMsg = {
      id: 'temp_' + Date.now(),
      message: replyText,
      is_from_page: 1,
      created_time: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempMsg]);
    setReplyText('');

    try {
      const targetId = activeConv.type === 'comment' ? (messages[messages.length-1]?.id || activeConv.sender_id) : activeConv.id;
      
      const res = await fetch('/api/crm/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConv.id,
          targetId: targetId,
          message: tempMsg.message,
          type: activeConv.type
        })
      });
      
      if (!res.ok) throw new Error('Failed to send');
      
      // Re-fetch to get actual ID
      fetchMessages(activeConv.id);
    } catch (e) {
      console.error(e);
      Swal.fire('Lỗi', 'Không thể gửi tin nhắn', 'error');
      // Rollback optimistic update if needed
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
    }
    setIsSending(false);
  };

  const formatTime = (isoString) => {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  };

  return (
    <div className="inbox-crm">
      {/* Sidebar - Conversation List */}
      <div className="inbox-sidebar">
        <div className="inbox-header">
          <h2>Hộp thư ({conversations.length})</h2>
          <button className="btn-outline" onClick={handleSync} disabled={isSyncing} style={{padding: '6px 12px', fontSize: '12px'}}>
            <RefreshCw size={14} className={isSyncing ? 'spin' : ''} style={{marginRight: '4px'}} /> Đồng bộ
          </button>
        </div>
        <div className="conversations-list">
          {conversations.length === 0 ? (
            <div style={{padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)'}}>
              Chưa có dữ liệu. Hãy bấm Đồng bộ.
            </div>
          ) : (
            conversations.map(conv => (
              <div 
                key={conv.id} 
                className={`conversation-item ${activeConv?.id === conv.id ? 'active' : ''}`}
                onClick={() => setActiveConv(conv)}
              >
                <div className="avatar-wrapper">
                  {conv.sender_name ? conv.sender_name.charAt(0).toUpperCase() : '?'}
                  <div className="platform-icon-small">
                    {conv.platform === 'facebook' ? <Facebook size={12} /> : <Instagram size={12} />}
                  </div>
                </div>
                <div className="conversation-info">
                  <div className="conversation-name">
                    {conv.sender_name} 
                    {conv.type === 'comment' ? <MessageSquare size={12} style={{marginLeft: '4px', color: '#ff4d8d'}} /> : <MessageCircle size={12} style={{marginLeft: '4px', color: '#4285f4'}} />}
                  </div>
                  <div className="conversation-snippet">{conv.snippet}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="inbox-main">
        {activeConv ? (
          <>
            <div className="chat-header">
              <div className="avatar-wrapper">
                {activeConv.sender_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 style={{margin: 0, fontSize: '16px'}}>{activeConv.sender_name}</h3>
                <span style={{fontSize: '12px', color: 'var(--color-text-muted)'}}>
                  {activeConv.platform === 'facebook' ? 'Facebook' : 'Instagram'} • {activeConv.type === 'inbox' ? 'Tin nhắn' : 'Bình luận'}
                </span>
              </div>
            </div>

            <div className="chat-messages">
              {messages.map(msg => (
                <div key={msg.id} className={`message-bubble ${msg.is_from_page ? 'from-page' : 'from-customer'}`}>
                  {msg.message}
                  <span className="message-time">{formatTime(msg.created_time)}</span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-area">
              <input 
                type="text" 
                placeholder="Nhập tin nhắn trả lời..." 
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
              />
              <button className="btn-send" onClick={handleSend} disabled={!replyText.trim() || isSending}>
                <Send size={18} />
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <MessageCircle size={48} style={{opacity: 0.2, marginBottom: '20px'}} />
            <h3>Chọn một đoạn hội thoại để bắt đầu</h3>
          </div>
        )}
      </div>
    </div>
  );
};

export default InboxCRM;
