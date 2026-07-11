import dotenv from 'dotenv';
import { getBotMemoryItems, saveBotMemoryItem } from '../utils/crm.db.js';

dotenv.config();

const EMBEDDING_MODEL = 'nomic-embed-text';
const MAX_MEMORY_CONTENT_CHARS = 12000;

export const BOT_MEMORY_TYPES = Object.freeze([
  'approved_reply',
  'bad_reply',
  'hook_pattern',
  'writing_rule',
  'trend_pattern',
  'category_rule',
  'human_feedback'
]);

const BOT_MEMORY_TYPE_SET = new Set(BOT_MEMORY_TYPES);

export const normalizeBotMemoryType = (type = 'human_feedback') => {
  const cleanType = String(type || '').trim();
  return BOT_MEMORY_TYPE_SET.has(cleanType) ? cleanType : 'human_feedback';
};

const clipText = (value, maxChars = MAX_MEMORY_CONTENT_CHARS) => {
  const text = String(value || '').trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
};

export const parseBotMemoryMetadata = (metadata) => {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
};

const parseEmbedding = (embedding) => {
  if (Array.isArray(embedding)) return embedding;
  if (!embedding) return null;
  try {
    const parsed = JSON.parse(embedding);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const cosineSimilarity = (vecA, vecB) => {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) return 0;

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

const tokenize = (value) => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/i)
    .filter(token => token.length >= 2);
};

const lexicalSimilarity = (query, content) => {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;

  const contentTokens = new Set(tokenize(content));
  let matches = 0;
  queryTokens.forEach(token => {
    if (contentTokens.has(token)) matches += 1;
  });

  return matches / queryTokens.size;
};

export const embedBotText = async (text) => {
  const cleanText = clipText(text, 4000);
  if (!cleanText) return null;

  try {
    const { embedText } = await import('../utils/vector_search.js');
    return await embedText(cleanText);
  } catch (error) {
    console.warn('Bot memory embedding failed:', error.message);
    return null;
  }
};

export const addBotMemory = async ({ type = 'human_feedback', content, metadata = {} }) => {
  const cleanContent = clipText(content);
  if (!cleanContent) {
    throw new Error('Memory content is required');
  }

  const normalizedType = normalizeBotMemoryType(type);
  const cleanMetadata = parseBotMemoryMetadata(metadata);
  const embeddingInput = [
    `type: ${normalizedType}`,
    cleanContent,
    JSON.stringify(cleanMetadata).slice(0, 1000)
  ].join('\n');
  const embedding = await embedBotText(embeddingInput);

  return saveBotMemoryItem(normalizedType, cleanContent, cleanMetadata, embedding);
};

export const searchBotMemory = async (query = '', { topK = 6, types = [], limit = 300 } = {}) => {
  const cleanTypes = Array.isArray(types)
    ? types
      .map(type => String(type || '').trim())
      .filter((type, index, arr) => BOT_MEMORY_TYPE_SET.has(type) && arr.indexOf(type) === index)
    : [];
  const rows = await getBotMemoryItems({ types: cleanTypes, limit });
  if (rows.length === 0) return [];

  const queryEmbedding = await embedBotText(query);
  const safeTopK = Math.max(1, Math.min(Number.parseInt(topK, 10) || 6, 20));

  const scored = rows.map((row, index) => {
    const metadata = parseBotMemoryMetadata(row.metadata);
    const rowEmbedding = parseEmbedding(row.embedding);
    const embeddingScore = queryEmbedding && rowEmbedding ? cosineSimilarity(queryEmbedding, rowEmbedding) : 0;
    const textScore = lexicalSimilarity(query, `${row.type} ${row.content} ${JSON.stringify(metadata)}`);
    const recentScore = (rows.length - index) / rows.length * 0.05;
    const score = Math.max(embeddingScore, textScore) + recentScore;

    return {
      ...row,
      metadata,
      score: Number(score.toFixed(4))
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, safeTopK);
};

const MEMORY_TYPE_LABELS = {
  approved_reply: 'Mau tra loi tot',
  bad_reply: 'Loi can tranh',
  hook_pattern: 'Hook/pattern nen dung',
  writing_rule: 'Quy tac viet',
  trend_pattern: 'Xu huong dang hoc',
  category_rule: 'Quy tac theo nhom san pham',
  human_feedback: 'Phan hoi tu nguoi dung'
};

export const buildMemoryContext = async (query, { topK = 8, maxChars = 4500 } = {}) => {
  const memories = await searchBotMemory(query, { topK });
  if (memories.length === 0) return '';

  const lines = [
    'KINH NGHIEM BOT DA HOC TU FEEDBACK:',
    'Chi dung cac memory phu hop voi cau hoi hien tai. Neu memory mau thuan voi kien thuc/chinh sach moi, uu tien kien thuc/chinh sach moi.'
  ];

  memories.forEach((memory, index) => {
    const label = MEMORY_TYPE_LABELS[memory.type] || memory.type;
    const reason = memory.metadata?.note || memory.metadata?.rating || '';
    lines.push(`${index + 1}. [${label}] ${clipText(memory.content, 700)}${reason ? ` (ghi chu: ${clipText(reason, 160)})` : ''}`);
  });

  return clipText(lines.join('\n'), maxChars);
};
