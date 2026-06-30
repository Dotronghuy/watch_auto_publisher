import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const test = async () => {
  try {
    const catalogData = fs.readFileSync('./data/catalog.json', 'utf8');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json' } });
    
    const prompt1 = `Bạn là chuyên gia tư vấn đồng hồ. Khách hàng gửi ảnh. Trong ảnh có chữ "55883G" và chiếc đồng hồ có mặt số màu đỏ.
Dưới đây là danh sách sản phẩm (JSON):
${catalogData}

Nhiệm vụ: Tìm tối đa 5 mã SKU có khả năng khớp nhất với đồng hồ trong ảnh.
Trả về JSON định dạng:
{
  "candidates": ["SKU1", "SKU2"],
  "message": "Nếu không tìm thấy ứng viên nào, hãy viết câu trả lời thân thiện cho khách"
}`;
    
    console.log('Generating content...');
    const res = await model.generateContent(prompt1);
    console.log('Result:', res.response.text());
  } catch(e) {
    console.log('ERROR:', e.message);
  }
};
test();
