import { getConversations, getMessagesByConversation } from '../utils/crm.db.js';
import { generateContentOnChatGPT } from './playwright.service.js';
import { addBotMemory } from './chatbot-memory.service.js';

const runNightlySelfLearning = async () => {
  console.log('🌙 [Self-Learning] Bắt đầu quá trình Tự học ban đêm...');
  
  try {
    const allConvs = await getConversations();
    
    // Lấy các cuộc trò chuyện trong 24h qua
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const recentConvs = allConvs.filter(c => new Date(c.updated_at) > yesterday);
    console.log(`🌙 [Self-Learning] Tìm thấy ${recentConvs.length} cuộc hội thoại mới trong 24h qua.`);
    
    if (recentConvs.length === 0) {
      console.log('🌙 [Self-Learning] Không có dữ liệu mới để học. Kết thúc.');
      return;
    }
    
    let chatLogsToAnalyze = '';
    
    for (const conv of recentConvs) {
      const messages = await getMessagesByConversation(conv.id);
      if (messages.length >= 3) {
        chatLogsToAnalyze += `\n--- Cuộc trò chuyện ${conv.id} ---\n`;
        for (const msg of messages) {
          const role = msg.is_from_page ? 'Bot' : 'Khách';
          chatLogsToAnalyze += `${role}: ${msg.message}\n`;
        }
      }
    }
    
    if (!chatLogsToAnalyze.trim()) {
      console.log('🌙 [Self-Learning] Các cuộc hội thoại quá ngắn, không đủ dữ liệu học. Kết thúc.');
      return;
    }
    
    const prompt = `Bạn là một chuyên gia đào tạo Chatbot bán hàng (QA Analyst).
Nhiệm vụ của bạn là đọc các đoạn log chat sau đây và đúc kết ra các bài học kinh nghiệm để Chatbot bán hàng tốt hơn.
Dữ liệu chat:
${chatLogsToAnalyze.substring(0, 8000)}

Hãy phân tích và trả về cho tôi một mảng JSON (CHỈ TRẢ VỀ JSON, KHÔNG CÓ MARKDOWN HAY CHỮ NÀO KHÁC BÊN NGOÀI).
Cấu trúc JSON:
[
  {
    "type": "approved_reply", // hoặc "bad_reply", "writing_rule"
    "content": "Nội dung câu nói xuất sắc cần lưu lại hoặc nguyên tắc cần nhớ",
    "metadata": { "note": "Lý do vì sao câu này tốt/xấu" }
  }
]
`;

    console.log('🌙 [Self-Learning] Đang gửi dữ liệu cho ChatGPT qua Playwright phân tích...');
    const chatGptResponse = await generateContentOnChatGPT(prompt, 'learning');
    
    // Lọc lấy JSON từ response của ChatGPT (bỏ qua các markdown ```json ... ```)
    const jsonMatch = chatGptResponse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const lessons = JSON.parse(jsonMatch[0]);
      console.log(`🌙 [Self-Learning] ChatGPT đã đúc kết được ${lessons.length} bài học! Đang nạp vào bộ nhớ...`);
      
      let successCount = 0;
      for (const lesson of lessons) {
        try {
          await addBotMemory({
            type: lesson.type,
            content: lesson.content,
            metadata: lesson.metadata
          });
          successCount++;
        } catch (e) {
          console.error('Lỗi khi nạp memory:', e.message);
        }
      }
      console.log(`🌙 [Self-Learning] Đã nạp thành công ${successCount}/${lessons.length} bài học vào Vector Database.`);
    } else {
      console.log('🌙 [Self-Learning] Lỗi: Không thể trích xuất JSON từ câu trả lời của ChatGPT.');
      console.log(chatGptResponse);
    }
    
  } catch (error) {
    console.error('🌙 [Self-Learning] Lỗi trong quá trình tự học:', error);
  }
};

export { runNightlySelfLearning };
