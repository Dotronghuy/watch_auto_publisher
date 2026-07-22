import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveConversation, saveMessage, getConversationById, getMessageById, removeLocalOutgoingMessageDuplicates } from '../utils/crm.db.js';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const accountsPath = path.join(__dirname, '../../config/accounts.json');

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Đọc accounts từ file config
 */
const getActiveAccounts = () => {
  try {
    if (fs.existsSync(accountsPath)) {
      const data = fs.readFileSync(accountsPath, 'utf8');
      const accounts = JSON.parse(data);
      return accounts.filter(acc => acc.isActive);
    }
  } catch (err) {
    console.error('Lỗi đọc accounts.json:', err.message);
  }
  return [];
};

/**
 * Lấy Facebook Inbox
 */
export const fetchFacebookInbox = async (pageToken, accountId, fbPageId, options = {}) => {
  if (!pageToken) return;
  try {
    const conversationLimit = Math.max(1, Number.parseInt(options.conversationLimit, 10) || 25);
    const messageLimit = Math.max(1, Number.parseInt(options.messageLimit, 10) || 20);
    const res = await axios.get(`${GRAPH_API_BASE}/me/conversations`, {
      params: {
        fields: `id,updated_time,snippet,participants,messages.limit(${messageLimit}){id,created_time,message,from,attachments{image_data,video_data,file_url}}`,
        limit: conversationLimit,
        access_token: pageToken
      }
    });

    const conversations = res.data.data || [];
    let hasAnyNewCustomerMessage = false;

    for (const conv of conversations) {
      const participants = conv.participants?.data || [];
      // Lọc bỏ chính Page ra khỏi danh sách để tìm đúng khách hàng
      const pageIdTrimmed = fbPageId ? fbPageId.trim() : null;
      let sender = participants.find(p => pageIdTrimmed ? p.id !== pageIdTrimmed : false);
      if (!sender && participants.length > 0) sender = participants[0];
      if (!sender) sender = { name: 'Unknown', id: '0' };
      
      await saveConversation(conv.id, 'facebook', 'inbox', sender.name, sender.id, conv.snippet, conv.updated_time, accountId, { mergeExisting: true });
      
      let hasNewCustomerMessage = false;
      let textToProcess = '';
      let imageUrlToProcess = null;

      const messages = conv.messages?.data || [];
      for (const msg of messages) {
        // So sánh trực tiếp với Page ID để xác định tin nhắn từ Page
        const isFromPage = pageIdTrimmed ? msg.from?.id === pageIdTrimmed : msg.from?.id !== sender.id;
        let text = msg.message || '';
        let imageUrl = null;
        if (msg.attachments && msg.attachments.data) {
          for (const att of msg.attachments.data) {
            if (att.image_data && att.image_data.url) {
              text += `\n[IMAGE: ${att.image_data.url}]`;
              if (!imageUrl) imageUrl = att.image_data.url;
            }
            else if (att.video_data && att.video_data.url) text += `\n[VIDEO: ${att.video_data.url}]`;
            else if (att.file_url) text += `\n[FILE: ${att.file_url}]`;
          }
        }
        const textToSave = text.trim() || '📸 Tệp đính kèm';
        const existingMsg = await getMessageById(msg.id);

        if (isFromPage) {
          await removeLocalOutgoingMessageDuplicates(conv.id, textToSave, msg.id);
        }
        
        await saveMessage(msg.id, conv.id, textToSave, isFromPage, msg.created_time);

        if (!existingMsg && !isFromPage) {
          hasNewCustomerMessage = true;
          hasAnyNewCustomerMessage = true;
          textToProcess = textToSave;
          imageUrlToProcess = imageUrl;
        }
      }

      if (hasNewCustomerMessage) {
        try {
          const { handleIncomingMessage } = await import('./chatbot.service.js');
          handleIncomingMessage(conv.id, textToProcess, imageUrlToProcess).catch(e => console.error('Chatbot Sync FB error:', e.message));
        } catch (err) {
          console.error('Không thể nạp chatbot service cho FB sync:', err.message);
        }
      }
    }
    return hasAnyNewCustomerMessage;
  } catch (error) {
    console.error(`❌ Lỗi FB Inbox (Account ${accountId}):`, error.response?.data || error.message);
    return false;
  }
};

/**
 * Lấy Facebook Comments
 */
