import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initCRMDB, getApprovedConversations, getMessagesByConversation } from '../utils/crm.db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASET_DIR = path.join(__dirname, '../../dataset');
const OUTPUT_FILE = path.join(DATASET_DIR, 'qwen_dataset.jsonl');

const SYSTEM_PROMPT = "Bạn là một nhân viên tư vấn bán hàng chuyên nghiệp, nhiệt tình, lịch sự và luôn sử dụng tiếng Việt chuẩn. Bạn biết cách chốt sale và giải quyết khiếu nại.";

const exportDataset = async () => {
  console.log('🚀 Bắt đầu trích xuất Dataset ShareGPT...');
  await initCRMDB();
  
  if (!fs.existsSync(DATASET_DIR)) {
    fs.mkdirSync(DATASET_DIR, { recursive: true });
  }

  try {
    const approvedConvs = await getApprovedConversations();
    console.log(`Tìm thấy ${approvedConvs.length} cuộc hội thoại đã duyệt.`);
    
    if (approvedConvs.length === 0) {
      console.log('⚠️ Không có dữ liệu. Bạn cần click duyệt (Approve) các cuộc chat thành công trên Dashboard trước.');
      // Giả lập 1 mẫu để test nếu chưa có
      console.log('Tạo 1 mẫu giả lập để test...');
      approvedConvs.push({ id: 'dummy_1', sender_name: 'Khách hàng' });
    }

    const jsonlLines = [];

    for (const conv of approvedConvs) {
      let messages = [];
      if (conv.id === 'dummy_1') {
        messages = [
          { is_from_page: 0, message: "Shop ơi mẫu Hublot này bao nhiêu tiền vậy?" },
          { is_from_page: 1, message: "Dạ mẫu Hublot Classic Fusion này bên em đang sale còn 2.500.000đ anh nhé. Không biết anh/chị cần ship về đâu ạ?" },
          { is_from_page: 0, message: "Ship Hà Nội nha, có free ship không?" },
          { is_from_page: 1, message: "Dạ miễn phí giao hàng toàn quốc anh nha. Anh cho em xin tên, sđt và địa chỉ để em lên đơn ạ!" }
        ];
      } else {
        const dbMsgs = await getMessagesByConversation(conv.id);
        // Sắp xếp theo thời gian cũ nhất lên trước
        messages = dbMsgs.sort((a, b) => new Date(a.created_time) - new Date(b.created_time));
      }

      if (messages.length < 2) continue;

      // Chuyển đổi sang định dạng ShareGPT
      const conversations = [];
      for (const msg of messages) {
        conversations.push({
          from: msg.is_from_page ? "assistant" : "user",
          value: msg.message
        });
      }

      const row = {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...conversations.map(c => ({
            role: c.from,
            content: c.value
          }))
        ]
      };

      jsonlLines.push(JSON.stringify(row));
    }

    fs.writeFileSync(OUTPUT_FILE, jsonlLines.join('\n'));
    console.log(`✅ Đã xuất thành công ${jsonlLines.length} hội thoại ra file: ${OUTPUT_FILE}`);
    console.log(`Bạn có thể tải file này lên Google Colab để huấn luyện mô hình (Unsloth/LLaMA-Factory).`);
    
    process.exit(0);
  } catch (err) {
    console.error('Lỗi trích xuất dataset:', err);
    process.exit(1);
  }
};

exportDataset();
