import { getConversations, getMessagesByConversation } from '../utils/crm.db.js';
import { addBotMemory } from '../services/chatbot-memory.service.js';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const analyzeConversation = async (conversationText) => {
  const prompt = `Bạn là một chuyên gia phân tích hội thoại khách hàng.
Hãy đọc đoạn chat sau giữa khách hàng và nhân viên tư vấn (Bot).
Đánh giá xem cuộc trò chuyện này có thành công không (khách đã mua hàng, chốt đơn, hoặc phản hồi rất tích cực).
Nếu thành công, hãy đúc kết ra 1 quy tắc (bài học) NGẮN GỌN về cách giao tiếp/tư vấn để có thể áp dụng cho các khách hàng khác sau này.
CHÚ Ý QUAN TRỌNG: TRẢ LỜI ĐỊNH DẠNG JSON HỢP LỆ VÀ 100% TIẾNG VIỆT. Không xuất ra gì khác ngoài JSON.

JSON Schema:
{
  "is_successful": boolean (true nếu chốt đơn/hài lòng, false nếu không),
  "learning_rule": "Quy tắc đúc kết (1 câu)",
  "reason": "Lý do tại sao thành công"
}

--- ĐOẠN CHAT ---
${conversationText}
--- KẾT THÚC ---
`;

  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });
    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();
    if (text.startsWith('\`\`\`json')) {
      text = text.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
    }
    
    return JSON.parse(text);
  } catch (err) {
    console.error('Lỗi khi phân tích:', err.message);
    return { is_successful: false };
  }
};

const runSelfLearning = async () => {
  console.log('🚀 Bắt đầu quá trình Tự học từ lịch sử chat...');
  
  try {
    const conversations = await getConversations();
    console.log(`Tìm thấy ${conversations.length} cuộc hội thoại.`);
    
    let learnedCount = 0;
    
    for (const conv of conversations) {
      if (!conv.id.startsWith('sim_conv_')) continue;
      
      const messages = await getMessagesByConversation(conv.id);
      if (messages.length < 3) continue;
      
      const chatText = messages.map(m => `${m.is_from_page ? 'Bot' : 'Khách'}: ${m.message}`).join('\n');
      
      console.log(`\nĐang phân tích hội thoại [${conv.id}]...`);
      const analysis = await analyzeConversation(chatText);
      
      if (analysis.is_successful && analysis.learning_rule) {
        console.log(`💡 TÌM THẤY BÀI HỌC MỚI: ${analysis.learning_rule}`);
        console.log(`   Lý do: ${analysis.reason}`);
        
        await addBotMemory({
          type: 'approved_reply',
          content: analysis.learning_rule,
          metadata: { note: analysis.reason, source: conv.id }
        });
        
        console.log('✅ Đã nạp bài học vào Vector Database!');
        learnedCount++;
      } else {
        console.log('❌ Không có bài học nào được đúc kết từ hội thoại này.');
      }
    }
    
    console.log(`\n🎉 Quá trình tự học hoàn tất! Đã đúc kết được ${learnedCount} bài học mới.`);
    process.exit(0);
  } catch (error) {
    console.error('Lỗi trong quá trình tự học:', error);
    process.exit(1);
  }
};

runSelfLearning();
