import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { generateBackgroundOnChatGPT } from './playwright.service.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

export const telegramEvents = new EventEmitter();

let bot = null;

// Quản lý state của quá trình duyệt
export const reviewState = {
  activeSession: false,
  pendingCount: 0,
  images: [], // { id, path, prompt, status: 'pending' | 'approved' | 'deleted' }
  waitingFeedbackForId: null,
  watchImagePath: null,
  sampleImagePath: null,
  timeoutTimer: null,
};

const TIMEOUT_MS = 60 * 60 * 1000; // 1 tiếng

export const startTelegramBot = () => {
  if (!token) return;
  bot = new TelegramBot(token, { polling: true });
  console.log('🤖 Telegram Bot đã khởi động!');

  // Bỏ qua lỗi đứt mạng của Telegram API để tránh rác log
  bot.on('polling_error', (error) => {
    if (error.code === 'EFATAL' || (error.message && error.message.includes('ECONNRESET'))) {
      // Ignore network resets during polling, bot will auto-reconnect
      return;
    }
    console.error('Lỗi Polling Telegram:', error.message);
  });

  bot.on('callback_query', async (query) => {
    const data = query.data;
    const msg = query.message;
    resetTimeout();

    if (data === 'action_continue') {
      bot.answerCallbackQuery(query.id, { text: '🚀 Đang chuẩn bị lượt Train tiếp theo...' }).catch(e => console.error(e.message));
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(e => console.error(e.message));
      if (reviewState.activeSession) {
        telegramEvents.emit('continue_training');
      } else {
        telegramEvents.emit('trigger_start_training');
      }
      return;
    }

    if (data === 'action_pause') {
      bot.answerCallbackQuery(query.id, { text: '⏸️ Đã ngưng hệ thống.' }).catch(e => console.error(e.message));
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(e => console.error(e.message));
      telegramEvents.emit('stop_training');
      reviewState.activeSession = false;
      return;
    }

    // data format: "approve_1", "feedback_1", "delete_1"
    const [action, idStr] = data.split('_');
    const id = parseInt(idStr);
    const imgData = reviewState.images.find(img => img.id === id);

    if (!imgData) {
      bot.answerCallbackQuery(query.id, { text: 'Ảnh này đã được xử lý hoặc hết hạn.' }).catch(e => console.error(e.message));
      return;
    }

    if (action === 'approve') {
      bot.answerCallbackQuery(query.id, { text: '✅ Đã duyệt ảnh!' }).catch(e => console.error(e.message));
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(e => console.error(e.message));
      bot.sendMessage(chatId, `✅ Ảnh ${id} đã được duyệt thành công.`, { reply_to_message_id: msg.message_id }).catch(e => console.error(e.message));
      markImageDone(id, 'approved');
    } else if (action === 'delete') {
      bot.answerCallbackQuery(query.id, { text: '🗑️ Đang xóa bối cảnh...' }).catch(e => console.error(e.message));
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(e => console.error(e.message));
      await deletePromptFromConfig(imgData.prompt);
      bot.sendMessage(chatId, `🗑️ Đã xóa vĩnh viễn bối cảnh của ảnh ${id} khỏi hệ thống.`, { reply_to_message_id: msg.message_id }).catch(e => console.error(e.message));
      markImageDone(id, 'deleted');
    } else if (action === 'feedback') {
      bot.answerCallbackQuery(query.id).catch(e => console.error(e.message));
      reviewState.waitingFeedbackForId = id;
      bot.sendMessage(chatId, `💬 Vui lòng gõ tin nhắn nhận xét để AI sửa bức ảnh ${id}:`, { reply_to_message_id: msg.message_id }).catch(e => console.error(e.message));
    }
  });

  bot.on('message', async (msg) => {
    resetTimeout();
    if (!msg.text || !reviewState.waitingFeedbackForId) return;

    const id = reviewState.waitingFeedbackForId;
    reviewState.waitingFeedbackForId = null; // Clear state
    const imgData = reviewState.images.find(img => img.id === id);

    if (imgData) {
      bot.sendMessage(chatId, `⏳ Đã nhận góp ý cho ảnh ${id}. Đang gửi cho ChatGPT sửa lại... (vui lòng chờ vài chục giây)`).catch(e => console.error(e.message));
      try {
        const feedbackMsg = `I am sending you 2 images:\n1. The FIRST image is the ORIGINAL PRODUCT (the watch with transparent/white background). You MUST keep this exact design.\n2. The SECOND image is the PREVIOUS AI generated image.\n\nThe user wants to modify the SECOND image with this feedback: "${msg.text}".\n\nPlease redraw the scene completely according to the feedback, BUT MAKE SURE the watch looks EXACTLY like the FIRST image (same colors, same dial, same strap).`;
        const newPaths = await generateBackgroundOnChatGPT([reviewState.watchImagePath, imgData.path], [feedbackMsg], null, reviewState.sampleImagePath, false);
        
        if (newPaths && newPaths.length > 0) {
          const newPath = newPaths[0];
          imgData.path = newPath; // Cập nhật ảnh mới
          bot.sendPhoto(chatId, fs.createReadStream(newPath), {
            caption: `✅ Ảnh ${id} ĐÃ ĐƯỢC SỬA XONG!\nPrompt gốc: ${imgData.prompt.substring(0, 100)}...`,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Duyệt', callback_data: `approve_${id}` },
                  { text: '💬 Sửa lại', callback_data: `feedback_${id}` },
                  { text: '🗑️ Xóa cảnh', callback_data: `delete_${id}` }
                ]
              ]
            }
          }, { filename: 'image.png', contentType: 'image/png' }).catch(e => console.error(e.message));
        }
      } catch (err) {
        bot.sendMessage(chatId, `❌ Lỗi khi sửa ảnh: ${err.message}`);
      }
    }
  });
};

