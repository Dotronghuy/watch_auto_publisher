import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConversationById, getMessagesByConversation, updateBotPausedStatus, saveMessage } from '../utils/crm.db.js';
import { findMatchingSku, computeHashFromUrl } from './image-hash.service.js';
import { getProductInfoBySku } from './sheet.service.js';
import { replyCRM, replyImageCRM } from './crm.service.js';
import { getProductImagesFromDrive } from './drive.service.js';
import { broadcastCRM } from '../routes/api.routes.js';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { searchKnowledge } from '../utils/vector_search.js';
import { buildMemoryContext } from './chatbot-memory.service.js';

dotenv.config();
const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KNOWLEDGE_PATH = path.join(__dirname, '../../config/chatbot-knowledge.md');
const SETTINGS_PATH = path.join(__dirname, '../../config/settings.json');
const IMAGE_REPLY_TEMPLATE_PATH = path.join(__dirname, '../../config/bot_image_reply_template.md');
const CATALOG_PATH = path.join(__dirname, '../../data/catalog.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
let catalogPromptCache = { mtimeMs: 0, value: '[]' };

const getGeminiModels = () => {
  dotenv.config({ override: true }); // Hot-reload .env
  const modelsEnv = process.env.GEMINI_MODELS;
  if (modelsEnv) {
    return modelsEnv.split(',').map(m => m.trim()).filter(m => m);
  }
  return ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest'];
};

const runWithModelFallback = async (content, requireJSON = false) => {
  const models = getGeminiModels();
  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    const retriesPerModel = Math.max(0, Number.parseInt(process.env.GEMINI_RETRIES_PER_MODEL || '0', 10));
    const retryDelayMs = Math.max(0, Number.parseInt(process.env.GEMINI_RETRY_DELAY_MS || '250', 10));
    let retries = retriesPerModel;

    while (retries >= 0) {
      try {
        const config = requireJSON ? { generationConfig: { responseMimeType: 'application/json' } } : {};
        const model = genAI.getGenerativeModel({ model: modelName, ...config });
        const result = await model.generateContent(content);
        return result;
      } catch (err) {
        const isOverloaded = err.status === 503 || (err.message && err.message.includes('503'));

        if (isOverloaded && retries > 0) {
          console.log(`⏳ Gemini quá tải với model ${modelName}. Thử lại sau ${retryDelayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          retries--;
        } else {
          console.log(`⚠️ Lỗi Model ${modelName}:`, err.message);
          break; // Thoát vòng lặp while để chuyển sang model tiếp theo
        }
      }
    }

    if (i < models.length - 1) {
      console.log(`🤖 Tự động chuyển sang model dự phòng ${models[i + 1]}...`);
    } else {
      throw new Error(`Tất cả các model đều lỗi hoặc quá tải.`); // Nếu là model cuối cùng thì ném lỗi
    }
  }
};

const getSettings = () => {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch (e) { }
  return { botEnabled: false, botPauseHours: 2, botDelayMin: 0, botDelayMax: 0, enableLayer2: true, enableLayer3: true };
};

const getKnowledgeText = () => {
  try {
    if (fs.existsSync(KNOWLEDGE_PATH)) {
      return fs.readFileSync(KNOWLEDGE_PATH, 'utf8');
    }
  } catch (e) { }
  return "Bạn là trợ lý ảo tư vấn đồng hồ.";
};

const getImageReplyTemplate = () => {
  try {
    if (fs.existsSync(IMAGE_REPLY_TEMPLATE_PATH)) {
      return fs.readFileSync(IMAGE_REPLY_TEMPLATE_PATH, 'utf8');
    }
  } catch (e) { }
  return `Dạ mẫu anh/chị gửi là **{{PRODUCT_NAME}}** (Mã: {{SKU}}).\nGiá sản phẩm là: **{{PRICE}}** ạ! Anh/chị có muốn đặt hàng luôn không ạ? 😊`;
};

const getProductInfoFromCatalog = (skuCode) => {
  try {
    const catalogPath = path.join(__dirname, '../../data/catalog.json');
    if (fs.existsSync(catalogPath)) {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      let found = catalog.find(p => p['Mã sản phẩm'] === skuCode);
      if (!found) {
        // Fallback: Tìm biến thể đầu tiên của mã gốc này (vd: 55883G -> 55883G-T1)
        found = catalog.find(p => p['Mã sản phẩm'].startsWith(skuCode + '-'));
      }
      return found;
    }
  } catch (e) { }
  return null;
};

const shouldIncludeCatalog = (messageText) => {
  const text = normalizeIntentText(messageText);
  return /\b(mau|ma|sku|dong ho|gia|nam|nu|day|mat|size|form|kieu|phong cach|the thao|sang trong|co dien|hublot|nautilus|tonneau|tank)\b/.test(text)
    || /\b\d{3,}[a-z0-9-]*\b/.test(text);
};

const getCatalogPromptText = () => {
  try {
    const stat = fs.statSync(CATALOG_PATH);
    if (catalogPromptCache.mtimeMs === stat.mtimeMs) {
      return catalogPromptCache.value;
    }

    const allProducts = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    const uniqueCatalog = [];
    const seenSku = new Set();

    for (const product of allProducts) {
      const sku = product['Mã sản phẩm'];
      if (!sku) continue;

      const baseSku = sku.split('-')[0];
      let description = [
        product['Thương hiệu'],
        product['Mô tả ngắn'],
        product['Lấy cảm hứng từ'],
        product['Phong cách']
      ].filter(Boolean).join(' - ');

      if ((baseSku === '55851G' || baseSku === '55851') && !description.toLowerCase().includes('hublot')) {
        description += ' - form Hublot';
      }

      if (!seenSku.has(baseSku) && description) {
        seenSku.add(baseSku);
        uniqueCatalog.push({ sku: baseSku, desc: description });
      }
    }

    catalogPromptCache = {
      mtimeMs: stat.mtimeMs,
      value: JSON.stringify(uniqueCatalog)
    };
  } catch (error) {
    console.warn('Không thể tạo catalog rút gọn cho chatbot:', error.message);
    catalogPromptCache = { mtimeMs: 0, value: '[]' };
  }

  return catalogPromptCache.value;
};

const getChatLieuDay = (sku, productInfo) => {
  let chatLieuDay = productInfo["Chất liệu dây"];
  if (!chatLieuDay) {
    const baseSku = sku.split('-')[0];
    const catalogPath = path.join(__dirname, '../../data/catalog.json');
    let hasS = false, hasT = false, hasD = false;
    if (fs.existsSync(catalogPath)) {
      const allProducts = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      const variants = allProducts.filter(p => p['Mã sản phẩm'] && p['Mã sản phẩm'].startsWith(baseSku + '-'));
      variants.forEach(v => {
        if (v['Mã sản phẩm'].includes('-S')) hasS = true;
        if (v['Mã sản phẩm'].includes('-T')) hasT = true;
        if (v['Mã sản phẩm'].includes('-D')) hasD = true;
      });
    }

    if (sku.includes("-T")) chatLieuDay = "Thép không gỉ 316L đúc đặc.";
    else if (sku.includes("-S")) chatLieuDay = "Dây cao su cao cấp.";
    else if (sku.includes("-D")) chatLieuDay = "Dây da cao cấp.";
    else {
      let options = [];
      if (hasT) options.push("Thép không gỉ 316L đúc đặc");
      if (hasS) options.push("Dây cao su");
      if (hasD) options.push("Dây da");
      
      if (options.length === 1) {
         chatLieuDay = options[0] + (hasS || hasD ? " cao cấp." : ".");
      } else if (options.length > 1) {
         chatLieuDay = options.join(" / ");
      } else {
         chatLieuDay = "Thép không gỉ 316L đúc đặc / Dây cao su / Dây da";
      }
    }
  }
  return chatLieuDay;
};

const getGiaBan = (sku, productInfo) => {
  let defaultPrice = productInfo["Giá sale"] || productInfo["Giá bán"] || productInfo["Giá gốc"];
  if (sku.includes('-')) return defaultPrice;

  const baseSku = sku.split('-')[0];
  const catalogPath = path.join(__dirname, '../../data/catalog.json');
  if (fs.existsSync(catalogPath)) {
    const allProducts = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const variants = allProducts.filter(p => p['Mã sản phẩm'] && p['Mã sản phẩm'].startsWith(baseSku + '-'));
    
    let prices = new Set();
    let hasD = false, hasS = false, hasT = false;
    let priceD, priceS, priceT;

    variants.forEach(v => {
      let p = v["Giá sale"] || v["Giá bán"] || v["Giá gốc"];
      if (p) {
        prices.add(p);
        if (v['Mã sản phẩm'].includes('-D')) { hasD = true; priceD = p; }
        if (v['Mã sản phẩm'].includes('-S')) { hasS = true; priceS = p; }
        if (v['Mã sản phẩm'].includes('-T')) { hasT = true; priceT = p; }
      }
    });

    if (prices.size > 1) {
      let priceParts = [];
      if (hasS && hasD && priceS === priceD) {
        priceParts.push(`Dây da/cao su: ${priceS}`);
      } else {
        if (hasD) priceParts.push(`Dây da: ${priceD}`);
        if (hasS) priceParts.push(`Dây cao su: ${priceS}`);
      }
      if (hasT) priceParts.push(`Dây thép: ${priceT}`);

      if (priceParts.length > 0) {
        return priceParts.join(" - ");
      }
      return Array.from(prices).join(" - ");
    } else if (prices.size === 1) {
      return Array.from(prices)[0];
    }
  }
  return defaultPrice;
};

// --- CORE AI LOGIC ---

/**
 * Xử lý Lớp 3: Gọi Gemini Vision
 */
const runLayer3GeminiVision = async (imageUrls, messageText) => {
  try {
    const customerImageParts = [];
    for (const url of imageUrls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          let mime = response.headers.get("content-type") || "image/jpeg";
          if (!mime.startsWith('image/')) mime = 'image/jpeg';
          customerImageParts.push({ inlineData: { data: Buffer.from(buffer).toString("base64"), mimeType: mime } });
        }
      } catch (e) {
        console.error(`[Lớp 3] Lỗi tải ảnh khách từ FB:`, e.message);
      }
    }

    if (customerImageParts.length === 0) {
      return { sku: null, message: "Dạ mẫu này đẹp quá ạ! 😍 Anh/chị cho shop biết thêm thích mức giá khoảng bao nhiêu để shop tư vấn nha!" };
    }

    const modelName = getGeminiModels()[0];
    const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" } });

    // Đọc catalog và TỐI ƯU DUNG LƯỢNG (Minify) để tránh lỗi quá tải 1 Triệu Token
    const catalogPath = path.join(__dirname, '../../data/catalog.json');
    let catalogData = '[]';
    if (fs.existsSync(catalogPath)) {
      try {
        const allProducts = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        // Chỉ lấy vài trường cơ bản để LLM search cho nhanh, nhưng BẮT BUỘC phải có Mô tả ngắn để biết màu sắc, kiểu dáng
        const minifiedCatalog = allProducts.map(p => ({
          sku: p['Mã sản phẩm'],
          brand: p['Thương hiệu'],
          dial: p['Màu mặt số'],
          strap: p['Chất liệu dây'],
          case: p['Chất liệu vỏ'],
          desc: p['Mô tả ngắn'] || ''
        }));
        catalogData = JSON.stringify(minifiedCatalog);
      } catch (e) {
        console.error("Lỗi parse catalog:", e);
      }
    }

    // Chặng 1: Semantic Search & Text OCR
    const prompt1A = `Khách hàng gửi ${customerImageParts.length} ảnh. Lời nhắn: "${messageText}".
Nhiệm vụ: 
1. Đọc MỌI chữ/số xuất hiện trong TẤT CẢ CÁC ẢNH (đặc biệt là mã sản phẩm, thương hiệu).
2. LƯU Ý QUAN TRỌNG: Nếu ảnh là một bức ảnh ghép (collage) gồm nhiều ô nhỏ, chụp nhiều góc cạnh khác nhau của CÙNG 1 CHIẾC ĐỒNG HỒ, hãy coi đó là DUY NHẤT 1 MẪU ĐỒNG HỒ, không được nhầm lẫn thành nhiều mẫu.
3. Mô tả ngoại hình đồng hồ (màu mặt số, màu vỏ, loại dây) của (các) mẫu xuất hiện.
Trả về JSON: { "text_in_image": "các chữ đọc được", "description": "mô tả ngoại hình" }`;

    console.log(`🤖 Đang chạy Lớp 3 Chặng 1A (Vision OCR)...`);
    const result1A = await runWithModelFallback([prompt1A, ...customerImageParts]);
    const visionOutput = result1A.response.text();
    console.log(`🤖 Kết quả Vision:`, visionOutput);

    const prompt1B = `Bạn là chuyên gia tư vấn. Dựa vào kết quả phân tích ảnh:
${visionOutput}
Và lời nhắn của khách: "${messageText}"

Dưới đây là danh sách sản phẩm (JSON):
${catalogData}

Nhiệm vụ: Tìm tối đa 5 mã SKU khớp nhất với phân tích trên. 
LƯU Ý CỰC KỲ QUAN TRỌNG:
1. Nếu "text_in_image" đọc được CHÍNH XÁC một mã sản phẩm (ví dụ "538L"), bạn BẮT BUỘC ưu tiên các SKU chứa đúng mã đó (như "538L-T2").
2. Nếu không có chữ số nào, BẮT BUỘC phải đối chiếu CHÍNH XÁC "description" của ảnh (màu sắc, kiểu dáng mặt, đính đá, dây) với trường "desc" (Mô tả ngắn) trong JSON. Tuyệt đối không chọn bừa. 
Trả về JSON định dạng:
{
  "candidates": ["SKU1", "SKU2"],
  "message": "Nếu không tìm thấy ứng viên nào, hãy viết câu trả lời thân thiện cho khách (ví dụ: xin thêm thông tin, hỏi mức giá)"
}`;

    console.log(`🤖 Đang chạy Lớp 3 Chặng 1B (Semantic Search)...`);
    const result1B = await runWithModelFallback(prompt1B, true);

    let stage1Result = {};
    try {
      const text = result1B.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      stage1Result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[Lớp 3] Lỗi parse JSON Chặng 1B:", e.message);
      fs.appendFileSync('debug_log.txt', `[Lớp 3] JSON Error 1B: ${e.message}\n`);
    }

    if (!stage1Result.candidates || stage1Result.candidates.length === 0) {
      return { sku: null, message: stage1Result.message || "Dạ mẫu này đẹp quá ạ! 😍 Anh/chị cho shop biết thêm thích mức giá khoảng bao nhiêu để shop tư vấn mẫu tương tự nha!" };
    }

    console.log('🤖 Chặng 1 Lớp 3 đã lọc ứng viên:', stage1Result.candidates);

    // Chặng 2: Visual Verification (So sánh ảnh chéo)
    const { getAllProductsWithImages } = await import('./sheet.service.js');
    const allProducts = await getAllProductsWithImages();
    const candidateImages = allProducts.filter(p => stage1Result.candidates.includes(p.sku));

    if (candidateImages.length === 0) {
      return { sku: null, message: "Dạ mẫu này shop đang kiểm tra lại, anh/chị đợi lát nha!" };
    }

    // Tải ảnh gốc của các ứng viên
    const imageParts2 = [...customerImageParts]; // Các ảnh đầu tiên là ảnh khách gửi
    let index = customerImageParts.length;
    let candidateIndexMap = {}; // Map số thứ tự ảnh -> SKU

    for (const c of candidateImages) {
      try {
        const res = await fetch(c.imageUrl);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          let mime = res.headers.get("content-type") || "image/jpeg";
          if (!mime.startsWith('image/')) mime = 'image/jpeg';
          imageParts2.push({ inlineData: { data: Buffer.from(buf).toString("base64"), mimeType: mime } });
          candidateIndexMap[index] = c.sku;
          index++;
        } else {
          console.error(`[Lớp 3] Lỗi tải ảnh kho cho SKU ${c.sku}: HTTP ${res.status}`);
        }
      } catch (e) {
        console.error(`[Lớp 3] Ngoại lệ khi tải ảnh kho SKU ${c.sku}:`, e.message);
      }
    }

    const n = customerImageParts.length;
    const prompt2 = `Từ index 0 đến index ${n - 1} là ảnh khách gửi. Các ảnh tiếp theo (từ index ${n} trở đi) là ảnh gốc của các mẫu: ${Object.values(candidateIndexMap).join(', ')}.
Nhiệm vụ: So sánh tập ảnh khách gửi với các ảnh còn lại.
Trích xuất mã SKU khớp NHẤT.
LƯU Ý CỰC KỲ QUAN TRỌNG: 
- ĐẶC BIỆT LƯU Ý ẢNH GHÉP (COLLAGE): Nếu ảnh khách gửi là một tấm ảnh ghép (có nhiều ô nhỏ chụp mặt trước, mặt bên, dây đeo, v.v.) của CÙNG 1 KIỂU DÁNG đồng hồ, thì đó CHỈ LÀ 1 SẢN PHẨM DUY NHẤT. BẠN TUYỆT ĐỐI KHÔNG ĐƯỢC CHỌN "MULTIPLE_MODELS". BẠN BẮT BUỘC PHẢI CHỌN ĐÚNG MÃ SKU ĐÓ.
- CHỈ TRẢ VỀ "MULTIPLE_MODELS" NẾU VÀ CHỈ NẾU tập ảnh khách gửi chứa các chiếc đồng hồ CÓ KIỂU DÁNG/FORM THIẾT KẾ KHÁC BIỆT HOÀN TOÀN (ví dụ: 1 cái mặt vuông và 1 cái mặt tròn).
- Nếu tập ảnh khách gửi chụp NHIỀU MÀU SẮC CỦA CÙNG 1 MẪU, bạn PHẢI TRẢ VỀ mã gốc (bỏ phần hậu tố -T1...). Ví dụ: trả về "55883G" thay vì "55883G-T1". 
- NẾU ẢNH KHÁCH CHỈ CHỤP DUY NHẤT 1 CHIẾC ĐỒNG HỒ (hoặc ảnh ghép của 1 chiếc), bạn BẮT BUỘC phải trả về ĐÚNG mã chi tiết (ví dụ: "55883G-T1").
Chỉ trả về JSON định dạng: { "sku": "Mã SKU khớp hoặc MULTIPLE_MODELS" }. Nếu hoàn toàn không có ảnh nào khớp, trả về { "sku": null }.`;

    const result2 = await runWithModelFallback([prompt2, ...imageParts2], true);
    const responseText2 = result2.response.text();
    let stage2Result = { sku: null };
    try {
      stage2Result = JSON.parse(responseText2);
    } catch (e) { }

    const exactSku = stage2Result.sku;

    if (exactSku) {
      console.log(`🤖 Chặng 2 Lớp 3 chốt hạ SKU: ${exactSku}`);
      return { sku: exactSku, message: "" };
    } else {
      fs.appendFileSync('debug_log.txt', `[Lớp 3] Chặng 2 Failed. Candidates: ${stage1Result.candidates.join(',')}. Result2: ${result2.response.text()}\n`);
      return { sku: null, message: "Dạ mẫu này đẹp quá ạ! 😍 Anh/chị cho shop biết thêm thích mức giá khoảng bao nhiêu để shop tư vấn mẫu tương tự nha!" };
    }

  } catch (error) {
    console.error("[Lớp 3] Lỗi gọi Gemini Vision:", error);
    fs.appendFileSync('debug_log.txt', `[Lớp 3] Error Catch: ${error.message}\n`);
    return { sku: null, message: "Dạ mẫu này đẹp quá ạ! 😍 Anh/chị cho shop biết thêm thích mức giá khoảng bao nhiêu để shop tư vấn nha!" };
  }
};

/**
 * Xử lý Bot trả lời bằng Text (Gemini)
 */
const clipPromptText = (value, maxChars = 5000) => {
  const text = String(value || '').trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
};

const cleanJSONResponse = (text) => {
  const raw = String(text || '').trim();
  const withoutFence = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const match = withoutFence.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
};

const cleanReplyText = (text) => {
  return String(text || '')
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```$/i, '')
    .trim();
};

const normalizeIntentText = (value) => {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const getInstantTextReply = (messageText) => {
  const text = normalizeIntentText(messageText);

  if (/^(chao( shop| ad|minh)?|xin chao( shop)?|hello( shop)?|hi( shop)?|alo( shop)?|shop oi)$/.test(text)) {
    return 'Dạ shop chào anh/chị ạ! Anh/chị đang quan tâm mẫu đồng hồ nào để em tư vấn ngay ạ?';
  }

  if (/^(cam on|thank you|thanks)( shop| em)?( nhe| nha| a)?$/.test(text)) {
    return 'Dạ shop cảm ơn anh/chị ạ! Khi cần xem mẫu hoặc tư vấn thêm, anh/chị cứ nhắn shop nhé.';
  }

  return null;
};

const evaluateBotReply = async ({ customerMessage, draftReply, knowledgeText, memoryContext }) => {
  const fallback = {
    total_score: 8,
    truth_score: 8,
    tone_score: 8,
    safety_score: 8,
    problems: [],
    need_rewrite: false
  };

  try {
    const prompt = `Ban la bo phan QA cho chatbot ban dong ho.
Hay cham diem cau tra loi truoc khi gui cho khach.

NGUYEN TAC:
- Khong duoc bia gia, ton kho, bao hanh, phi ship, thanh toan neu khong co trong kien thuc.
- Neu khong chac, phai chuyen sang: "shop se co nhan vien kiem tra lai".
- Cau tra loi phai ngan gon, lich su, dung tieng Viet, khong lap y.
- Khong tu y hua chot don, giu hang, giam gia neu khong co thong tin.

KIEN THUC:
${clipPromptText(knowledgeText)}

MEMORY/FEEDBACK:
${clipPromptText(memoryContext || 'Khong co memory phu hop.')}

TIN NHAN KHACH:
${clipPromptText(customerMessage, 1200)}

CAU TRA LOI NHAP:
${clipPromptText(draftReply, 1200)}

Chi tra ve JSON:
{
  "total_score": 0-10,
  "truth_score": 0-10,
  "tone_score": 0-10,
  "safety_score": 0-10,
  "problems": ["van de neu co"],
  "need_rewrite": true/false
}`;

    const result = await runWithModelFallback(prompt, true);
    const parsed = cleanJSONResponse(result.response.text()) || {};
    const evaluation = {
      total_score: Number(parsed.total_score ?? fallback.total_score),
      truth_score: Number(parsed.truth_score ?? fallback.truth_score),
      tone_score: Number(parsed.tone_score ?? fallback.tone_score),
      safety_score: Number(parsed.safety_score ?? fallback.safety_score),
      problems: Array.isArray(parsed.problems) ? parsed.problems.slice(0, 5) : [],
      need_rewrite: Boolean(parsed.need_rewrite)
    };

    evaluation.need_rewrite = evaluation.need_rewrite
      || evaluation.total_score < 8
      || evaluation.truth_score < 7
      || evaluation.safety_score < 8;

    return evaluation;
  } catch (error) {
    console.warn('Bot evaluator skipped:', error.message);
    return fallback;
  }
};

const rewriteBotReply = async ({ customerMessage, draftReply, evaluation, knowledgeText, memoryContext }) => {
  try {
    const prompt = `Sua lai cau tra loi chatbot cho khach hang dong ho.
Muc tieu: dung su that, ngan gon, than thien, tieng Viet tu nhien. KHONG DICH SANG TIENG ANH. KHONG THEM GHI CHU TIENG ANH.
TUYET DOI KHONG BIA DAT cac tinh nang nhu Bluetooth, AI, Smartwatch, ket noi mang. Đay la dong ho co/pin truyen thong.
Neu ban gioi thieu san pham, BAT BUOC phai chi ra 1 MA SKU CU THE. KHONG THEM LINK ANH.

Neu thieu thong tin ve gia/ton kho/bao hanh/ship/thanh toan, khong duoc doan. Hay noi shop se co nhan vien kiem tra lai.

KIEN THUC:
${clipPromptText(knowledgeText)}

MEMORY/FEEDBACK:
${clipPromptText(memoryContext || 'Khong co memory phu hop.')}

TIN NHAN KHACH:
${clipPromptText(customerMessage, 1200)}

CAU TRA LOI CU:
${clipPromptText(draftReply, 1200)}

LOI CAN SUA:
${clipPromptText((evaluation?.problems || []).join('; ') || 'Can lam cau tra loi chac chan hon.', 1000)}

Chi tra ve JSON: { "reply": "cau tra loi da sua" }`;

    const result = await runWithModelFallback(prompt, true);
    const parsed = cleanJSONResponse(result.response.text()) || {};
    return cleanReplyText(parsed.reply || draftReply);
  } catch (error) {
    console.warn('Bot rewriter skipped:', error.message);
    return cleanReplyText(draftReply);
  }
};

export const runGeminiText = async (history, newMessage) => {
  try {
    // RAG: Tìm kiếm thông tin liên quan từ vector store
    const [relevantKnowledge, memoryContext] = await Promise.all([
      searchKnowledge(newMessage, 3).catch((error) => {
        console.warn('Knowledge search skipped:', error.message);
        return [];
      }),
      buildMemoryContext(newMessage).catch((error) => {
        console.warn('Bot memory search skipped:', error.message);
        return '';
      })
    ]);
    // Fallback: nếu không tìm thấy, lấy toàn bộ hoặc lấy base (hoặc file gốc chưa có RAG)
    let knowledgeText = relevantKnowledge.length > 0 ? relevantKnowledge.join('\n\n') : getKnowledgeText();
    if (memoryContext) {
      knowledgeText += `\n\n---\nKINH NGHIEM/FEEDBACK BOT DA HOC:\n${memoryContext}\n---`;
    }

    const catalogData = shouldIncludeCatalog(newMessage) ? getCatalogPromptText() : '[]';

    const systemPrompt = `Bạn là trợ lý ảo tư vấn đồng hồ của shop.
Hãy trả lời lịch sự, thân thiện, dùng emoji hợp lý. Không bịa đặt thông tin.
LƯU Ý QUAN TRỌNG:
1. NGÔN NGỮ CHÍNH LÀ TIẾNG VIỆT. Bạn có thể dùng một số từ Tiếng Anh thông dụng trong thương mại (như: Shop, Sale, Size, Freeship, Fullbox, SKU). BẠN KHÔNG BIẾT VÀ KHÔNG ĐƯỢC PHÉP DÙNG BẤT KỲ NGÔN NGỮ NÀO KHÁC. KHÔNG DỊCH THUẬT.
2. TUYỆT ĐỐI KHÔNG TỰ BỊA ĐẶT TÍNH NĂNG (như Bluetooth, AI, Smartwatch, đo nhịp tim...) nếu không có trong dữ liệu. Đồng hồ ở đây là đồng hồ cơ/pin truyền thống.
3. Lệnh Tối Cao KHI BÁO GIÁ HOẶC GIỚI THIỆU SẢN PHẨM CỤ THỂ: Bạn TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ VIẾT thông tin sản phẩm (giá, kích thước...). Thay vào đó, BẠN BẮT BUỘC CHỈ CẦN XUẤT RA DUY NHẤT 1 CÚ PHÁP ĐÚNG NHƯ SAU:
[PRODUCT: Mã_SKU_Sản_Phẩm]

Hệ thống sẽ tự động bắt lấy cú pháp này và chèn Form mẫu thông số hoàn chỉnh vào. Bạn CHỈ ĐƯỢC PHÉP trả lời thêm ở NGAY BÊN DƯỚI cú pháp này (xuống dòng) NẾU khách có hỏi thêm câu hỏi phụ (như ship, bảo hành...). Tuyệt đối không tự sinh lời chào!
4. NẾU KHÁCH TÌM KIẾM THEO FORM DÁNG (ví dụ: Hublot, Nautilus, RM, Tonneau, Tank), hãy tra cứu trong DANH SÁCH SẢN PHẨM bên dưới để đề xuất mã SKU phù hợp bằng cú pháp [PRODUCT: Mã_SKU_Sản_Phẩm].
5. LƯU Ý ƯU TIÊN THƯƠNG HIỆU: Khi có nhiều mẫu cùng đáp ứng yêu cầu của khách, LUÔN LUÔN ƯU TIÊN đề xuất theo thứ tự sau: Top 1 là "I&W Carnival", Top 2 là "Lobinni", Top 3 là "Cadisen". Đặc biệt tập trung bán I&W Carnival.
6. QUY TẮC MÃ SẢN PHẨM: Các đuôi số (như G1, G2, G3) thể hiện phiên bản niềng/vành bezel: Đuôi 1 (ví dụ G1) là niềng trơn, Đuôi 2 (ví dụ G2) là niềng đính đá, Đuôi 3 (ví dụ G3) là đính full đá. TUYỆT ĐỐI KHÔNG gọi chúng là "phiên bản màu sắc" khi giải thích cho khách. Màu sắc là phần đuôi phụ đằng sau (như -S1, -D1). NẾU khách hỏi mã chung chung (ví dụ 55851), HÃY HỎI RÕ khách muốn bản niềng nào (niềng trơn, niềng đá hay đính full đá).

DANH SÁCH SẢN PHẨM (Mã & Mô tả/Thương hiệu):
${catalogData}

Dưới đây là thông tin cửa hàng và chính sách liên quan:
---
${knowledgeText}
---
`;

    // Build history format cho Gemini SDK startChat
    const groupedMessages = [];
    let currentGroup = null;

    for (const msg of history) {
      const role = msg.is_from_page ? "model" : "user";
      if (!currentGroup) {
        currentGroup = { role, text: msg.message || "(Đã gửi một tệp đính kèm)" };
      } else if (currentGroup.role === role) {
        currentGroup.text += "\n" + (msg.message || "(Đã gửi một tệp đính kèm)");
      } else {
        groupedMessages.push(currentGroup);
        currentGroup = { role, text: msg.message || "(Đã gửi một tệp đính kèm)" };
      }
    }
    if (currentGroup) groupedMessages.push(currentGroup);

    // Ensure the first message is "user"
    if (groupedMessages.length > 0 && groupedMessages[0].role !== "user") {
      groupedMessages.shift();
    }

    // Ensure the last message in history is "model" (because newMessage is "user")
    if (groupedMessages.length > 0 && groupedMessages[groupedMessages.length - 1].role !== "model") {
      const lastMsg = groupedMessages.pop();
      newMessage = lastMsg.text + "\n" + newMessage;
    }

    const chatHistory = groupedMessages.map(g => ({
      role: g.role,
      parts: [{ text: g.text }]
    }));

    let result;
    let lastModelError = null;
    for (const modelName of getGeminiModels()) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            maxOutputTokens: 320,
            temperature: 0.4
          }
        });
        const chat = model.startChat({ history: chatHistory });
        result = await chat.sendMessage(newMessage);
        break;
      } catch (err) {
        lastModelError = err;
        console.warn(`⚠️ Gemini model ${modelName} lỗi, chuyển model tiếp theo:`, err.message);
      }
    }

    if (!result) {
      throw lastModelError || new Error('Không có Gemini model khả dụng.');
    }

    let draftReply = cleanReplyText(result.response.text());

    if (!draftReply) {
      return "Dạ shop đã nhận được tin nhắn. Sẽ có nhân viên hỗ trợ anh/chị ngay ạ!";
    }

    // --- ÉP FORM MẪU BẰNG CODE ---
    const productMatch = draftReply.match(/\[PRODUCT:\s*([a-zA-Z0-9-]+)\]/i);
    if (productMatch) {
       const sku = productMatch[1].toUpperCase();
       
       // Kiểm tra SKU có bị chung chung không (ví dụ: khách hỏi 55851G nhưng có G1, G2, G3)
       const catalogPath = path.join(__dirname, '../../data/catalog.json');
       if (fs.existsSync(catalogPath)) {
         const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
         const variants = new Set(
           catalog.map(p => p['Mã sản phẩm'])
                  .filter(m => m && m.startsWith(sku) && m.length > sku.length && !m.startsWith(sku + '-'))
                  .map(m => m.split('-')[0])
         );
         const variantList = Array.from(variants);
         
         if (variantList.length > 1) {
           let clarifyText = `Dạ mẫu ${sku} bên em có ${variantList.length} phiên bản ạ:`;
           
           // Áp dụng linh hoạt cho mọi sản phẩm có phân loại 1, 2, 3
           const formattedVariants = variantList.map(v => {
             if (v.endsWith('1')) return `${v} (bản trơn)`;
             if (v.endsWith('2')) return `${v} (bản đính đá)`;
             if (v.endsWith('3')) return `${v} (bản đính full đá)`;
             return v;
           });

           clarifyText += ` ${formattedVariants.join(', ')}. Anh/chị muốn tham khảo phiên bản nào ạ? 🥰`;
           draftReply = draftReply.replace(productMatch[0], clarifyText).trim();
           
           // Lấy ảnh của biến thể đầu tiên làm ảnh minh họa để gửi kèm
           const firstVariantSku = variantList[0];
           const firstVariantInfo = getProductInfoFromCatalog(firstVariantSku) || {};
           const productImageUrl = firstVariantInfo['imageUrl'] || firstVariantInfo['Link ảnh sản phẩm'] || null;

           // Dọn dẹp các thẻ [PRODUCT: XXX] thừa nếu AI lỡ sinh nhiều thẻ
           draftReply = draftReply.replace(/\[PRODUCT:\s*[a-zA-Z0-9-]+\]/gi, '');

           return { reply: draftReply, productImageUrl, sku: null }; // Trả về text hỏi lại + gửi kèm 1 ảnh minh họa
         }
       }

       const productInfo = getProductInfoFromCatalog(sku) || {};
       const isGenericSku = !sku.includes('-'); // "55883G" thay vì "55883G-T1"
       
       let chatLieuDay = getChatLieuDay(sku, productInfo);

       let formText = "";
       const baseSku = sku.split('-')[0];
       const hasSentForm = history.some(msg => msg.is_from_page && (msg.message || "").includes(`Mã Sản Phẩm: ${baseSku}`));

       if (hasSentForm) {
          formText = `Dạ mẫu bản màu này (${sku}) thì giá ưu đãi hiện tại là: ${productInfo["Giá sale"] || productInfo["Giá bán"]} ạ. Các thông số về kích thước, bộ máy, chống nước... hoàn toàn giống mẫu ${baseSku} em vừa gửi ở trên nha anh/chị! 🥰`;
       } else {
         formText = `Shop xin chào 🤗
Cảm ơn chị đã quan tâm tới các sản phẩm của Shop. Dưới đây là thông tin chi tiết sản phẩm để chị tiện tham khảo ạ.

-Mã Sản Phẩm: ${sku} -
📏Kích thước mặt số : ${productInfo["Kích thước mặt"] || productInfo["Size"] || "Đang cập nhật"}
🤿Khả năng chống nước : ${productInfo["Độ chịu nước"] || productInfo["Water resistance"] || "Đang cập nhật"}
⚙️Bộ máy : ${productInfo["Loại máy"] || productInfo["Bộ máy"] || "Đang cập nhật"} chính hãng
⏳Chế độ bảo hành máy 5 năm.
🗜️Chất liệu vỏ : Thép không gỉ 316L đúc đặc.
⛓️Chất liệu dây: ${chatLieuDay}
🔎 Kính sapphire hạn chế trầy xước.

✅ Giá bán : ${productInfo["Giá sale"] || productInfo["Giá bán"] || productInfo["Giá gốc"] || "Đang cập nhật"}`;

         if (isGenericSku) {
            formText += `|||Dạ mẫu này bên em đang có nhiều màu, anh/chị đang ưng màu nào ạ? 🥰`;
         }
       }

       draftReply = draftReply.replace(productMatch[0], formText).trim();
       
       // Dọn dẹp các thẻ [PRODUCT: XXX] thừa nếu AI lỡ sinh nhiều thẻ
       draftReply = draftReply.replace(/\[PRODUCT:\s*[a-zA-Z0-9-]+\]/gi, '');
       // Trả về object để processConversation có thể gửi ảnh kèm
       const productImageUrl = productInfo['imageUrl'] || productInfo['Link ảnh sản phẩm'];
       return { reply: draftReply, productImageUrl: productImageUrl || null, sku };
    }

    const shouldEvaluateReply = String(process.env.CHATBOT_EVALUATE_REPLIES || 'false').toLowerCase() === 'true';
    if (!shouldEvaluateReply) {
      return draftReply;
    }

    const evaluation = await evaluateBotReply({
      customerMessage: newMessage,
      draftReply,
      knowledgeText,
      memoryContext
    });

    if (evaluation.need_rewrite) {
      return rewriteBotReply({
        customerMessage: newMessage,
        draftReply,
        evaluation,
        knowledgeText,
        memoryContext
      });
    }

    return draftReply;
  } catch (error) {
    console.error("Lỗi Gemini Text:", error.message);
    fs.appendFileSync('debug_log.txt', `[runGeminiText] Error: ${error.stack}\n`);
    return "Dạ shop đã nhận được tin nhắn. Sẽ có nhân viên hỗ trợ anh/chị ngay ạ!";
  }
};


