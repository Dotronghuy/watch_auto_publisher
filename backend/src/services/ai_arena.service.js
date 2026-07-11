import 'dotenv/config';
import { runGeminiText } from './chatbot.service.js';
import { saveConversation, saveMessage, getMessagesByConversation } from '../utils/crm.db.js';
import { EventEmitter } from 'events';

export const arenaEmitter = new EventEmitter();

let isArenaRunning = false;
let currentArenaLoop = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PERSONAS = [
  "Khách hàng khó tính, đòi hỏi thông số kỹ thuật chi tiết, hay nghi ngờ hàng giả, hỏi liên tục về thẻ bảo hành và hộp đựng.",
  "Khách hàng sành sỏi, thích mặc cả, luôn đòi giảm giá hoặc hỏi có tặng thêm dây da/pin dự phòng không.",
  "Khách hàng vội vàng, chỉ muốn biết giá tổng cộng bao nhiêu và cách đặt hàng nhanh nhất, chat cụt lủn, không thích đọc dài.",
  "Khách hàng ngây thơ, không rành về đồng hồ cơ/pin, cần tư vấn từ A-Z để mua làm quà sinh nhật cho bạn trai.",
  "Khách hàng hay so sánh, liên tục bảo rằng shop ABC bên cạnh bán rẻ hơn 200k, yêu cầu shop giải thích tại sao đắt hơn.",
  "Khách hàng ở tỉnh xa, rất quan tâm đến phí ship và thời gian giao hàng, sợ bị lừa tiền cọc nên bắt phải cho kiểm hàng mới nhận.",
  "Khách hàng đang xỉn hoặc đùa giỡn, nhắn tin không dấu, sai chính tả tè le, hay hỏi những câu không liên quan đến đồng hồ.",
  "Khách hàng giàu có nhưng chảnh, chỉ quan tâm hàng đắt tiền nhất shop, hỏi mẫu nào hot trend giới thượng lưu đang đeo.",
  "Khách hàng học sinh/sinh viên, rất thích mẫu đồng hồ xịn nhưng ngân sách hạn hẹp, cứ kì kèo hỏi có hỗ trợ trả góp không.",
  "Khách hàng tò mò, hỏi hết mẫu này đến mẫu khác, xin ảnh chụp cận cảnh từng ngóc ngách nhưng mã nào cũng chê một chút rồi chưa chịu mua ngay."
];

import { GoogleGenerativeAI } from '@google/generative-ai';

const arenaGenAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Hàm sinh một tính cách mới hoàn toàn ngẫu nhiên bằng AI
const generateRandomPersona = async () => {
  try {
    const model = arenaGenAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(
      'Hãy nghĩ ra một tính cách (persona) độc đáo cho 1 người khách hàng mua đồng hồ online. Chỉ trả về đúng 1 câu ngắn gọn bằng tiếng Việt. KHÔNG dùng bất kỳ ngôn ngữ nào khác.'
    );
    return result.response.text().trim();
  } catch (err) {
    return PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
  }
};