const markImageDone = (id, status) => {
  const imgData = reviewState.images.find(img => img.id === id);
  if (imgData && imgData.status === 'pending') {
    imgData.status = status;
    reviewState.pendingCount--;
    if (reviewState.pendingCount <= 0) {
      // Đã duyệt xong toàn bộ
      askForNextBatch();
    }
  }
};

const askForNextBatch = () => {
  if (!bot) return;
  bot.sendMessage(chatId, `🎉 Bác đã duyệt xong lượt 10 ảnh này!\n\n▶️ Bác có muốn Train tiếp lượt 10 ảnh nữa không? (Hệ thống sẽ tự ngưng sau 1 tiếng nếu không phản hồi)`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '▶️ Chạy tiếp 10 ảnh', callback_data: 'action_continue' },
          { text: '⏸️ Nghỉ ngơi', callback_data: 'action_pause' }
        ]
      ]
    }
  });
  resetTimeout();
};

export const sendBatchToTelegram = async (images, watchImagePath, sampleImagePath) => {
  if (!bot || !chatId) return;

  reviewState.activeSession = true;
  reviewState.pendingCount = images.length;
  reviewState.images = images.map((img, index) => ({
    id: index + 1,
    path: img.path,
    prompt: img.prompt,
    status: 'pending'
  }));
  reviewState.watchImagePath = watchImagePath;
  reviewState.sampleImagePath = sampleImagePath;
  reviewState.waitingFeedbackForId = null;

  bot.sendMessage(chatId, `🚀 <b>Đã tạo xong ${images.length} ảnh!</b>\nMời bác chấm điểm từng ảnh:`, { parse_mode: 'HTML' });

  for (let i = 0; i < images.length; i++) {
    const img = reviewState.images[i];
    try {
      const photoData = fs.createReadStream(img.path);
      await bot.sendPhoto(chatId, photoData, {
        caption: `📸 <b>Ảnh ${img.id}</b>\nPrompt: ${img.prompt.substring(0, 100)}...`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Duyệt', callback_data: `approve_${img.id}` },
              { text: '💬 Nhận xét', callback_data: `feedback_${img.id}` },
              { text: '🗑️ Xóa cảnh', callback_data: `delete_${img.id}` }
            ]
          ]
        }
      }, { filename: 'image.png', contentType: 'image/png' });
      
      // Nghỉ 2 giây giữa mỗi ảnh để tránh sập connection / Telegram Rate Limit
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
      console.error(`❌ Lỗi gửi ảnh ${img.id} lên Telegram:`, e.message);
    }
  }
  
  resetTimeout();
};

const resetTimeout = () => {
  if (reviewState.timeoutTimer) clearTimeout(reviewState.timeoutTimer);
  reviewState.timeoutTimer = setTimeout(() => {
    if (bot && reviewState.activeSession) {
      bot.sendMessage(chatId, `⏱️ <b>Hệ thống đóng băng!</b>\nBác đã không tương tác quá 1 tiếng. Quá trình Train AI đã tạm ngưng.\nBấm "Chạy tiếp" bất cứ lúc nào bác quay lại nhé!`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '▶️ Đánh thức hệ thống', callback_data: 'action_continue' }]]
        }
      });
      telegramEvents.emit('stop_training');
      reviewState.activeSession = false;
    }
  }, TIMEOUT_MS);
};

// Hàm hỗ trợ xóa prompt
const deletePromptFromConfig = async (promptText) => {
  try {
    const promptGuidePath = path.join(__dirname, '../../config/gpt_image_prompt.md');
    if (!fs.existsSync(promptGuidePath)) return;
    let mdContent = fs.readFileSync(promptGuidePath, 'utf8');
    const escapedPrompt = promptText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
    const regex = new RegExp(`###[\\s\\S]*?>\\s*${escapedPrompt}[\\s\\S]*?(?=\\n###|\\n## |$)`, 'i');
    if (regex.test(mdContent)) {
      mdContent = mdContent.replace(regex, '\n\n');
      fs.writeFileSync(promptGuidePath, mdContent.trim() + '\n');
    }
  } catch (err) {
    console.error('Lỗi xóa prompt qua Telegram:', err);
  }
};
