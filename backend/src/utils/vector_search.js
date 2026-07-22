import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VECTOR_STORE_PATH = path.join(__dirname, '../../data/vector_store.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const EMBEDDING_MODEL = 'gemini-embedding-2';
let vectorStoreCache = null;
let vectorStoreMtimeMs = 0;

const getVectorStore = () => {
  const stat = fs.statSync(VECTOR_STORE_PATH);
  if (!vectorStoreCache || stat.mtimeMs !== vectorStoreMtimeMs) {
    vectorStoreCache = JSON.parse(fs.readFileSync(VECTOR_STORE_PATH, 'utf8'));
    vectorStoreMtimeMs = stat.mtimeMs;
  }
  return vectorStoreCache;
};

// Tính Cosine Similarity giữa 2 vector
const cosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

// Embed text bằng Gemini API
export const embedText = async (text) => {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(text);
  return result.embedding.values;
};

export const searchKnowledge = async (query, topK = 3) => {
  if (!fs.existsSync(VECTOR_STORE_PATH)) {
    console.warn('⚠️ Không tìm thấy vector_store.json, vui lòng chạy script embed_knowledge.js');
    return [];
  }

  let vectorStore = [];
  try {
    vectorStore = getVectorStore();
  } catch (error) {
    console.error('Lỗi đọc vector store:', error);
    return [];
  }

  if (vectorStore.length === 0) return [];

  let queryVector = [];
  try {
    queryVector = await embedText(query);
  } catch (error) {
    console.error('Lỗi khi embed câu hỏi qua Gemini:', error.message);
    return [];
  }

  // Tính similarity cho từng chunk
  const scoredChunks = vectorStore.map(chunk => ({
    text: chunk.text,
    score: cosineSimilarity(queryVector, chunk.embedding)
  }));

  // Sắp xếp giảm dần theo điểm số
  scoredChunks.sort((a, b) => b.score - a.score);

  // Lấy top K
  return scoredChunks.slice(0, topK).map(chunk => chunk.text);
};
