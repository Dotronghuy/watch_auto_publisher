import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveConversation, saveMessage, getConversations, getMessageById, getConversationByIdentity, checkDuplicateBotMessage } from '../utils/crm.db.js';
import { broadcastCRM } from './api.routes.js';
import { autoTagCustomer } from '../services/autotag.service.js';
import { handleIncomingMessage } from '../services/chatbot.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Verify Token — tự đặt, phải trùng khi đăng ký trên Facebook Developer
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'vuadongho_crm_2024';

/**
 * GET /webhook — Facebook gọi 1 lần khi đăng ký để xác minh
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verification thành công!');
    return res.status(200).send(challenge);
  }
  
  console.warn('❌ Webhook verification thất bại. Token không khớp.');
  return res.sendStatus(403);
});

/**
 * Đọc accounts.json để tìm account phù hợp
 */
const getAccountByPageId = (pageId) => {
  try {
    const accountsPath = path.join(__dirname, '../../config/accounts.json');
    if (fs.existsSync(accountsPath)) {
      const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
      return accounts.find(a => a.fbPageId?.trim() === String(pageId).trim()) || null;
    }
  } catch {
    // Missing or malformed account config; webhook will fall back to unknown.
  }
  return null;
};

/**
 * POST /webhook — Facebook gửi sự kiện real-time vào đây
 */
