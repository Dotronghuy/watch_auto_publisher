import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });
const KNOWLEDGE_PATH = path.join(__dirname, '../../config/chatbot-knowledge.md');
const VECTOR_STORE_PATH = path.join(__dirname, '../../data/vector_store.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Hàm để chia nhỏ markdown thành các chunk
const chunkMarkdown = (content) => {
  const lines = content.split('\n');
  const chunks = [];
  let currentChunk = '';

  for (const line of lines) {
    if (line.startsWith('## ') || line.startsWith('### ') || line.startsWith('#### Q:')) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  // Kết hợp những chunk quá nhỏ (< 50 ký tự) vào chunk trước đó
  const mergedChunks = [];
  for (const chunk of chunks) {
    if (chunk.length < 50 && mergedChunks.length > 0 && !chunk.startsWith('#### Q:')) {
      mergedChunks[mergedChunks.length - 1] += '\n\n' + chunk;
    } else {
      mergedChunks.push(chunk);
    }
  }

  return mergedChunks;
};

const delay = (ms) => new Promise(res => setTimeout(res, ms));

const main = async () => {
  console.log('🚀 Bắt đầu quá trình biến đổi Kiến thức thành Vector (Embedding)...');

  if (!fs.existsSync(KNOWLEDGE_PATH)) {
    console.error('❌ Không tìm thấy tệp chatbot-knowledge.md tại', KNOWLEDGE_PATH);
    return;
  }

  const content = fs.readFileSync(KNOWLEDGE_PATH, 'utf8');
  let chunks = chunkMarkdown(content);
  console.log(`Đã chia nhỏ văn bản kiến thức thành ${chunks.length} phần (chunks).`);

  const catalogPath = path.join(__dirname, '../../data/catalog.json');
  if (fs.existsSync(catalogPath)) {
    try {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      console.log(`Tìm thấy ${catalog.length} sản phẩm trong catalog.json. Đang thêm vào kiến thức AI...`);
      for (const prod of catalog) {
        let prodText = `SẢN PHẨM: ${prod['Tên sản phẩm'] || prod.name || 'Chưa rõ'}\n`;
        const skipKeys = ['Tên sản phẩm', 'name', 'Ảnh sản phẩm', 'imageUrl'];
        
        for (const key of Object.keys(prod)) {
          if (!skipKeys.includes(key) && prod[key]) {
            prodText += `${key}: ${prod[key]}\n`;
          }
        }

        if (prod.imageUrl) {
          prodText += `Link ảnh: ${prod.imageUrl}\n`;
        }
        
        chunks.push(prodText.trim());
      }
      console.log(`Tổng cộng có ${chunks.length} chunks sau khi gộp sản phẩm.`);
    } catch (e) {
      console.error('Lỗi khi đọc catalog.json:', e.message);
    }
  } else {
    console.warn('Không tìm thấy catalog.json, bỏ qua dữ liệu sản phẩm.');
  }

  const EMBEDDING_MODEL = 'gemini-embedding-2';

  const vectorStore = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
      const result = await model.embedContent(chunk);
      const embedding = result.embedding.values;
      
      vectorStore.push({
        id: i,
        text: chunk,
        embedding: embedding
      });
      console.log(`Đã xử lý vector cho phần ${i + 1}/${chunks.length}`);
      
      // Rate limiting: 1 request mỗi 100ms để tránh bị Gemini API từ chối
      await delay(100);
    } catch (error) {
      console.error(`❌ Lỗi khi lấy embedding cho phần ${i + 1}:`, error.message);
      // Nếu bị rate limit, chờ 5 giây rồi thử lại
      if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
        console.log('⏳ Đang chờ 5 giây do rate limit...');
        await delay(5000);
        i--; // Thử lại chunk hiện tại
      }
    }
  }

  const dataDir = path.dirname(VECTOR_STORE_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(VECTOR_STORE_PATH, JSON.stringify(vectorStore, null, 2), 'utf8');
  console.log(`✅ Quá trình tạo Vector hoàn tất! Đã lưu tại: ${VECTOR_STORE_PATH}`);
};

main();
