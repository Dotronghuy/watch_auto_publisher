import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, RefreshCw, MessageCircle, MessageSquare, Search, 
  Filter, Phone, Video, MoreVertical, Plus, Smile, 
  Mail, Link as LinkIcon, Crown, Paperclip, CheckCheck, X,
  ChevronLeft, ChevronRight, MapPin
} from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [prevLastMsgId, setPrevLastMsgId] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [filterType, setFilterType] = useState('inbox'); // 'inbox' | 'comment'
  const [lightboxIndex, setLightboxIndex] = useState(-1); // -1 = đóng
  const [customerProfile, setCustomerProfile] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [newNote, setNewNote] = useState('');
  const [editingField, setEditingField] = useState(null); // 'address' | 'phone' | 'lead_score'
  const [editValue, setEditValue] = useState('');
  const [filterTag, setFilterTag] = useState(null); // null = tất cả, string = filter theo tag
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [filterAccount, setFilterAccount] = useState(null); // null = tất cả, string = account_id
  const [showAccountFilter, setShowAccountFilter] = useState(false);
  const [customerTagsMap, setCustomerTagsMap] = useState({}); // { senderId: [tags] }

  const predefinedTags = ['Khách mới', 'Đã đặt', 'Bảo hành', 'Quan tâm', 'Khách buôn', 'Khách VIP'];
  
  const TAG_COLORS = {
    'Khách mới': '#3b82f6',    // Xanh dương
    'Đã đặt': '#10b981',       // Xanh lá
    'Bảo hành': '#f59e0b',     // Vàng cam
    'Quan tâm': '#8b5cf6',     // Tím
    'Khách buôn': '#ec4899',   // Hồng
    'Khách VIP': '#ef4444',    // Đỏ
  };

  const getTagColor = (tag) => TAG_COLORS[tag] || '#6b7280';
  const chatMessagesRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const activeConvRef = useRef(activeConv);
  
  // Keep ref in sync so SSE callback can read latest activeConv
  useEffect(() => { activeConvRef.current = activeConv; }, [activeConv]);

  useEffect(() => {
    fetchConversations();
    fetchAccounts();

    // SSE: Kết nối realtime stream
    const eventSource = new EventSource('/api/crm/stream');
    
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        
        if (payload.type === 'conversations_updated') {
          // Server đã sync xong, cập nhật danh sách hội thoại ngay lập tức
          setConversations(payload.data);
        }
        
        if (payload.type === 'new_message') {
          // Có tin nhắn mới → refresh messages nếu đang xem đúng conversation đó
          const current = activeConvRef.current;
          if (current && current.id === payload.data.conversationId) {
            fetchMessages(current.id);
          }
          // Cũng refresh danh sách conversations để cập nhật snippet
          fetchConversations();
        }
      } catch (e) {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => {
      // Reconnect tự động bởi browser, ko cần xử lý
    };

    // Background auto-sync: gọi sync API mỗi 30 giây để backend fetch data mới từ FB/IG
    const syncInterval = setInterval(async () => {
      try { await fetch('/api/crm/sync', { method: 'POST' }); } catch(e) {}
    }, 30000);

    // Trigger sync lần đầu
    fetch('/api/crm/sync', { method: 'POST' }).catch(() => {});

    return () => {
      eventSource.close();
      clearInterval(syncInterval);
    };
  }, []);

  // Fetch tags for all conversations to display in sidebar
  useEffect(() => {
    const fetchAllTags = async () => {
      const tagsMap = {};
      for (const conv of conversations) {
        if (!conv.sender_id || customerTagsMap[conv.sender_id]) continue;
        try {
          const res = await fetch(`/api/crm/customers/${encodeURIComponent(conv.sender_id)}`);
          const data = await res.json();
          let tags = [];
          try { tags = typeof data.tags === 'string' ? JSON.parse(data.tags) : (data.tags || []); } catch(e) {}
          tagsMap[conv.sender_id] = tags;
        } catch(e) { tagsMap[conv.sender_id] = []; }
      }
      if (Object.keys(tagsMap).length > 0) {
        setCustomerTagsMap(prev => ({ ...prev, ...tagsMap }));
      }
    };
    if (conversations.length > 0) fetchAllTags();
  }, [conversations]);

  // Handle clicking outside to close emoji picker
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (activeConv) {
      fetchMessages(activeConv.id);
      
      // Fetch Customer Profile
      fetch(`/api/crm/customers/${encodeURIComponent(activeConv.sender_id)}`)
        .then(res => res.json())
        .then(data => {
          try { data.tags = typeof data.tags === 'string' ? JSON.parse(data.tags) : []; } catch(e) { data.tags = []; }
          try { data.notes = typeof data.notes === 'string' ? JSON.parse(data.notes) : []; } catch(e) { data.notes = []; }
          setCustomerProfile(data);
        })
        .catch(err => console.error('Lỗi lấy profile:', err));
    }
  }, [activeConv]);

  // Auto extract phone from messages if missing
  useEffect(() => {
    if (messages.length > 0 && customerProfile && !customerProfile.phone) {
      const phoneRegex = /(0[3|5|7|8|9])+([0-9]{8})\b/;
      for (const msg of messages) {
        if (!msg.is_from_page && msg.message) {
          const match = msg.message.match(phoneRegex);
          if (match) {
            handleUpdateProfile({ phone: match[0] });
            break;
          }
        }
      }
    }
  }, [messages, customerProfile]);

  // Profile update helpers
  const handleUpdateProfile = async (updates) => {
    if (!customerProfile || !activeConv) return;
    
    // Optimistic update
    setCustomerProfile(prev => ({ ...prev, ...updates }));

    // Prepare payload
    const payload = {};
    for (const [k, v] of Object.entries(updates)) {
      payload[k] = (k === 'tags' || k === 'notes') ? JSON.stringify(v) : v;
    }

    try {
      await fetch(`/api/crm/customers/${encodeURIComponent(activeConv.sender_id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch(e) {
      console.error('Lỗi lưu profile', e);
    }
  };

  const addTag = (e) => {
    if (e.key === 'Enter' && newTag.trim()) {
      const tags = [...(customerProfile?.tags || []), newTag.trim()];
      handleUpdateProfile({ tags });
      if (activeConv) setCustomerTagsMap(prev => ({ ...prev, [activeConv.sender_id]: tags }));
      setNewTag('');
    }
  };

  const removeTag = (indexToRemove) => {
    const tags = customerProfile.tags.filter((_, i) => i !== indexToRemove);
    handleUpdateProfile({ tags });
    // Also update local tags map
    if (activeConv) {
      setCustomerTagsMap(prev => ({ ...prev, [activeConv.sender_id]: tags }));
    }
  };

  const addNote = () => {
    if (newNote.trim()) {
      const noteObj = {
        text: newNote.trim(),
        date: new Date().toISOString()
      };
      const notes = [noteObj, ...(customerProfile?.notes || [])]; // newest first
      handleUpdateProfile({ notes });
      setNewNote('');
    }
  };

  const saveEditingField = () => {
    if (editingField) {
      handleUpdateProfile({ [editingField]: editValue });
      setEditingField(null);
    }
  };


  // Chọn conversation + đánh dấu đã đọc
  const handleSelectConv = async (conv) => {
    setActiveConv(conv);
    if (conv.needs_reply) {
      // Đánh dấu đã đọc + gửi mark_seen cho FB/IG
      try {
        await fetch(`/api/crm/conversations/${encodeURIComponent(conv.id)}/read`, { method: 'POST' });
        // Cập nhật local state ngay lập tức
        setConversations(prev => prev.map(c => 
          c.id === conv.id ? { ...c, needs_reply: 0, is_read: 1 } : c
        ));
      } catch (e) {
        console.error('Lỗi đánh dấu đã đọc:', e);
      }
    }
  };

  // Đánh dấu đã đọc tất cả
  const handleMarkAllRead = async () => {
    const unreadConvs = conversations.filter(c => c.needs_reply);
    if (unreadConvs.length === 0) return;
    try {
      await Promise.all(
        unreadConvs.map(c => 
          fetch(`/api/crm/conversations/${encodeURIComponent(c.id)}/read`, { method: 'POST' })
        )
      );
      setConversations(prev => prev.map(c => ({ ...c, needs_reply: 0, is_read: 1 })));
    } catch (e) {
      console.error('Lỗi đánh dấu tất cả đã đọc:', e);
    }
  };

  useEffect(() => {
    if (messages.length > 0) {
      const currentLastId = messages[messages.length - 1].id;
      if (currentLastId !== prevLastMsgId) {
        scrollToBottom();
        setPrevLastMsgId(currentLastId);
      }
    } else if (messages.length === 0 && prevLastMsgId !== null) {
      setPrevLastMsgId(null);
    }
  }, [messages]);

  // Lấy tất cả ảnh từ messages hiện tại
  const allImages = messages.reduce((acc, msg) => {
    if (!msg.message) return acc;
    const matches = msg.message.match(/\[IMAGE: (.*?)\]/g);
    if (matches) {
      matches.forEach(m => {
        const url = m.replace('[IMAGE: ', '').slice(0, -1);
        acc.push(url);
      });
    }
    return acc;
  }, []);

  // Keyboard: ESC đóng, Left/Right chuyển ảnh
  useEffect(() => {
    const handleKey = (e) => {
      if (lightboxIndex < 0) return;
      if (e.key === 'Escape') setLightboxIndex(-1);
      else if (e.key === 'ArrowLeft') setLightboxIndex(i => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setLightboxIndex(i => Math.min(allImages.length - 1, i + 1));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxIndex, allImages.length]);

  const openLightbox = (url) => {
    const idx = allImages.indexOf(url);
    setLightboxIndex(idx >= 0 ? idx : 0);
  };

  const scrollToBottom = () => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  };

  const renderMessageText = (text) => {
    if (!text) return null;
    const parts = text.split(/(\[IMAGE: .*?\]|\[VIDEO: .*?\]|\[FILE: .*?\])/g);
    return parts.map((part, index) => {
      if (part.startsWith('[IMAGE: ')) {
        const url = part.replace('[IMAGE: ', '').slice(0, -1);
        return (
          <div key={index} style={{marginTop: '5px'}}>
            <img 
              src={url} 
              alt="Attachment" 
              className="chat-image-clickable"
              onClick={() => openLightbox(url)}
            />
          </div>
        );
      } else if (part.startsWith('[VIDEO: ')) {
        const url = part.replace('[VIDEO: ', '').slice(0, -1);
        return (
          <div key={index} style={{marginTop: '5px'}}>
            <video src={url} controls style={{maxWidth: '250px', maxHeight: '300px', objectFit: 'contain', borderRadius: '8px'}} />
          </div>
        );
      } else if (part.startsWith('[FILE: ')) {
        const url = part.replace('[FILE: ', '').slice(0, -1);
        return (
          <div key={index} style={{marginTop: '5px'}}>
            <a href={url} target="_blank" rel="noreferrer" style={{color: '#4ade80', textDecoration: 'underline'}}>
              📎 Tệp đính kèm
            </a>
          </div>
        );
      }
      return <span key={index} style={{whiteSpace: 'pre-wrap'}}>{part}</span>;
    });
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

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      setAccounts(data);
    } catch (e) {
      console.error('Lỗi fetch accounts', e);
    }
  };

  const getAccountName = (accountId) => {
    const acc = accounts.find(a => a.id === accountId);
    return acc ? acc.name : 'Unknown Page';
  };

  const getAccountPageId = (accountId) => {
    const acc = accounts.find(a => a.id === accountId);
    return acc ? acc.fbPageId?.trim() : null;
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
      const targetId = activeConv.type === 'comment' ? (messages[messages.length-1]?.id || activeConv.sender_id) : activeConv.sender_id;
      
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

  // Hàm tính toán thời gian giả lập (1h ago, 2m ago)
  const timeAgo = (isoString) => {
    const now = new Date();
    const d = new Date(isoString);
    const diff = Math.floor((now - d) / 1000 / 60); // phút
    if (diff < 60) return `${diff}m ago`;
    const hours = Math.floor(diff / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <>
    <div className="inbox-crm">
      {/* =======================
          PANE 1: SIDEBAR (CONVERSATIONS)
          ======================= */}
      <div className="inbox-sidebar">
        <div className="inbox-header">
          <h2>Inbox</h2>
          <div style={{display: 'flex', gap: '15px'}}>
            <div className="inbox-header-actions" onClick={handleSync} style={{ cursor: isSyncing ? 'wait' : 'pointer' }} title="Đồng bộ thủ công">
              <RefreshCw size={18} className={isSyncing ? 'spin' : ''} />
            </div>
            <div 
              className="inbox-header-actions" 
              title="Đánh dấu tất cả đã đọc" 
              onClick={handleMarkAllRead}
              style={{ cursor: 'pointer' }}
            >
              <CheckCheck size={18} />
            </div>
          </div>
        </div>

        <div className="search-container">
          <Search size={16} className="search-icon" />
          <input 
            type="text" 
            placeholder="Search conversations..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Filter Tabs: Tin nhắn / Bình luận */}
        <div className="inbox-filter-tabs">
          <button className={`filter-tab ${filterType === 'inbox' ? 'active' : ''}`} onClick={() => setFilterType('inbox')}>
            <Mail size={14} /> Tin nhắn
            {conversations.filter(c => c.type === 'inbox' && c.needs_reply).length > 0 && (
              <span className="unreplied-badge">{conversations.filter(c => c.type === 'inbox' && c.needs_reply).length}</span>
            )}
          </button>
          <button className={`filter-tab ${filterType === 'comment' ? 'active' : ''}`} onClick={() => setFilterType('comment')}>
            <MessageSquare size={14} /> Bình luận
            {conversations.filter(c => c.type === 'comment' && c.needs_reply).length > 0 && (
              <span className="unreplied-badge">{conversations.filter(c => c.type === 'comment' && c.needs_reply).length}</span>
            )}
          </button>
        </div>

        {/* Account Filter Dropdown */}
        {accounts.length > 1 && (
          <div style={{ position: 'relative', padding: '0 12px', marginBottom: '8px' }}>
            <button 
              onClick={() => { setShowAccountFilter(!showAccountFilter); setShowTagFilter(false); }}
              style={{ 
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: filterAccount ? '#6366f122' : '#2b2d31', 
                border: filterAccount ? '1px solid #818cf8' : '1px solid #3f4147', 
                color: filterAccount ? '#a5b4fc' : '#8a8b91', 
                padding: '6px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {filterAccount ? (() => {
                  const acc = accounts.find(a => a.id === filterAccount);
                  return acc ? (
                    <>
                      {acc.fbPageId?.trim() ? (
                        <img
                          src={`https://graph.facebook.com/v21.0/${acc.fbPageId.trim()}/picture?type=small`}
                          alt=""
                          style={{ width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover' }}
                        />
                      ) : (
                        <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#fff' }}>
                          {acc.name.charAt(0)}
                        </span>
                      )}
                      {acc.name}
                    </>
                  ) : 'Tất cả tài khoản';
                })() : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    Tất cả tài khoản
                  </>
                )}
              </span>
              {filterAccount ? (
                <span onClick={(e) => { e.stopPropagation(); setFilterAccount(null); setShowAccountFilter(false); }} style={{ cursor: 'pointer', color: '#ff4d8d' }}>✕</span>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              )}
            </button>
            {showAccountFilter && (
              <div style={{ 
                position: 'absolute', top: '100%', left: '12px', right: '12px', zIndex: 50, 
                background: '#1e1f23', border: '1px solid #3f4147', borderRadius: '8px', 
                padding: '6px 0', marginTop: '4px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
              }}>
                <div 
                  onClick={() => { setFilterAccount(null); setShowAccountFilter(false); }}
                  style={{ padding: '8px 14px', cursor: 'pointer', fontSize: '12px', color: !filterAccount ? '#a5b4fc' : '#fff', fontWeight: !filterAccount ? 600 : 400, display: 'flex', alignItems: 'center', gap: '10px' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#2b2d31'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#3f4147', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8a8b91" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  </span>
                  Tất cả tài khoản
                </div>
                {accounts.filter(a => a.isActive).map(acc => (
                  <div 
                    key={acc.id}
                    onClick={() => { setFilterAccount(acc.id); setShowAccountFilter(false); }}
                    style={{ 
                      padding: '8px 14px', cursor: 'pointer', fontSize: '12px', 
                      color: filterAccount === acc.id ? '#a5b4fc' : '#ccc',
                      fontWeight: filterAccount === acc.id ? 600 : 400,
                      display: 'flex', alignItems: 'center', gap: '10px'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#2b2d31'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {acc.fbPageId?.trim() ? (
                      <img
                        src={`https://graph.facebook.com/v21.0/${acc.fbPageId.trim()}/picture?type=small`}
                        alt=""
                        style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                    ) : (
                      <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#fff' }}>
                        {acc.name.charAt(0)}
                      </span>
                    )}
                    {acc.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tag Filter Dropdown */}
        <div style={{ position: 'relative', padding: '0 12px', marginBottom: '8px' }}>
          <button 
            onClick={() => { setShowTagFilter(!showTagFilter); setShowAccountFilter(false); }}
            style={{ 
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: filterTag ? getTagColor(filterTag) + '22' : '#2b2d31', 
              border: filterTag ? `1px solid ${getTagColor(filterTag)}` : '1px solid #3f4147', 
              color: filterTag ? getTagColor(filterTag) : '#8a8b91', 
              padding: '6px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Filter size={13} />
              {filterTag ? `🏷 ${filterTag}` : 'Phân loại'}
            </span>
            {filterTag && (
              <span onClick={(e) => { e.stopPropagation(); setFilterTag(null); setShowTagFilter(false); }} style={{ cursor: 'pointer', color: '#ff4d8d' }}>✕</span>
            )}
          </button>
          {showTagFilter && (
            <div style={{ 
              position: 'absolute', top: '100%', left: '12px', right: '12px', zIndex: 50, 
              background: '#1e1f23', border: '1px solid #3f4147', borderRadius: '8px', 
              padding: '6px 0', marginTop: '4px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
            }}>
              <div 
                onClick={() => { setFilterTag(null); setShowTagFilter(false); }}
                style={{ padding: '8px 14px', cursor: 'pointer', fontSize: '12px', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}
                onMouseEnter={e => e.currentTarget.style.background = '#2b2d31'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#6b7280', display: 'inline-block' }}></span>
                Tất cả
              </div>
              {predefinedTags.map(tag => (
                <div 
                  key={tag}
                  onClick={() => { setFilterTag(tag); setShowTagFilter(false); }}
                  style={{ 
                    padding: '8px 14px', cursor: 'pointer', fontSize: '12px', 
                    color: filterTag === tag ? getTagColor(tag) : '#ccc',
                    fontWeight: filterTag === tag ? 600 : 400,
                    display: 'flex', alignItems: 'center', gap: '8px'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#2b2d31'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: getTagColor(tag), display: 'inline-block' }}></span>
                  {tag}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="conversations-list">
          {conversations
            .filter(conv => conv.type === filterType)
            .filter(conv => {
              if (!filterAccount) return true;
              return conv.account_id === filterAccount;
            })
            .filter(conv => {
              if (!filterTag) return true;
              const tags = customerTagsMap[conv.sender_id] || [];
              return tags.includes(filterTag);
            })
            .filter(conv => 
              (conv.sender_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
              (conv.snippet || '').toLowerCase().includes(searchQuery.toLowerCase())
            ).length === 0 ? (
            <div style={{padding: '20px', textAlign: 'center', color: '#666'}}>
              {filterType === 'inbox' ? 'Chưa có tin nhắn. Hãy bấm Đồng bộ.' : 'Chưa có bình luận nào.'}
            </div>
          ) : (
            conversations
            .filter(conv => conv.type === filterType)
            .filter(conv => {
              if (!filterAccount) return true;
              return conv.account_id === filterAccount;
            })
            .filter(conv => {
              if (!filterTag) return true;
              const tags = customerTagsMap[conv.sender_id] || [];
              return tags.includes(filterTag);
            })
            .filter(conv => 
              (conv.sender_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
              (conv.snippet || '').toLowerCase().includes(searchQuery.toLowerCase())
            ).map(conv => (
              <div 
                key={conv.id} 
                className={`conversation-item ${activeConv?.id === conv.id ? 'active' : ''} ${conv.type === 'comment' ? 'is-comment' : ''} ${conv.needs_reply ? 'needs-reply' : ''}`}
                onClick={() => handleSelectConv(conv)}
              >
                {conv.needs_reply === 1 && <div className="unreplied-dot" title="Chưa trả lời" />}
                <div className="avatar-wrapper">
                  {conv.type === 'comment' ? (
                    /* Comment: hiện icon bài viết thay vì avatar */
                    <div className="comment-avatar-icon">
                      <MessageSquare size={20} />
                    </div>
                  ) : (
                    /* Inbox: hiện avatar người gửi */
                    <img 
                      src={`/api/crm/avatar/${conv.account_id}/${conv.sender_id}?name=${encodeURIComponent(conv.sender_name || 'User')}`} 
                      alt="User Avatar" 
                      style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%'}}
                    />
                  )}
                  <div className="platform-icons-group">
                    <div className="platform-icon-small page-logo" title={getAccountName(conv.account_id)}>
                      {getAccountPageId(conv.account_id) ? (
                        <img 
                          src={`https://graph.facebook.com/v21.0/${getAccountPageId(conv.account_id)}/picture?type=small`} 
                          alt="page logo" 
                          style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%'}} 
                        />
                      ) : (
                        getAccountName(conv.account_id).charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="platform-icon-small" title={conv.platform}>
                      {conv.platform === 'facebook' ? <Facebook size={12} /> : <Instagram size={12} />}
                    </div>
                  </div>
                </div>
                <div className="conversation-info">
                  <div className="conversation-header-row">
                    <div className="conversation-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {conv.type === 'comment' 
                        ? (conv.sender_name || '').replace(/^💬\s*/, '').substring(0, 25) + (conv.sender_name?.length > 25 ? '...' : '')
                        : conv.sender_name
                      }
                      {conv.bot_paused !== 1 && <span title="AI Bot đang hỗ trợ" style={{ fontSize: '12px' }}>🤖</span>}
                    </div>
                    <div className="conversation-time">{timeAgo(conv.updated_at || conv.created_at || new Date())}</div>
                  </div>
                  <div className="conversation-snippet">
                    {conv.snippet}
                  </div>
                  <div className="conversation-badges">
                    {/* Tag color dots */}
                    {(customerTagsMap[conv.sender_id] || []).length > 0 && (
                      <div style={{ display: 'flex', gap: '3px', marginRight: '4px' }}>
                        {(customerTagsMap[conv.sender_id] || []).slice(0, 3).map((tag, i) => (
                          <span key={i} style={{ 
                            width: '8px', height: '8px', borderRadius: '50%', 
                            background: getTagColor(tag), display: 'inline-block',
                            border: '1px solid rgba(255,255,255,0.2)'
                          }} title={tag}></span>
                        ))}
                      </div>
                    )}
                    {conv.type === 'comment' ? (
                      <>
                        <span className="badge purple"><MessageSquare size={10} /> Bình luận</span>
                        <span className="badge">{conv.platform === 'facebook' ? 'FB Post' : 'IG Post'}</span>
                      </>
                    ) : (
                      <>
                        <span className="badge green">Tin nhắn</span>
                        <span className="badge">{conv.platform === 'facebook' ? 'Messenger' : 'IG Direct'}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* =======================
          PANE 2: MAIN CHAT AREA
          ======================= */}
      <div className="inbox-main">
        {activeConv ? (
          <>
            <div className="chat-header">
              <div className="chat-header-user">
                <div className="avatar-wrapper" style={{width: '40px', height: '40px'}}>
                  <img 
                    src={`/api/crm/avatar/${activeConv.account_id}/${activeConv.sender_id}?name=${encodeURIComponent(activeConv.sender_name || 'User')}`} 
                    alt="User Avatar" 
                    style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%'}}
                  />
                </div>
                <div className="chat-header-info">
                  <h3>{activeConv.sender_name}</h3>
                  <div className="chat-header-meta">
                    <span className="status-dot"></span>
                    {activeConv.platform === 'facebook' ? 'FACEBOOK MESSENGER' : 'INSTAGRAM DIRECT'} • Online
                  </div>
                </div>
              </div>
              <div className="chat-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div 
                  className="bot-toggle-btn"
                  onClick={async () => {
                    const newPaused = activeConv.bot_paused === 1 ? 0 : 1;
                    try {
                      await fetch(`/api/crm/conversations/${activeConv.id}/bot-mode`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isPaused: newPaused })
                      });
                      setActiveConv({ ...activeConv, bot_paused: newPaused });
                      Swal.fire({
                        toast: true, position: 'top-end', icon: 'success', 
                        title: newPaused ? 'Chuyển sang chế độ Nhân viên' : 'Chuyển sang chế độ Bot', 
                        showConfirmButton: false, timer: 1500
                      });
                      fetchConversations(); // Reload list
                    } catch(e) {}
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                    background: activeConv.bot_paused === 1 ? '#3f4147' : '#10b981',
                    padding: '6px 12px', borderRadius: '20px', color: '#fff', fontSize: '13px', fontWeight: 'bold'
                  }}
                >
                  {activeConv.bot_paused === 1 ? '👤 Nhân viên' : '🤖 AI Bot'}
                </div>
                <Phone size={20} />
                <Video size={20} />
                <MoreVertical size={20} />
              </div>
            </div>

            <div className="chat-messages" ref={chatMessagesRef}>
              {/* Fake Date Separator */}
              <div className="date-separator">
                <span>TUESDAY, OCT 24</span>
              </div>

              {messages.map((msg, index) => (
                <div key={msg.id} className={`message-bubble-wrapper ${msg.is_from_page ? 'from-page' : 'from-customer'}`}>
                  <div className="message-bubble">
                    {renderMessageText(msg.message)}
                  </div>
                  <div className="message-meta">
                    {formatTime(msg.created_time)} {msg.is_from_page && <span style={{color: '#4ade80', fontSize: '10px'}}>✓</span>}
                  </div>
                  
                  {/* Read Receipts */}
                  {index === messages.length - 1 && (
                    <div className="message-readers" style={{ display: 'flex', justifyContent: msg.is_from_page ? 'flex-end' : 'flex-start', gap: '4px', marginTop: '4px', paddingRight: msg.is_from_page ? '15px' : '0' }}>
                      <img 
                        src={`/api/crm/avatar/${activeConv.account_id}/${activeConv.sender_id}?name=${encodeURIComponent(activeConv.sender_name || 'User')}`} 
                        alt="Customer Read" 
                        style={{width: '16px', height: '16px', borderRadius: '50%', objectFit: 'cover'}}
                        title={`Đã xem bởi ${activeConv.sender_name}`}
                      />
                      <img 
                        src={`https://graph.facebook.com/v21.0/${getAccountPageId(activeConv.account_id)}/picture?type=small`} 
                        alt="Page Read" 
                        style={{width: '16px', height: '16px', borderRadius: '50%', objectFit: 'cover'}}
                        title="Đã xem bởi Page"
                        onError={(e) => e.target.style.display = 'none'}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="chat-input-area">
              <div className="chat-input-wrapper">
                <button className="btn-icon"><Plus size={20} /></button>
                <input 
                  type="text" 
                  placeholder="Type a message..." 
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                />
                <div style={{position: 'relative'}} ref={emojiPickerRef}>
                  <button className="btn-icon" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
                    <Smile size={20} />
                  </button>
                  {showEmojiPicker && (
                    <div style={{ position: 'absolute', bottom: '100%', right: '0', marginBottom: '10px', zIndex: 100 }}>
                      <EmojiPicker 
                        onEmojiClick={(emojiObject) => setReplyText(prev => prev + emojiObject.emoji)} 
                        theme="dark"
                      />
                    </div>
                  )}
                </div>
                <button className="btn-send" onClick={handleSend} disabled={!replyText.trim() || isSending}>
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <MessageCircle size={48} style={{opacity: 0.2, marginBottom: '20px'}} />
            <h3>Select a conversation to start chatting</h3>
          </div>
        )}
      </div>

      {/* =======================
          PANE 3: PROFILE SIDEBAR
          ======================= */}
      {activeConv && (
        <div className="inbox-profile">
          <div className="profile-header">
            <div className="profile-avatar">
              <img 
                src={`/api/crm/avatar/${activeConv.account_id}/${activeConv.sender_id}?name=${encodeURIComponent(activeConv.sender_name || 'User')}`} 
                alt="User Avatar" 
                style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: '16px'}}
              />
            </div>
            <h3>{activeConv.sender_name}</h3>
            <div className="profile-title">
              Customer @ {getAccountName(activeConv.account_id)}
            </div>
            <div className="profile-actions">
              <button className="profile-btn" onClick={() => setEditingField('address')} title={customerProfile?.address || 'Add Address'}>
                <MapPin size={18} color={customerProfile?.address ? '#4ade80' : 'currentColor'} />
              </button>
              <button className="profile-btn" onClick={() => setEditingField('phone')} title={customerProfile?.phone || 'Add Phone'}>
                <Phone size={18} color={customerProfile?.phone ? '#4ade80' : 'currentColor'} />
              </button>
              <button className="profile-btn" onClick={() => {
                let link = `https://business.facebook.com/latest/inbox/all?asset_id=${activeConv.account_id}&selected_item_id=${activeConv.id}`;
                if (activeConv.platform === 'instagram') {
                  link = `https://instagram.com/${activeConv.sender_name}`;
                }
                window.open(link, '_blank');
              }} title="Mở trang cá nhân / Inbox gốc">
                <LinkIcon size={18} />
              </button>
            </div>
            
            {/* Inline Editor for Contact Info */}
            {(editingField === 'address' || editingField === 'phone') && (
              <div style={{ marginTop: '10px', display: 'flex', gap: '5px' }}>
                <input 
                  type="text"
                  placeholder={`Enter ${editingField}...`}
                  defaultValue={customerProfile?.[editingField] || ''}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveEditingField()}
                  style={{ flex: 1, padding: '5px', borderRadius: '4px', border: '1px solid #3f4147', background: '#1e1f23', color: 'white' }}
                />
                <button onClick={saveEditingField} style={{ background: '#ff4d8d', color: 'white', border: 'none', borderRadius: '4px', padding: '0 10px', cursor: 'pointer' }}>Lưu</button>
                <button onClick={() => setEditingField(null)} style={{ background: '#3f4147', color: 'white', border: 'none', borderRadius: '4px', padding: '0 10px', cursor: 'pointer' }}>Hủy</button>
              </div>
            )}
          </div>

          <div className="profile-section">
            <div className="section-title">
              TAGS 
            </div>
            {/* Predefined Tags */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {predefinedTags.map(t => (
                <span 
                  key={t} 
                  onClick={() => {
                    if (!customerProfile?.tags?.includes(t)) {
                      const newTags = [...(customerProfile?.tags || []), t];
                      handleUpdateProfile({ tags: newTags });
                      if (activeConv) setCustomerTagsMap(prev => ({ ...prev, [activeConv.sender_id]: newTags }));
                    }
                  }}
                  style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '12px', background: '#2b2d31', cursor: 'pointer', color: '#8a8b91' }}
                >
                  + {t}
                </span>
              ))}
            </div>
            <div className="tags-container" style={{ marginBottom: '10px' }}>
              {(customerProfile?.tags || []).map((tag, i) => (
                <span key={i} className="tag" style={{ 
                  background: getTagColor(tag) + '33', 
                  color: getTagColor(tag), 
                  borderColor: getTagColor(tag) + '66' 
                }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: getTagColor(tag), display: 'inline-block', marginRight: '4px' }}></span>
                  {tag} 
                  <span onClick={() => removeTag(i)} style={{ marginLeft: '6px', cursor: 'pointer', color: '#ff4d8d' }}>&times;</span>
                </span>
              ))}
            </div>
            <input 
              type="text" 
              placeholder="+ Add tag (Press Enter)" 
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={addTag}
              style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #3f4147', background: '#1e1f23', color: 'white', fontSize: '12px' }}
            />
          </div>

          <div className="profile-section">
            <div className="section-title">
              NOTES 
            </div>
            <div style={{ marginBottom: '10px', display: 'flex', gap: '5px' }}>
              <input 
                type="text" 
                placeholder="Write a note..." 
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNote()}
                style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid #3f4147', background: '#1e1f23', color: 'white', fontSize: '12px' }}
              />
              <button onClick={addNote} style={{ background: '#ff4d8d', color: 'white', border: 'none', borderRadius: '4px', padding: '0 10px', cursor: 'pointer', fontSize: '12px' }}>Add</button>
            </div>
            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {(customerProfile?.notes || []).map((note, i) => (
                <div key={i} className="notes-card" style={{ marginBottom: '8px' }}>
                  {note.text}
                  <span className="note-date">— {new Date(note.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
              ))}
              {(!customerProfile?.notes || customerProfile.notes.length === 0) && (
                <div style={{ color: '#8a8b91', fontSize: '12px', textAlign: 'center', fontStyle: 'italic' }}>No notes yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>

      {/* Image Gallery Lightbox */}
      {lightboxIndex >= 0 && allImages[lightboxIndex] && (
        <div className="lightbox-overlay" onClick={() => setLightboxIndex(-1)}>
          <button className="lightbox-close" onClick={() => setLightboxIndex(-1)}>
            <X size={24} />
          </button>
          
          {/* Counter */}
          <div className="lightbox-counter">{lightboxIndex + 1} / {allImages.length}</div>
          
          {/* Nav buttons */}
          {lightboxIndex > 0 && (
            <button className="lightbox-nav lightbox-prev" onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i - 1); }}>
              <ChevronLeft size={32} />
            </button>
          )}
          {lightboxIndex < allImages.length - 1 && (
            <button className="lightbox-nav lightbox-next" onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i + 1); }}>
              <ChevronRight size={32} />
            </button>
          )}
          
          {/* Main image */}
          <img src={allImages[lightboxIndex]} alt="Preview" className="lightbox-image" onClick={(e) => e.stopPropagation()} />
          
          {/* Thumbnail strip */}
          {allImages.length > 1 && (
            <div className="lightbox-thumbnails" onClick={(e) => e.stopPropagation()}>
              {allImages.map((url, i) => (
                <img 
                  key={i}
                  src={url} 
                  alt="" 
                  className={`lightbox-thumb ${i === lightboxIndex ? 'active' : ''}`}
                  onClick={() => setLightboxIndex(i)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default InboxCRM;
