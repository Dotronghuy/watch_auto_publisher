import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const test = async () => {
  try {
    const catalogData = fs.readFileSync('./data/catalog.json', 'utf8');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json' } });
    
    const fetch = (await import('node-fetch')).default || global.fetch;
    const res = await fetch('https://sapo.dktcdn.net/100/818/829/variants/10-1765617156990.jpg');
    const buffer = await res.arrayBuffer();
    const b64 = Buffer.from(buffer).toString('base64');
    const imagePart = { inlineData: { data: b64, mimeType: 'image/jpeg' } };
    
    const prompt1 = `Bạn là chuyên gia tư vấn đồng hồ. Khách hàng gửi ảnh (có thể là ảnh chụp màn hình). Lời nhắn: "".
Hãy đọc chữ trong ảnh và phân tích ngoại hình đồng hồ.
Dưới đây là danh sách sản phẩm (JSON):
${catalogData}

Nhiệm vụ: Tìm tối đa 5 mã SKU có khả năng khớp nhất với đồng hồ trong ảnh.
Trả về JSON định dạng:
{
  "candidates": ["SKU1", "SKU2"],
  "message": "Nếu không tìm thấy ứng viên nào, hãy viết câu trả lời thân thiện cho khách (ví dụ: xin thêm thông tin, hỏi mức giá)"
}`;
    
    console.log('Generating stage 1 with real image...');
    const result1 = await model.generateContent([prompt1, imagePart]);
    console.log('Result 1:', result1.response.text());
  } catch(e) {
    console.log('ERROR:', e.message);
  }
};
test();
