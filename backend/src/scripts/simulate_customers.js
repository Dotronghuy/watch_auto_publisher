import 'dotenv/config';
import { runGeminiText } from '../services/chatbot.service.js';
import { saveConversation, saveMessage, getMessagesByConversation } from '../utils/crm.db.js';
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const simulateConversation = async (persona, index) => {
  const conversationId = `sim_conv_${Date.now()}_${index}`;
  const senderId = `sim_user_${Date.now()}_${index}`;
  
  // Tạo conversation ảo trong DB
  saveConversation(
    conversationId,
    'facebook',
    'simulation',
    `Auto Customer ${index}`,
    senderId,
    'Bắt đầu chat',
    new Date().toISOString(),
    'sim_account'
  );

  console.log(`\n=================================================`);
  console.log(`BẮT ĐẦU MÔ PHỎNG #${index}: ${persona}`);
  console.log(`=================================================\n`);

  const customerSystemPrompt = `Bạn đóng vai một người mua hàng bình thường ở Việt Nam trên fanpage đồng hồ. 
Tính cách của bạn: ${persona}.
Hãy chat bằng tiếng Việt, ngắn gọn (1-2 câu), tự nhiên như người dùng mạng xã hội thật. 
Bắt đầu bằng một câu chào hoặc hỏi mua đồng hồ.
LƯU Ý QUAN TRỌNG: 
1. NGÔN NGỮ GIAO TIẾP DUY NHẤT LÀ TIẾNG VIỆT. Bạn có thể dùng một số từ Tiếng Anh thông dụng (như: Shop, Sale, Size, Freeship, Fullbox).
2. BẠN KHÔNG HỀ BIẾT VÀ KHÔNG ĐƯỢC PHÉP SỬ DỤNG BẤT KỲ NGÔN NGỮ NÀO KHÁC NGOÀI TIẾNG VIỆT VÀ TIẾNG ANH.
3. KHÔNG ĐƯỢC DỊCH HAY GIẢI THÍCH Ở DƯỚI.
CHỈ TRẢ VỀ ĐÚNG CÂU NÓI CỦA KHÁCH HÀNG.`;

  let chatHistory = [
    { role: 'system', content: customerSystemPrompt }
  ];

  const callGemini = async (promptMsg) => {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      systemInstruction: { parts: [{ text: customerSystemPrompt }] }
    });

    chatHistory.push({ role: 'user', text: promptMsg });

    // Chuyển chatHistory sang format Gemini SDK
    const geminiHistory = chatHistory.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : msg.role,
      parts: [{ text: msg.text || msg.content || '' }]
    })).filter(m => m.role === 'user' || m.role === 'model');

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(promptMsg);
    const content = result.response.text();
    chatHistory.push({ role: 'assistant', text: content });
    return content;
  };

  // Lặp 4 lượt chat
  for (let turn = 1; turn <= 4; turn++) {
    // 1. Khách hàng ảo nói chuyện
    const prompt = turn === 1 ? 'Bắt đầu chat đi' : 'Chủ shop vừa trả lời bạn. Hãy đáp lại tự nhiên theo tính cách của bạn.';
    const customerText = (await callGemini(prompt)).trim();
    
    console.log(`👤 KHÁCH HÀNG: ${customerText}`);
    
    // Lưu tin nhắn khách vào DB
    saveMessage(`msg_c_${Date.now()}`, conversationId, customerText, false, new Date().toISOString());

    // 2. Chatbot của hệ thống trả lời
    const historyRows = await getMessagesByConversation(conversationId);
    const recentHistory = historyRows.slice(-10);
    
    let botReply = '';
    try {
      botReply = await runGeminiText(recentHistory, customerText);
    } catch (err) {
      console.error('Lỗi khi Bot xử lý:', err.message);
      break;
    }

    console.log(`🤖 BOT BÁN HÀNG: ${botReply}\n`);
    
    // Lưu tin nhắn Bot vào DB
    saveMessage(`msg_b_${Date.now()}`, conversationId, botReply, true, new Date().toISOString());
    
    // Đưa câu trả lời của Bot ngược lại cho Khách hàng ảo đọc để nó chuẩn bị nói câu tiếp theo
    chatHistory.push({ role: 'user', content: `Chủ shop trả lời: "${botReply}"` });
    
    // Nếu Bot chốt được đơn, có thể kết thúc sớm
    if (botReply.toLowerCase().includes('xác nhận đơn') || botReply.toLowerCase().includes('đã lên đơn')) {
      console.log('✅ ĐÃ CHỐT ĐƠN THÀNH CÔNG! Kết thúc sớm cuộc hội thoại.');
      break;
    }
    
    await sleep(2000); // Tránh rate limit API
  }
};

const runSimulation = async () => {
  console.log('🚀 Đang khởi động trình mô phỏng khách hàng tự động (Chạy liên tục 30 phút)...');
  
  const startTime = Date.now();
  const DURATION_MS = 30 * 60 * 1000; // 30 phút
  let sessionCount = 1;

  while (Date.now() - startTime < DURATION_MS) {
    console.log(`\n=================================================`);
    console.log(`BẮT ĐẦU PHIÊN CHAT THỨ ${sessionCount}`);
    
    // Chọn ngẫu nhiên 1 tính cách để chat
    const randomIndex = Math.floor(Math.random() * PERSONAS.length);
    const selectedPersona = PERSONAS[randomIndex];
    
    await simulateConversation(selectedPersona, sessionCount);
    
    console.log(`🎉 Kết thúc phiên thứ ${sessionCount}. Đang đợi 15 giây để tạo khách tiếp theo...`);
    
    // Nghỉ 15 giây trước khi tạo khách mới (tránh spam API quá lố)
    await sleep(15000);
    sessionCount++;
  }
  
  console.log('🎉 Đã hết 30 phút. Trình mô phỏng tự động kết thúc!');
};

runSimulation();
