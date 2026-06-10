import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveConversation, saveMessage, getConversationById } from '../utils/crm.db.js';
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
export const fetchFacebookInbox = async (pageToken, accountId) => {
  if (!pageToken) return;
  try {
    const res = await axios.get(`${GRAPH_API_BASE}/me/conversations`, {
      params: {
        fields: 'id,updated_time,snippet,participants,messages.limit(20){id,created_time,message,from}',
        access_token: pageToken
      }
    });

    const conversations = res.data.data || [];
    for (const conv of conversations) {
      const participants = conv.participants?.data || [];
      const sender = participants.find(p => p.id) || { name: 'Unknown', id: '0' };
      
      await saveConversation(conv.id, 'facebook', 'inbox', sender.name, sender.id, conv.snippet, conv.updated_time, accountId);
      
      const messages = conv.messages?.data || [];
      for (const msg of messages) {
        const isFromPage = msg.from?.id !== sender.id;
        await saveMessage(msg.id, conv.id, msg.message, isFromPage, msg.created_time);
      }
    }
  } catch (error) {
    console.error(`❌ Lỗi FB Inbox (Account ${accountId}):`, error.response?.data || error.message);
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
export const fetchInstagramInbox = async (pageToken, accountId) => {
  if (!pageToken) return;
  try {
    const res = await axios.get(`${GRAPH_API_BASE}/me/conversations`, {
      params: {
        platform: 'instagram',
        fields: 'id,updated_time,snippet,participants,messages.limit(20){id,created_time,message,from}',
        access_token: pageToken
      }
    });

    const conversations = res.data.data || [];
    for (const conv of conversations) {
      const participants = conv.participants?.data || [];
      const sender = participants.find(p => p.id) || { name: 'Instagram User', id: '0' };
      
      await saveConversation(conv.id, 'instagram', 'inbox', sender.name, sender.id, conv.snippet, conv.updated_time, accountId);
      
      const messages = conv.messages?.data || [];
      for (const msg of messages) {
        const isFromPage = msg.from?.id !== sender.id;
        await saveMessage(msg.id, conv.id, msg.message, isFromPage, msg.created_time);
      }
    }
  } catch (error) {
    console.error(`❌ Lỗi IG Inbox (Account ${accountId}):`, error.response?.data || error.message);
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
        fields: 'id,caption,comments.limit(20){id,text,timestamp,from}',
        access_token: pageToken
      }
    });

    const medias = res.data.data || [];
    for (const media of medias) {
      const comments = media.comments?.data || [];
      if (comments.length > 0) {
        const snippet = media.caption ? media.caption.substring(0, 50) + '...' : 'Bài viết IG';
        const latestCmtTime = comments[0]?.timestamp || new Date().toISOString();
        await saveConversation(media.id, 'instagram', 'comment', 'Bài Viết IG', media.id, snippet, latestCmtTime, accountId);
        
        for (const cmt of comments) {
          const isFromPage = cmt.from?.id === igUserId;
          await saveMessage(cmt.id, media.id, cmt.text, isFromPage, cmt.timestamp);
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
    const { id, fbAccessToken, igAccessToken, igUserId } = acc;
    
    // Ưu tiên dùng fbAccessToken nếu có, nếu không thì dùng chung (có thể dùng pageToken cho IG)
    const tokenToUseForFB = fbAccessToken;
    const tokenToUseForIG = igAccessToken || fbAccessToken;

    if (tokenToUseForFB) {
      await fetchFacebookInbox(tokenToUseForFB, id);
      await fetchFacebookComments(tokenToUseForFB, id);
    }
    
    if (tokenToUseForIG) {
      await fetchInstagramInbox(tokenToUseForIG, id);
      if (igUserId) {
        await fetchInstagramComments(igUserId, tokenToUseForIG, id);
      }
    }
  }
  console.log(`✅ Đã hoàn tất đồng bộ CRM cho ${activeAccounts.length} tài khoản.`);
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
      const res = await axios.post(`${GRAPH_API_BASE}/${targetId}/messages`, {
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