const runArenaLoop = async () => {
  let matchCount = 1;
  while (isArenaRunning) {
    // 1. Sinh persona ngẫu nhiên
    const isAiGeneratedPersona = Math.random() > 0.5;
    const persona = isAiGeneratedPersona ? await generateRandomPersona() : PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
    
    arenaEmitter.emit('arena_event', { type: 'match_start', matchCount, persona });
    
    const conversationId = `arena_conv_${Date.now()}`;
    const senderId = `arena_user_${Date.now()}`;
    
    // Lưu vào DB để có thể dùng xuất Dataset sau này
    saveConversation(
      conversationId,
      'facebook',
      'arena',
      `Arena Customer #${matchCount}`,
      senderId,
      'Bắt đầu giả lập',
      new Date().toISOString(),
      'sim_account'
    );

    const customerSystemPrompt = `Bạn đóng vai một người mua hàng trên fanpage đồng hồ. 
Tính cách của bạn: ${persona}.
Hãy chat bằng tiếng Việt, ngắn gọn (1-2 câu), tự nhiên như người dùng mạng xã hội thật. 
Bắt đầu bằng một câu chào hoặc hỏi mua đồng hồ.
LƯU Ý QUAN TRỌNG: 
1. NGÔN NGỮ GIAO TIẾP DUY NHẤT LÀ TIẾNG VIỆT. Bạn có thể dùng một số từ Tiếng Anh thông dụng (như: Shop, Sale, Size, Freeship, Fullbox).
2. BẠN KHÔNG HỀ BIẾT VÀ KHÔNG ĐƯỢC PHÉP SỬ DỤNG BẤT KỲ NGÔN NGỮ NÀO KHÁC NGOÀI TIẾNG VIỆT VÀ TIẾNG ANH.`;

    let chatHistory = [];

    const callCustomerAI = async (promptMsg) => {
      const model = arenaGenAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        systemInstruction: { parts: [{ text: customerSystemPrompt }] }
      });

      chatHistory.push({ role: 'user', parts: [{ text: promptMsg }] });

      // Lọc history hợp lệ (chỉ user/model)
      const validHistory = chatHistory.slice(0, -1).filter(m => m.role === 'user' || m.role === 'model');

      const chat = model.startChat({ history: validHistory });
      const result = await chat.sendMessage(promptMsg);
      const content = result.response.text();
      chatHistory.push({ role: 'model', parts: [{ text: content }] });
      return content;
    };

    let turns = Math.floor(Math.random() * 4) + 4; // Chat 4-7 lượt
    for (let turn = 1; turn <= turns; turn++) {
      if (!isArenaRunning) break;

      // Khách hàng nói
      arenaEmitter.emit('arena_event', { type: 'status', message: 'Khách hàng ảo đang gõ...' });
      const customerPrompt = turn === 1 ? 'Bắt đầu chat đi' : 'Chủ shop vừa trả lời bạn. Hãy đáp lại tự nhiên theo tính cách của bạn.';
      let customerText = '';
      try {
        customerText = (await callCustomerAI(customerPrompt)).trim();
      } catch (err) {
        console.error('Customer AI error:', err);
        break;
      }

      saveMessage(`msg_c_${Date.now()}`, conversationId, customerText, false, new Date().toISOString());
      arenaEmitter.emit('arena_event', { type: 'chat', role: 'customer', text: customerText, conversationId });

      await sleep(1000);
      if (!isArenaRunning) break;

      // Bot trả lời
      arenaEmitter.emit('arena_event', { type: 'status', message: 'Bot đang phân tích...' });
      const historyRows = await getMessagesByConversation(conversationId);
      const recentHistory = historyRows.slice(-10);
      
      let botReply = '';
      try {
        botReply = await runGeminiText(recentHistory, customerText);
      } catch (err) {
        console.error('Lỗi khi Bot xử lý:', err.message);
        botReply = 'Xin lỗi, hệ thống bị nghẽn một chút.';
      }

      saveMessage(`msg_b_${Date.now()}`, conversationId, botReply, true, new Date().toISOString());
      arenaEmitter.emit('arena_event', { type: 'chat', role: 'bot', text: botReply, conversationId });
      
      chatHistory.push({ role: 'user', parts: [{ text: `Chủ shop trả lời: "${botReply}"` }] });

      if (botReply.toLowerCase().includes('chốt đơn') || botReply.toLowerCase().includes('đã lên đơn')) {
        break;
      }
      
      await sleep(1500);
    }
    
    arenaEmitter.emit('arena_event', { type: 'match_end', matchCount, conversationId });
    matchCount++;
    await sleep(3000); // Nghỉ giữa các trận đấu
  }
};

export const startArena = () => {
  if (isArenaRunning) return false;
  isArenaRunning = true;
  currentArenaLoop = runArenaLoop();
  return true;
};

export const stopArena = () => {
  if (!isArenaRunning) return false;
  isArenaRunning = false;
  arenaEmitter.emit('arena_event', { type: 'status', message: 'Đã dừng Đấu trường.' });
  return true;
};

export const getArenaStatus = () => isArenaRunning;