// --- MAIN WORKFLOW ---

const convQueues = {}; // Hàng đợi xử lý tin nhắn để tránh race condition (bot trả lời 2 lần)

const enqueueConversationProcessing = (conversationId, messageText, imageUrls, settings) => {
  if (!convQueues[conversationId]) {
    convQueues[conversationId] = Promise.resolve();
  }

  convQueues[conversationId] = convQueues[conversationId]
    .then(() => processConversation(conversationId, messageText, imageUrls, settings))
    .catch(err => console.error("Lỗi trong hàng đợi xử lý Bot:", err.message));
};

export const handleIncomingMessage = async (conversationId, messageText, imageUrl = null) => {
  const settings = getSettings();
  if (!settings.botEnabled) return; // Bot bị tắt toàn cục

  const imageUrls = imageUrl ? [imageUrl] : [];
  enqueueConversationProcessing(conversationId, messageText, imageUrls, settings);
};

const processConversation = async (conversationId, messageText, imageUrls, settings) => {
  try {
    const conversation = await getConversationById(conversationId);
    if (!conversation) return;

    // 1. Kiểm tra chế độ Bot / Nhân viên
    const isPaused = conversation.bot_paused === 1;
    if (isPaused) {
      // Kiểm tra timeout (2 hours default)
      if (conversation.bot_paused_at) {
        const pausedTime = new Date(conversation.bot_paused_at).getTime();
        const now = Date.now();
        const pauseMs = (settings.botPauseHours || 2) * 60 * 60 * 1000;

        if (now - pausedTime > pauseMs) {
          // Timeout -> Bật lại bot
          await updateBotPausedStatus(conversationId, false);
          console.log(`🤖 Kích hoạt lại Bot cho hội thoại ${conversationId} (Hết hạn pause)`);
        } else {
          // Vẫn đang ở chế độ nhân viên
          return;
        }
      } else {
        return;
      }
    }

    const allowChatbot = await prisma.setting.findUnique({ where: { key: 'gemini_allow_chatbot' } });
    const isAiAllowed = !(allowChatbot && allowChatbot.value === 'false');

    let replyMessage = "";
    let skuConfirmed = null; // SKU đã xác nhận từ Vision/Hash

    // 1.5: Kiểm tra khách có yêu cầu xem ảnh sản phẩm không
    const lowerMsg = (messageText || '').toLowerCase();
    const isAskingPhotos = /gửi (thêm |)ảnh|xem ảnh|có ảnh|cho (xem |em |tôi |)ảnh|ảnh (thực tế|thật|chi tiết|sản phẩm)|hình (ảnh|thật|thực tế)|gửi hình|cho hình|muốn xem|tham khảo ảnh/i.test(lowerMsg);
    const instantReply = isAiAllowed && (!imageUrls || imageUrls.length === 0)
      ? getInstantTextReply(messageText)
      : null;

    if (instantReply) {
      replyMessage = instantReply;
    }
    
    if (isAskingPhotos && (!imageUrls || imageUrls.length === 0)) {
      // Tìm SKU từ tin nhắn của khách trước (nếu khách nói rõ mã)
      let lastSku = null;
      const userSkuMatch = (messageText || '').match(/(?:mã|sku|mẫu)\s+([a-zA-Z0-9-]+)/i);
      if (userSkuMatch) {
        lastSku = userSkuMatch[1].toUpperCase();
      } else {
        // Tìm SKU gần nhất trong lịch sử hội thoại (do bot gửi Form)
        const historyRows = await getMessagesByConversation(conversationId);
        for (let i = historyRows.length - 1; i >= 0; i--) {
          const msg = historyRows[i];
          if (msg.is_from_page) {
            const skuMatch = (msg.message || '').match(/Mã Sản Phẩm:\s*([A-Za-z0-9-]+)/i);
            if (skuMatch) {
              lastSku = skuMatch[1];
              break;
            }
          }
        }
      }

      if (lastSku) {
        console.log(`📸 Khách yêu cầu xem ảnh sản phẩm ${lastSku}. Đang lấy từ Google Drive...`);
        try {
          const { urls: driveUrls, source } = await getProductImagesFromDrive(lastSku, 5);
          
          if (driveUrls.length > 0) {
            // Gửi từng ảnh qua Messenger
            let sentCount = 0;
            for (const imgUrl of driveUrls) {
              try {
                const imageResult = await replyImageCRM(conversation.sender_id, imgUrl, conversation.type, conversationId);
                sentCount++;
                
                const imgMsgId = imageResult?.message_id || ('msg_bot_img_' + Date.now() + Math.floor(Math.random() * 1000));
                const imgTime = new Date().toISOString();
                await saveMessage(imgMsgId, conversationId, `📸 [Ảnh ${lastSku} - ${sentCount}/${driveUrls.length}]`, true, imgTime);
                try {
                  broadcastCRM('new_message', {
                    conversationId,
                    message: { id: imgMsgId, conversation_id: conversationId, message: `📸 [Ảnh ${lastSku} - ${sentCount}/${driveUrls.length}]`, is_from_page: 1, created_time: imgTime }
                  });
                } catch (e) { /* ignore */ }
                
              } catch (imgErr) {
                console.error(`⚠️ Lỗi gửi ảnh Drive ${sentCount + 1}:`, imgErr.message);
              }
            }

            // Gửi tin nhắn text kèm theo
            replyMessage = `Dạ anh/chị ơi, em vừa gửi ${sentCount} ảnh thực tế mẫu ${lastSku.split('-')[0]} để anh/chị tham khảo nha! 📸😊 Anh/chị xem có ưng mẫu nào thì cho em biết để em tư vấn thêm ạ!`;

            // Gửi text và return luôn
            const sendResult = await replyCRM(conversation.sender_id, replyMessage, conversation.type, conversationId);
            const botMsgId = sendResult?.message_id || sendResult?.id || ('msg_bot_' + Date.now() + Math.floor(Math.random() * 1000));
            await saveMessage(botMsgId, conversationId, replyMessage, true, new Date().toISOString());
            try {
              broadcastCRM('new_message', {
                conversationId,
                message: { id: botMsgId, conversation_id: conversationId, message: replyMessage, is_from_page: 1, created_time: new Date().toISOString() }
              });
            } catch (e) { /* ignore */ }
            return; // Xong, không cần xử lý thêm
          } else {
            // Không có ảnh trong Drive → thông báo cho khách
            replyMessage = `Dạ anh/chị ơi, hiện tại mẫu ${lastSku.split('-')[0]} chưa có ảnh thực tế sẵn ạ 😅 Em sẽ báo nhân viên kho chụp và gửi lại cho anh/chị sớm nhất nha! Anh/chị có muốn xem thêm mẫu nào khác không ạ?`;
            
            const sendResult = await replyCRM(conversation.sender_id, replyMessage, conversation.type, conversationId);
            const botMsgId = sendResult?.message_id || sendResult?.id || ('msg_bot_' + Date.now() + Math.floor(Math.random() * 1000));
            await saveMessage(botMsgId, conversationId, replyMessage, true, new Date().toISOString());
            try {
              broadcastCRM('new_message', {
                conversationId,
                message: { id: botMsgId, conversation_id: conversationId, message: replyMessage, is_from_page: 1, created_time: new Date().toISOString() }
              });
            } catch (e) { /* ignore */ }
            return;
          }
        } catch (driveErr) {
          console.error(`⚠️ Lỗi Drive khi lấy ảnh:`, driveErr.message);
          // Fallback: Để AI xử lý bình thường
        }
      }
    }

    // 2. Chấm điểm Hash và AI
    let systemImageContext = "";
    if (imageUrls && imageUrls.length > 0) {
      console.log(`🤖 Bot đang xử lý ${imageUrls.length} ảnh từ khách...`);
      let skuFound = null;
      let usedLayer = 0;

      // Chỉ dùng Hash cho ảnh đầu tiên nếu gửi 1 ảnh để tối ưu
      if (imageUrls.length === 1) {
        const targetHash = await computeHashFromUrl(imageUrls[0]);
        if (targetHash) {
          skuFound = await findMatchingSku(targetHash, 5);
          if (skuFound) usedLayer = 1;
        }
      }

      // getProductInfoFromCatalog moved to top scope

      if (skuFound) {
        // Tra cứu giá từ file JSON cục bộ thay vì Google Sheets API để tránh lỗi sheet
        const productInfo = getProductInfoFromCatalog(skuFound);
        if (productInfo) {
          skuConfirmed = skuFound;
          console.log(`✅ [Lớp ${usedLayer}] Xác nhận SKU: ${skuFound} → Sinh Form trực tiếp`);
        } else {
          systemImageContext = `[HỆ THỐNG PHÂN TÍCH ẢNH: Ảnh khách gửi có mã ${skuFound} nhưng chưa có thông tin giá. Hãy báo khách đợi nhân viên kiểm tra.]\n\n`;
        }
      } else {
        // Lớp 3: Gemini Vision (2-Stage Verification)
        if (settings.enableLayer3 !== false && isAiAllowed) {
          console.log(`🤖 Chuyển qua Lớp 3: Gemini Vision`);
          const layer3Result = await runLayer3GeminiVision(imageUrls, messageText);

          if (layer3Result.sku === "MULTIPLE_MODELS") {
             systemImageContext = `[HỆ THỐNG PHÂN TÍCH ẢNH: Khách gửi nhiều mẫu đồng hồ khác nhau. Hãy báo khách là "Dạ shop đã nhận được các mẫu anh/chị quan tâm. Để tiện tư vấn, anh/chị đang ưng ý form dáng của mẫu nào nhất ạ?"]\n\n`;
          } else if (layer3Result.sku) {
            // Lớp 3 đã tìm thấy SKU chính xác
            const productInfo = getProductInfoFromCatalog(layer3Result.sku);
            if (productInfo) {
              skuConfirmed = layer3Result.sku;
              console.log(`✅ [Lớp 3] Xác nhận SKU: ${layer3Result.sku} → Sinh Form trực tiếp`);
            } else {
              systemImageContext = `[HỆ THỐNG PHÂN TÍCH ẢNH: Nhận diện ảnh: ${layer3Result.message}]\n\n`;
            }
          } else {
            // Lớp 3 không chốt được mã
            systemImageContext = `[HỆ THỐNG PHÂN TÍCH ẢNH: Nhận diện ảnh: ${layer3Result.message}]\n\n`;
          }
        } else {
          systemImageContext = `[HỆ THỐNG PHÂN TÍCH ẢNH: Không nhận diện được ảnh. Hãy báo khách đợi nhân viên kiểm tra.]\n\n`;
        }
      }
    }

    // 2.5: Nếu đã xác nhận SKU → SINH FORM CỨNG TRỰC TIẾP, bỏ qua AI text
    if (replyMessage) {
      console.log('⚡ Bot dùng phản hồi nhanh, bỏ qua Gemini.');
    } else if (skuConfirmed) {
      const sku = skuConfirmed.toUpperCase();
      const productInfo = getProductInfoFromCatalog(sku) || {};
      const isGenericSku = !sku.includes('-');
      const historyRows = await getMessagesByConversation(conversationId);
      const baseSku = sku.split('-')[0];
      const hasSentForm = historyRows.some(msg => msg.is_from_page && (msg.message || "").includes(`Mã Sản Phẩm: ${baseSku}`));

      let chatLieuDay = getChatLieuDay(sku, productInfo);

      if (hasSentForm) {
        replyMessage = `Dạ mẫu bản màu này (${sku}) thì giá ưu đãi hiện tại là: ${productInfo["Giá sale"] || productInfo["Giá bán"]} ạ. Các thông số về kích thước, bộ máy, chống nước... hoàn toàn giống mẫu ${baseSku} em vừa gửi ở trên nha anh/chị! 🥰`;
      } else {
        replyMessage = `Shop xin chào 🤗
Cảm ơn chị đã quan tâm tới các sản phẩm của Shop. Dưới đây là thông tin chi tiết sản phẩm để chị tiện tham khảo ạ.

-Mã Sản Phẩm: ${sku} -
📏Kích thước mặt số : ${productInfo["Kích thước mặt"] || productInfo["Size"] || "Đang cập nhật"}
🤿Khả năng chống nước : ${productInfo["Độ chịu nước"] || productInfo["Water resistance"] || "Đang cập nhật"}
⚙️Bộ máy : ${productInfo["Loại máy"] || productInfo["Bộ máy"] || "Đang cập nhật"} chính hãng
⏳Chế độ bảo hành máy 5 năm.
🗜️Chất liệu vỏ : Thép không gỉ 316L đúc đặc.
⛓️Chất liệu dây: ${chatLieuDay}
🔎 Kính sapphire hạn chế trầy xước.

✅ Giá bán : ${productInfo["Giá sale"] || productInfo["Giá bán"] || productInfo["Giá gốc"] || "Đang cập nhật"}`;

        if (isGenericSku) {
          replyMessage += `|||Dạ mẫu này bên em đang có nhiều màu, anh/chị đang ưng màu nào ạ? 🥰`;
        }
      }
      console.log(`✅ [Form trực tiếp] Đã sinh Form cho SKU ${sku}, bỏ qua AI text.`);

      // Gửi ảnh sản phẩm trước Form text
      const productImageUrl = productInfo['imageUrl'] || productInfo['Link ảnh sản phẩm'];
      if (conversation.type === 'inbox') {
        try {
          console.log(`📸 Đang tìm ảnh thực tế cho ${sku} từ Drive (anh_tu_chup)...`);
          const driveResult = await getProductImagesFromDrive(sku, 3, 'anh_tu_chup');
          let urlsToSend = [];
          if (driveResult.urls && driveResult.urls.length > 0) {
            urlsToSend = driveResult.urls.slice(0, 3);
            console.log(`✅ Tìm thấy ${urlsToSend.length} ảnh tự chụp từ Drive cho ${sku}.`);
          } else if (productImageUrl) {
            urlsToSend = [productImageUrl];
            console.log(`⚠️ Không có ảnh tự chụp, dùng ảnh catalog cho ${sku}.`);
          }

          for (const url of urlsToSend) {
            const imageResult = await replyImageCRM(conversation.sender_id, url, conversation.type, conversationId);
            const imgMsgId = imageResult?.message_id || ('msg_bot_img_' + Date.now() + Math.floor(Math.random() * 1000));
            const imgTime = new Date().toISOString();
            await saveMessage(imgMsgId, conversationId, `📸 [Ảnh sản phẩm ${sku}]`, true, imgTime);
            try {
              broadcastCRM('new_message', {
                conversationId,
                message: { id: imgMsgId, conversation_id: conversationId, message: `📸 [Ảnh sản phẩm ${sku}]`, is_from_page: 1, created_time: imgTime }
              });
            } catch (e) { /* ignore broadcast error */ }
          }
        } catch (imgErr) {
          console.error(`⚠️ Lỗi khi gửi ảnh preview cho ${sku}:`, imgErr.message);
        }
      }
    }
    // 3. Xử lý Logic Text Chung (chỉ khi CHƯA có Form trực tiếp)
    else if (!isAiAllowed) {
      console.log(`🤖 API AI BỊ TẮT -> Fallback kịch bản gốc.`);
      if (imageUrls && imageUrls.length > 0 && !systemImageContext.includes("Không nhận diện được") && !systemImageContext.includes("Nhận diện ảnh")) {
        // Trích xuất mã để trả lời nhanh nếu tắt AI nhưng vẫn dò ra ở lớp 1, 2
        const matchSku = systemImageContext.match(/Mã: ([^)]+)/);
        if (matchSku) {
          replyMessage = `Dạ mẫu anh/chị gửi có mã là **${matchSku[1]}**. Anh/chị đợi chút để nhân viên shop kiểm tra tồn kho nha!`;
        } else {
          replyMessage = "Dạ shop đã nhận được ảnh. Nhân viên shop sẽ phản hồi sớm nhất nha!";
        }
      } else {
        replyMessage = "Dạ hiện tại hệ thống AI đang tạm ngưng, anh/chị cần tư vấn thêm cứ để lại tin nhắn, nhân viên shop sẽ phản hồi sớm nhất nha!";
      }
    } else {
      console.log(`🤖 Bot đang xử lý Ngữ cảnh bằng Gemini...`);
      // Lấy lịch sử 10 tin nhắn gần nhất
      const historyRows = await getMessagesByConversation(conversationId);
      const recentHistory = historyRows.slice(-10); // Không gửi quá dài để đỡ token

      const activeSkuMatch = historyRows.map(msg => msg.message).join(' ').match(/Mã Sản Phẩm: ([A-Za-z0-9]+)/i);
      if (activeSkuMatch) {
         const activeSku = activeSkuMatch[1];
         const catalogPath = path.join(__dirname, '../../data/catalog.json');
         if (fs.existsSync(catalogPath)) {
            const allProducts = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
            const variants = allProducts.filter(p => p['Mã sản phẩm'] && p['Mã sản phẩm'].startsWith(activeSku + '-'));
            if (variants.length > 0) {
               const colorMap = variants.map(v => `- ${v['Mã sản phẩm']}: Màu ${v['Màu mặt số']}`).join('\n');
               systemImageContext += `\n[THÔNG TIN CHỌN MÀU: Khách đang quan tâm mã ${activeSku}. Các biến thể màu hiện có:\n${colorMap}\nNếu khách chọn màu, hãy dùng cú pháp [AVATAR: Mã_SKU] để gửi ảnh Avatar các bản màu đó cho khách so sánh, ví dụ: [AVATAR: ${variants[0]['Mã sản phẩm']}]. TUYỆT ĐỐI KHÔNG dùng cú pháp PRODUCT trong trường hợp này!]\n\n`;
            }
         }
      }

      const finalPrompt = systemImageContext + (messageText || '');
      const geminiResult = await runGeminiText(recentHistory, finalPrompt);
      
      // runGeminiText có thể trả về object { reply, productImageUrl, sku } hoặc string thuần
      if (typeof geminiResult === 'object' && geminiResult.reply) {
        replyMessage = geminiResult.reply;
        
        // Xử lý các thẻ [AVATAR: SKU] (Gửi AVT khi chọn màu)
        const avatarRegex = /\[AVATAR:\s*([a-zA-Z0-9-]+)\]/gi;
        let match;
        let hasAvatar = false;
        while ((match = avatarRegex.exec(replyMessage)) !== null) {
           const avtSku = match[1];
           const pInfo = getProductInfoFromCatalog(avtSku);
           const avtUrl = pInfo?.['imageUrl'] || pInfo?.['Link ảnh sản phẩm'];
           if (avtUrl && conversation.type === 'inbox') {
              hasAvatar = true;
              try {
                 console.log(`📸 Đang gửi ảnh AVT màu sắc ${avtSku} cho khách...`);
                 const imageResult = await replyImageCRM(conversation.sender_id, avtUrl, conversation.type, conversationId);
                 const imgMsgId = imageResult?.message_id || ('msg_bot_img_' + Date.now() + Math.floor(Math.random() * 1000));
                 const imgTime = new Date().toISOString();
                 await saveMessage(imgMsgId, conversationId, `📸 [Ảnh AVT ${avtSku}]`, true, imgTime);
                 try {
                    broadcastCRM('new_message', { conversationId, message: { id: imgMsgId, conversation_id: conversationId, message: `📸 [Ảnh AVT ${avtSku}]`, is_from_page: 1, created_time: imgTime } });
                 } catch (e) { /* ignore */ }
              } catch(e) {
                 console.error(`⚠️ Lỗi khi gửi ảnh AVT ${avtSku}:`, e.message);
              }
           }
        }
        
        replyMessage = replyMessage.replace(avatarRegex, '').trim();

        // Gửi ảnh sản phẩm trước nếu có
        if (geminiResult.sku && conversation.type === 'inbox' && !hasAvatar) {
          try {
            console.log(`📸 Đang tìm ảnh thực tế cho ${geminiResult.sku} từ Drive (anh_tu_chup)...`);
            const driveResult = await getProductImagesFromDrive(geminiResult.sku, 3, 'anh_tu_chup');
            let urlsToSend = [];
            if (driveResult.urls && driveResult.urls.length > 0) {
              urlsToSend = driveResult.urls.slice(0, 3);
              console.log(`✅ Tìm thấy ${urlsToSend.length} ảnh tự chụp từ Drive cho ${geminiResult.sku}.`);
            } else if (geminiResult.productImageUrl) {
              urlsToSend = [geminiResult.productImageUrl];
              console.log(`⚠️ Không có ảnh tự chụp, dùng ảnh catalog cho ${geminiResult.sku}.`);
            }

            for (const url of urlsToSend) {
              const imageResult = await replyImageCRM(conversation.sender_id, url, conversation.type, conversationId);
              const imgMsgId = imageResult?.message_id || ('msg_bot_img_' + Date.now() + Math.floor(Math.random() * 1000));
              const imgTime = new Date().toISOString();
              await saveMessage(imgMsgId, conversationId, `📸 [Ảnh sản phẩm ${geminiResult.sku}]`, true, imgTime);
              try {
                broadcastCRM('new_message', {
                  conversationId,
                  message: { id: imgMsgId, conversation_id: conversationId, message: `📸 [Ảnh sản phẩm ${geminiResult.sku}]`, is_from_page: 1, created_time: imgTime }
                });
              } catch (e) { /* ignore */ }
            }
          } catch (imgErr) {
            console.error(`⚠️ Lỗi khi gửi ảnh preview:`, imgErr.message);
          }
        } else if (geminiResult.productImageUrl && conversation.type === 'inbox' && !hasAvatar) {
          // Trường hợp chỉ hỏi lại biến thể (sku = null), gửi 1 ảnh catalog
          try {
            const imageResult = await replyImageCRM(conversation.sender_id, geminiResult.productImageUrl, conversation.type, conversationId);
            const imgMsgId = imageResult?.message_id || ('msg_bot_img_' + Date.now() + Math.floor(Math.random() * 1000));
            const imgTime = new Date().toISOString();
            await saveMessage(imgMsgId, conversationId, `📸 [Ảnh sản phẩm]`, true, imgTime);
            try {
              broadcastCRM('new_message', { conversationId, message: { id: imgMsgId, conversation_id: conversationId, message: `📸 [Ảnh sản phẩm]`, is_from_page: 1, created_time: imgTime } });
            } catch (e) { /* ignore */ }
          } catch (imgErr) {
            console.error(`⚠️ Lỗi khi gửi ảnh preview:`, imgErr.message);
          }
        }
      } else {
        replyMessage = geminiResult;
      }
    }

    // 4. Lặp qua các tin nhắn nếu có dấu phân cách ||| (Gửi nhiều tin nhắn liên tiếp)
    const messagesToSend = replyMessage.split('|||').map(m => m.trim()).filter(m => m);
    
    for (const msg of messagesToSend) {
      // Gửi qua nền tảng
      const sendResult = await replyCRM(conversation.sender_id, msg, conversation.type, conversationId);
      console.log(`✅ Bot đã trả lời: ${msg}`);

      // Cập nhật DB và UI cục bộ
      const botMessageId = sendResult?.message_id || sendResult?.id || ('msg_bot_' + Date.now() + Math.floor(Math.random() * 1000));
      const createdTime = new Date().toISOString();
      await saveMessage(botMessageId, conversationId, msg, true, createdTime);

      try {
        broadcastCRM('new_message', {
          conversationId,
          message: {
            id: botMessageId,
            conversation_id: conversationId,
            message: msg,
            is_from_page: 1,
            created_time: createdTime
          }
        });
      } catch (e) {
        console.log('⚠️ Không thể broadcast tin nhắn Bot lên UI:', e.message);
      }
    }

  } catch (error) {
    console.error("Lỗi xử lý luồng chatbot:", error.message);
  }
};