export const fetchFacebookComments = async (pageToken, accountId) => {
  if (!pageToken) return;
  try {
    const res = await axios.get(`${GRAPH_API_BASE}/me/posts`, {
      params: {
        fields: 'id,message,created_time,comments.limit(20){id,message,created_time,from}',
        access_token: pageToken
      }
    });

    const posts = res.data.data || [];
    for (const post of posts) {
      const comments = post.comments?.data || [];
      if (comments.length > 0) {
        const snippet = post.message ? post.message.substring(0, 50) + '...' : 'Bài viết không có nội dung';
        await saveConversation(post.id, 'facebook', 'comment', 'Bài Viết FB', post.id, snippet, post.created_time, accountId);
        
        for (const cmt of comments) {
          const isFromPage = cmt.from ? false : true;
          await saveMessage(cmt.id, post.id, cmt.message, isFromPage, cmt.created_time);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Lỗi FB Comments (Account ${accountId}):`, error.response?.data || error.message);
  }
};

/**
 * Lấy Instagram Inbox
 */
export const fetchInstagramInbox = async (pageToken, accountId, igUserId, options = {}) => {
  if (!pageToken) return;
  try {
    const conversationLimit = Math.max(1, Number.parseInt(options.conversationLimit, 10) || 25);
    const messageLimit = Math.max(1, Number.parseInt(options.messageLimit, 10) || 20);
    const fetchFolder = async (folderName) => {
      const res = await axios.get(`${GRAPH_API_BASE}/me/conversations`, {
        params: {
          platform: 'instagram',
          folder: folderName,
          fields: `id,updated_time,snippet,participants,messages.limit(${messageLimit}){id,created_time,message,from,attachments{image_data,video_data,file_url}}`,
          limit: conversationLimit,
          access_token: pageToken
        }
      });
      return res.data.data || [];
    };

    const [inboxConvs, pendingConvs] = await Promise.all([
      fetchFolder('inbox'),
      fetchFolder('pending')
    ]);

    const conversations = [...inboxConvs, ...pendingConvs];
    let hasAnyNewCustomerMessage = false;

    for (const conv of conversations) {
      const participants = conv.participants?.data || [];
      let sender = participants.find(p => igUserId ? p.id !== igUserId : p.id);
      if (!sender && participants.length > 0) sender = participants[0];
      if (!sender) sender = { username: 'Instagram User', id: '0' };
      
      const senderName = sender.username || sender.name || 'Instagram User';
      
      await saveConversation(conv.id, 'instagram', 'inbox', senderName, sender.id, conv.snippet, conv.updated_time, accountId, { mergeExisting: true });
      
      let hasNewCustomerMessage = false;
      let textToProcess = '';
      let imageUrlToProcess = null;

      const messages = conv.messages?.data || [];
      for (const msg of messages) {
        const isFromPage = igUserId ? msg.from?.id === igUserId : msg.from?.id !== sender.id;
        let text = msg.message || '';
        let imageUrl = null;
        if (msg.attachments && msg.attachments.data) {
          for (const att of msg.attachments.data) {
            if (att.image_data && att.image_data.url) {
              text += `\n[IMAGE: ${att.image_data.url}]`;
              if (!imageUrl) imageUrl = att.image_data.url;
            }
            else if (att.video_data && att.video_data.url) text += `\n[VIDEO: ${att.video_data.url}]`;
            else if (att.file_url) text += `\n[FILE: ${att.file_url}]`;
          }
        }

        const textToSave = text.trim() || '📸 Tệp đính kèm';
        const existingMsg = await getMessageById(msg.id);

        if (isFromPage) {
          await removeLocalOutgoingMessageDuplicates(conv.id, textToSave, msg.id);
        }

        await saveMessage(msg.id, conv.id, textToSave, isFromPage, msg.created_time);

        if (!existingMsg && !isFromPage) {
          hasNewCustomerMessage = true;
          hasAnyNewCustomerMessage = true;
          textToProcess = textToSave;
          imageUrlToProcess = imageUrl;
        }
      }

      if (hasNewCustomerMessage) {
        try {
          const { handleIncomingMessage } = await import('./chatbot.service.js');
          handleIncomingMessage(conv.id, textToProcess, imageUrlToProcess).catch(e => console.error('Chatbot Sync IG error:', e.message));
        } catch (err) {
          console.error('Không thể nạp chatbot service cho IG sync:', err.message);
        }
      }
    }
    return hasAnyNewCustomerMessage;
  } catch (error) {
    console.error(`❌ Lỗi IG Inbox (Account ${accountId}):`, error.response?.data || error.message);
    return false;
  }
};

/**
 * Lấy Instagram Comments
 */
export const fetchInstagramComments = async (igUserId, pageToken, accountId) => {
  if (!igUserId || !pageToken) return;
  try {
    const res = await axios.get(`${GRAPH_API_BASE}/${igUserId}/media`, {
      params: {
        fields: 'id,caption,comments_count,comments.limit(20){id,text,timestamp,from,username}',
        access_token: pageToken,
        limit: 25
      }
    });

    const medias = res.data.data || [];
    for (const media of medias) {
      const comments = media.comments?.data || [];
      if (comments.length > 0) {
        const snippet = media.caption ? media.caption.substring(0, 50) + '...' : 'Bài viết IG';
        const latestCmtTime = comments[0]?.timestamp || new Date().toISOString();
        // Dùng caption làm tên hiển thị, kèm emoji để phân biệt
        const displayName = '💬 ' + (media.caption ? media.caption.substring(0, 30) : 'Bài viết IG');
        await saveConversation(media.id, 'instagram', 'comment', displayName, media.id, snippet, latestCmtTime, accountId);
        
        for (const cmt of comments) {
          const isFromPage = cmt.from?.id === igUserId;
          const commenterName = cmt.username || cmt.from?.username || '';
          const msgText = commenterName ? `@${commenterName}: ${cmt.text}` : cmt.text;
          await saveMessage(cmt.id, media.id, msgText, isFromPage, cmt.timestamp);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Lỗi IG Comments (Account ${accountId}):`, error.response?.data || error.message);
  }
};

/**
 * Đồng bộ toàn bộ các tài khoản
 */
export const syncAllCRM = async () => {
  const activeAccounts = getActiveAccounts();
  if (activeAccounts.length === 0) {
    console.log('⚠️ Không có tài khoản nào active để đồng bộ CRM.');
    return;
  }

  for (const acc of activeAccounts) {
    const { id, fbAccessToken, igAccessToken, igUserId, fbPageId } = acc;
    
    // Ưu tiên dùng fbAccessToken nếu có, nếu không thì dùng chung (có thể dùng pageToken cho IG)
    const tokenToUseForFB = fbAccessToken;
    const tokenToUseForIG = igAccessToken || fbAccessToken;

    if (tokenToUseForFB) {
      await fetchFacebookInbox(tokenToUseForFB, id, fbPageId);
      await fetchFacebookComments(tokenToUseForFB, id);
    }
    
    if (tokenToUseForIG) {
      await fetchInstagramInbox(tokenToUseForIG, id, igUserId);
      if (igUserId) {
        await fetchInstagramComments(igUserId, tokenToUseForIG, id);
      }
    }
  }
  console.log(`✅ Đã hoàn tất đồng bộ CRM cho ${activeAccounts.length} tài khoản.`);
};

/**
 * Đồng bộ nhanh chỉ phần inbox để chatbot bắt tin mới khi Webhook chưa bắn đúng.
 * Không quét comments ở luồng này để giảm tải Graph API.
 */
export const syncCRMInboxes = async () => {
  const activeAccounts = getActiveAccounts();
  if (activeAccounts.length === 0) {
    return false;
  }

  const accountResults = await Promise.all(activeAccounts.map(async (acc) => {
    const { id, fbAccessToken, igAccessToken, igUserId, fbPageId } = acc;
    const syncTasks = [];
    const fastOptions = { conversationLimit: 10, messageLimit: 5 };

    if (fbAccessToken) {
      syncTasks.push(fetchFacebookInbox(fbAccessToken, id, fbPageId, fastOptions));
    }

    if (igAccessToken || igUserId) {
      syncTasks.push(fetchInstagramInbox(igAccessToken || fbAccessToken, id, igUserId, fastOptions));
    }

    const results = await Promise.all(syncTasks);
    return results.some(Boolean);
  }));

  return accountResults.some(Boolean);
};

export const startFastCRMInboxSync = (intervalMs = 2000) => {
  const safeIntervalMs = Math.max(2000, Number.parseInt(intervalMs, 10) || 2000);
  if (global.crmFastSyncInterval) {
    return global.crmFastSyncInterval;
  }

  global.crmFastSyncRunning = false;

  const runFastInboxSync = async () => {
    if (global.crmFastSyncRunning) return;
    global.crmFastSyncRunning = true;

    try {
      const hasNewMessages = await syncCRMInboxes();
      if (hasNewMessages) {
        const [{ getConversations }, { broadcastCRM }] = await Promise.all([
          import('../utils/crm.db.js'),
          import('../routes/api.routes.js')
        ]);
        broadcastCRM('conversations_updated', await getConversations());
      }
    } catch (e) {
      console.error('Lỗi khi đồng bộ nhanh CRM Inbox:', e.message);
    } finally {
      global.crmFastSyncRunning = false;
    }
  };

  global.crmFastSyncInterval = setInterval(runFastInboxSync, safeIntervalMs);
  setTimeout(runFastInboxSync, 1000);
  console.log(`✅ Đã bật đồng bộ nhanh CRM Inbox mỗi ${safeIntervalMs / 1000}s.`);
  return global.crmFastSyncInterval;
};

/**
 * Trả lời tin nhắn hoặc comment
 */
export const replyCRM = async (targetId, message, type, conversationId) => {
  // Lấy accountId từ DB để tìm token phù hợp
  const conversation = await getConversationById(conversationId);
  if (!conversation || !conversation.account_id) {
    throw new Error('Không tìm thấy thông tin Conversation hoặc Account ID');
  }

  const activeAccounts = getActiveAccounts();
  const acc = activeAccounts.find(a => a.id === conversation.account_id);
  
  if (!acc) {
    throw new Error('Tài khoản gắn với tin nhắn này không tồn tại hoặc đã bị vô hiệu hóa.');
  }

  // Nếu là facebook dùng fbAccessToken, nếu instagram ưu tiên igAccessToken hoặc fbAccessToken
  const token = (conversation.platform === 'instagram' && acc.igAccessToken) 
                 ? acc.igAccessToken 
                 : acc.fbAccessToken;

  if (!token) throw new Error(`Không tìm thấy token hợp lệ cho tài khoản ${acc.name}`);

  try {
    if (type === 'inbox') {
      const res = await axios.post(`${GRAPH_API_BASE}/me/messages`, {
        recipient: { id: targetId },
        message: { text: message }
      }, {
        params: { access_token: token }
      });
      return res.data;
    } else if (type === 'comment') {
      const res = await axios.post(`${GRAPH_API_BASE}/${targetId}/comments`, {
        message: message
      }, {
        params: { access_token: token }
      });
      return res.data;
    }
  } catch (err) {
    console.error('❌ Lỗi khi gửi reply CRM:', err.response?.data || err.message);
    throw err;
  }
};

/**
 * Gửi ảnh sản phẩm qua Facebook Messenger / Instagram DM
 */
export const replyImageCRM = async (targetId, imageUrl, type, conversationId) => {
  const conversation = await getConversationById(conversationId);
  if (!conversation || !conversation.account_id) {
    throw new Error('Không tìm thấy thông tin Conversation hoặc Account ID');
  }

  const activeAccounts = getActiveAccounts();
  const acc = activeAccounts.find(a => a.id === conversation.account_id);
  if (!acc) {
    throw new Error('Tài khoản gắn với tin nhắn này không tồn tại hoặc đã bị vô hiệu hóa.');
  }

  const token = (conversation.platform === 'instagram' && acc.igAccessToken)
                 ? acc.igAccessToken
                 : acc.fbAccessToken;
  if (!token) throw new Error(`Không tìm thấy token hợp lệ cho tài khoản ${acc.name}`);

  try {
    if (type === 'inbox') {
      const res = await axios.post(`${GRAPH_API_BASE}/me/messages`, {
        recipient: { id: targetId },
        message: {
          attachment: {
            type: 'image',
            payload: {
              url: imageUrl,
              is_reusable: true
            }
          }
        }
      }, {
        params: { access_token: token }
      });
      return res.data;
    }
    // Instagram DM cũng dùng cùng format
    // Comment thì không gửi ảnh được
  } catch (err) {
    console.error('❌ Lỗi khi gửi ảnh CRM:', err.response?.data || err.message);
    // Không throw để không làm crash luồng chính - ảnh là bonus, text là chính
  }
};
