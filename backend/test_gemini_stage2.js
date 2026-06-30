import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const test = async () => {
  try {
    const { getAllProductsWithImages } = await import('./src/services/sheet.service.js');
    const allProducts = await getAllProductsWithImages();
    const candidateImages = allProducts.filter(p => ["55883G-D10", "55883G-D5"].includes(p.sku));
    
    console.log("Found candidate images:", candidateImages.length);
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json' } });
    
    // Fake client image
    const clientBuf = fs.readFileSync('./data/catalog.json'); // just any buffer, wait no, let's use a real image
    const fetch = (await import('node-fetch')).default || global.fetch;
    const clientRes = await fetch('https://sapo.dktcdn.net/100/818/829/variants/10-1765617156990.jpg'); // just use the red watch itself
    const clientBuffer = await clientRes.arrayBuffer();
    
    const imageParts2 = [
      { inlineData: { data: Buffer.from(clientBuffer).toString('base64'), mimeType: 'image/jpeg' } }
    ];
    
    let index = 1;
    const candidateIndexMap = {};
    for (const c of candidateImages) {
        const res = await fetch(c.imageUrl);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          imageParts2.push({ inlineData: { data: Buffer.from(buf).toString("base64"), mimeType: 'image/jpeg' } });
          candidateIndexMap[index] = c.sku;
          index++;
        }
    }
    
    const prompt2 = `Ảnh đầu tiên (index 0) là ảnh khách gửi. Các ảnh tiếp theo (từ index 1 trở đi) là ảnh gốc của các mẫu: ${Object.values(candidateIndexMap).join(', ')}.
Nhiệm vụ: So sánh ảnh khách gửi (index 0) với các ảnh còn lại.
Trích xuất mã SKU khớp NHẤT (giống nhất về kiểu dáng, màu sắc mặt số, dây đeo).
Chỉ trả về JSON định dạng: { "sku": "Mã SKU khớp" }. Nếu không có ảnh nào khớp, trả về { "sku": null }.`;

    console.log('Generating content for stage 2...');
    const result2 = await model.generateContent([prompt2, ...imageParts2]);
    console.log('Result 2:', result2.response.text());
  } catch(e) {
    console.log('ERROR:', e.message);
  }
};
test();