router.post('/', async (req, res) => {
  const body = req.body;

  // Facebook yêu cầu trả 200 ngay lập tức trong 5 giây
  res.sendStatus(200);

  try {
    if (body.object === 'page') {
      // === FACEBOOK MESSENGER ===
      for (const entry of body.entry || []) {
        const pageId = entry.id;
        const account = getAccountByPageId(pageId);
        const accountId = account?.id || 'unknown';

        // Xử lý tin nhắn mới
        for (const event of entry.messaging || []) {
          const senderId = event.sender?.id;
          const recipientId = event.recipient?.id;
          const timestamp = event.timestamp;

          // Bỏ qua tin nhắn từ chính Page gửi đi (echo)
          if (event.message?.is_echo) continue;

          if (event.message) {
            const msg = event.message;
            const messageId = msg.mid;
            let text = msg.text || '';

            // Xử lý attachments (ảnh, video, file)
            if (msg.attachments) {
              for (const att of msg.attachments) {
                if (att.type === 'image') text += `\n[IMAGE: ${att.payload?.url || ''}]`;
                else if (att.type === 'video') text += `\n[VIDEO: ${att.payload?.url || ''}]`;
                else if (att.type === 'file') text += `\n[FILE: ${att.payload?.url || ''}]`;
                else if (att.type === 'audio') text += `\n[AUDIO: ${att.payload?.url || ''}]`;
              }
            }

            const isFromPage = senderId === String(pageId).trim();
            const senderName = isFromPage ? 'Page' : (senderId || 'Unknown');
            const customerId = isFromPage ? recipientId : senderId;
            
            // Conversation ID format giống như FB API trả về: t_xxxxx
            // Nhưng webhook không trả conversation ID, nên phải tìm hoặc tạo
            const syntheticConvId = `t_${[senderId, recipientId].sort().join('_')}`;
            const existingConversation = await getConversationByIdentity('facebook', 'inbox', customerId, accountId);
            const convId = existingConversation?.id || syntheticConvId;

            // Chống nhân bản tin nhắn Bot (do Webhook dội lại)
            if (isFromPage && text.trim()) {
              const isDupe = await checkDuplicateBotMessage(convId, text.trim());
              if (isDupe) continue;
            }

            // Lưu conversation
            await saveConversation(
              convId, 'facebook', 'inbox',
              existingConversation?.sender_name || senderName, customerId,
              text.substring(0, 100) || '📸 Tệp đính kèm',
              new Date(timestamp).toISOString(),
              accountId
            );

            const existingMessage = messageId ? await getMessageById(messageId) : null;
            if (existingMessage) {
              console.log(`[Webhook] Bỏ qua tin nhắn trùng lặp (đã xử lý mid): ${messageId}`);
              continue;
            }

            // Lưu message
            await saveMessage(
              messageId || `wh_${Date.now()}`,
              convId,
              text.trim() || '📸 Tệp đính kèm',
              isFromPage ? 1 : 0,
              new Date(timestamp).toISOString()
            );

            console.log(`📩 [Webhook] Tin nhắn mới từ ${senderName}: "${text.substring(0, 50)}..."`);

            // Broadcast SSE → Frontend cập nhật ngay lập tức!
            const conversations = await getConversations();
            broadcastCRM('conversations_updated', conversations);
            broadcastCRM('new_message', {
              conversationId: convId,
              message: {
                id: messageId,
                conversation_id: convId,
                message: text,
                is_from_page: isFromPage ? 1 : 0,
                created_time: new Date(timestamp).toISOString()
              }
            });

            // Auto-tag khi nhận tin nhắn từ khách (không phải từ Page)
            if (!isFromPage && !existingMessage) {
              autoTagCustomer(customerId, convId).catch(e => console.error('Auto-tag error:', e.message));
              
              // Gọi AI Chatbot
              let imageUrl = null;
              if (msg.attachments) {
                const imgAtt = msg.attachments.find(a => a.type === 'image');
                if (imgAtt && imgAtt.payload) imageUrl = imgAtt.payload.url;
              }
              handleIncomingMessage(convId, text, imageUrl).catch(e => console.error('Chatbot FB error:', e.message));
            }
          }

          // Xử lý read receipt (đã đọc)
          if (event.read) {
            console.log(`👁️ [Webhook] Khách ${senderId} đã đọc tin nhắn lúc ${new Date(event.read.watermark).toLocaleString()}`);
          }

          // Xử lý delivery receipt (đã gửi tới)
          if (event.delivery) {
            // Có thể log hoặc bỏ qua
          }
        }
      }
    }

    if (body.object === 'instagram') {
      // === INSTAGRAM MESSAGING ===
      for (const entry of body.entry || []) {
        const igUserId = entry.id;

        for (const event of entry.messaging || []) {
          const senderId = event.sender?.id;
          const recipientId = event.recipient?.id;
          const timestamp = event.timestamp;

          if (event.message?.is_echo) continue;

          if (event.message) {
            const msg = event.message;
            const messageId = msg.mid;
            let text = msg.text || '';

            if (msg.attachments) {
              for (const att of msg.attachments) {
                if (att.type === 'image') text += `\n[IMAGE: ${att.payload?.url || ''}]`;
                else if (att.type === 'video') text += `\n[VIDEO: ${att.payload?.url || ''}]`;
                else if (att.type === 'share') text += `\n[SHARE: ${att.payload?.url || ''}]`;
              }
            }

            const isFromPage = senderId === igUserId;
            const customerId = isFromPage ? recipientId : senderId;
            const senderName = isFromPage ? 'Page' : (senderId || 'IG User');

            // Tìm account bằng igUserId
            let accountId = 'unknown';
            try {
              const accountsPath = path.join(__dirname, '../../config/accounts.json');
              const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
              const acc = accounts.find(a => a.igUserId === igUserId);
              if (acc) accountId = acc.id;
            } catch {
              // Missing or malformed account config; webhook will fall back to unknown.
            }

            const syntheticConvId = `ig_${[senderId, recipientId].sort().join('_')}`;
            const existingConversation = await getConversationByIdentity('instagram', 'inbox', customerId, accountId);
            const convId = existingConversation?.id || syntheticConvId;

            // Chống nhân bản tin nhắn Bot (do Webhook dội lại)
            if (isFromPage && text.trim()) {
              const isDupe = await checkDuplicateBotMessage(convId, text.trim());
              if (isDupe) continue;
            }

            await saveConversation(
              convId, 'instagram', 'inbox',
              existingConversation?.sender_name || senderName, customerId,
              text.substring(0, 100) || '📸 Tệp đính kèm',
              new Date(timestamp).toISOString(),
              accountId
            );

            const existingMessage = messageId ? await getMessageById(messageId) : null;

            await saveMessage(
              messageId || `wh_ig_${Date.now()}`,
              convId,
              text.trim() || '📸 Tệp đính kèm',
              isFromPage ? 1 : 0,
              new Date(timestamp).toISOString()
            );

            console.log(`📩 [Webhook IG] Tin nhắn mới từ ${senderName}: "${text.substring(0, 50)}..."`);

            const conversations = await getConversations();
            broadcastCRM('conversations_updated', conversations);
            broadcastCRM('new_message', {
              conversationId: convId,
              message: {
                id: messageId,
                conversation_id: convId,
                message: text,
                is_from_page: isFromPage ? 1 : 0,
                created_time: new Date(timestamp).toISOString()
              }
            });

            // Auto-tag khi nhận tin nhắn từ khách IG
            if (!isFromPage && !existingMessage) {
              autoTagCustomer(customerId, convId).catch(e => console.error('Auto-tag IG error:', e.message));

              // Gọi AI Chatbot
              let imageUrl = null;
              if (msg.attachments) {
                const imgAtt = msg.attachments.find(a => a.type === 'image');
                if (imgAtt && imgAtt.payload) imageUrl = imgAtt.payload.url;
              }
              handleIncomingMessage(convId, text, imageUrl).catch(e => console.error('Chatbot IG error:', e.message));
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('❌ Lỗi xử lý Webhook:', err.message);
  }
});

export default router;
