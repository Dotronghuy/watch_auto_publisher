import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConversationById, getMessagesByConversation, updateBotPausedStatus, saveMessage } from '../utils/crm.db.js';
import {
  computeHashFromBuffer,
  findMatchingSku,
  findLikelySkuCandidates,
  findVisualMatchForSkus,
  rememberRecognizedCustomerImage
} from './image-hash.service.js';
import {
  findLocalImageMatches,
  getLocalCatalogThumbnailBuffer
} from './local-image-embedding.service.js';
import { getProductInfoBySku, getShopeeLinkFromProductInfo } from './sheet.service.js';
import { replyCRM, replyImageCRM, sendSenderActionCRM } from './crm.service.js';
import { getProductImagesFromDrive } from './drive.service.js';
import { broadcastCRM } from '../routes/api.routes.js';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { searchKnowledge } from '../utils/vector_search.js';
import { buildMemoryContext } from './chatbot-memory.service.js';
import sharp from 'sharp';
import { readJsonFileSync } from '../utils/json-file.js';

dotenv.config();
const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KNOWLEDGE_PATH = path.join(__dirname, '../../config/chatbot-knowledge.md');
const SETTINGS_PATH = path.join(__dirname, '../../config/settings.json');
const IMAGE_REPLY_TEMPLATE_PATH = path.join(__dirname, '../../config/bot_image_reply_template.md');
const CATALOG_PATH = path.join(__dirname, '../../data/catalog.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const CHATBOT_TARGET_BRAND = String(process.env.CHATBOT_TARGET_BRAND || 'I&W Carnival').trim();
const PRODUCT_FOLLOW_UP_MESSAGE = 'Anh/chị cần em tư vấn thêm về mẫu này hoặc hỗ trợ đặt hàng không ạ? 😊';
const normalizeBrand = (value) => String(value || '').trim().toLocaleLowerCase('vi-VN');
const normalizedTargetBrand = normalizeBrand(CHATBOT_TARGET_BRAND);
const shopeeLinkCache = new Map();
let catalogCache = { mtimeMs: 0, allProducts: [], products: [], excludedBrands: [], excludedSkus: new Set() };
let catalogPromptCache = { mtimeMs: 0, value: '[]' };

const normalizeShopeeLink = (value) => {
  const link = String(value || '').trim();
  if (!link) return '';

  try {
    const url = new URL(link);
    const hostname = url.hostname.toLowerCase();
    const isShopeeHost = hostname === 'shopee.vn'
      || hostname.endsWith('.shopee.vn')
      || hostname === 'vn.shp.ee';
    return url.protocol === 'https:' && isShopeeHost ? link : '';
  } catch {
    return '';
  }
};

const getProductShopeeLink = async (sku, productInfo) => {
  const catalogLink = normalizeShopeeLink(getShopeeLinkFromProductInfo(productInfo));
  if (catalogLink) return catalogLink;

  const lookupSku = String(productInfo?.['Mã sản phẩm'] || sku || '').trim().toUpperCase();
  if (!lookupSku) return '';

  const cachedLink = shopeeLinkCache.get(lookupSku);
  if (cachedLink) return cachedLink;

  const sheetProductInfo = await getProductInfoBySku(lookupSku);
  const sheetLink = normalizeShopeeLink(getShopeeLinkFromProductInfo(sheetProductInfo));
  if (sheetLink) shopeeLinkCache.set(lookupSku, sheetLink);
  return sheetLink;
};

const getCatalogProducts = () => {
  try {
    const stat = fs.statSync(CATALOG_PATH);
    if (catalogCache.mtimeMs !== stat.mtimeMs) {
      const allProducts = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
      const targetProducts = allProducts.filter(
        product => normalizeBrand(product['Thương hiệu']) === normalizedTargetBrand
      );
      const excludedProducts = allProducts.filter(
        product => normalizeBrand(product['Thương hiệu']) !== normalizedTargetBrand
      );
      catalogCache = {
        mtimeMs: stat.mtimeMs,
        allProducts,
        products: targetProducts,
        excludedBrands: Array.from(new Set(
          excludedProducts
            .map(product => String(product['Thương hiệu'] || '').trim())
            .filter(Boolean)
        )),
        excludedSkus: new Set(
          excludedProducts.flatMap(product => {
            const sku = String(product['Mã sản phẩm'] || '').trim().toUpperCase();
            return sku ? [sku, sku.split('-')[0]] : [];
          })
        )
      };
    }
    return catalogCache.products;
  } catch (error) {
    console.warn('Không thể đọc catalog cho chatbot:', error.message);
    return [];
  }
};

const getCatalogBrandNames = () => {
  getCatalogProducts();
  const brands = Array.from(new Set(
    catalogCache.allProducts
      .map(product => String(product['Thương hiệu'] || '').trim())
      .filter(Boolean)
  ));

  return brands.sort((left, right) => {
    if (normalizeBrand(left) === normalizedTargetBrand) return -1;
    if (normalizeBrand(right) === normalizedTargetBrand) return 1;
    return left.localeCompare(right, 'vi');
  });
};

const formatVietnameseList = (items) => {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} và ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} và ${items.at(-1)}`;
};

const getSoldBrandsText = () => formatVietnameseList(getCatalogBrandNames());

const getUnsupportedProductReply = (subject = 'thương hiệu hoặc mã này') =>
  `Dạ bên shop không kinh doanh ${subject} ạ. Hiện shop đang có ${getSoldBrandsText()}. Anh/chị có muốn tham khảo các mẫu của những thương hiệu này không ạ?`;

const getCarnivalAmbiguityReply = () =>
  `Dạ bên shop chỉ kinh doanh thương hiệu ${CHATBOT_TARGET_BRAND}, không phải thương hiệu Carnival riêng ạ. Anh/chị gửi giúp em mã sản phẩm ${CHATBOT_TARGET_BRAND} đang quan tâm để em tư vấn chính xác nhé.`;

const getUnrecognizedImageReply = () =>
  'Dạ em đã phân tích ảnh nhưng chưa chốt được đúng mã sản phẩm ạ. Anh/chị gửi thêm giúp em ảnh rõ mặt số, logo, mặt đáy hoặc mã sản phẩm để em tiếp tục nhận diện chính xác nhé.';

const getRecognizedImageBrandReply = (brand) =>
  `Dạ em nhận diện ảnh thuộc thương hiệu ${brand} ạ, nhưng chưa chốt được đúng mã sản phẩm. Anh/chị gửi thêm giúp em ảnh rõ mặt số, mặt đáy hoặc mã sản phẩm để em kiểm tra chính xác nhé.`;

const getUnsupportedImageBrandReply = (brand) =>
  `Dạ em nhận diện ảnh thuộc thương hiệu ${brand}. Bên shop không kinh doanh thương hiệu này ạ. Hiện shop đang có ${getSoldBrandsText()}; anh/chị có muốn tham khảo các thương hiệu shop đang bán không ạ?`;

const getMentionedExcludedBrand = (messageText) => {
  getCatalogProducts();
  const normalizedMessage = normalizeBrand(messageText);
  return catalogCache.excludedBrands.find(
    brand => normalizedMessage.includes(normalizeBrand(brand))
  ) || null;
};

const getMentionedCatalogBrand = (messageText) => {
  getCatalogProducts();
  const normalizedMessage = normalizeIntentText(messageText);
  const brands = Array.from(new Set(
    catalogCache.allProducts
      .map(product => String(product['Thương hiệu'] || '').trim())
      .filter(Boolean)
  ));

  return brands.find(brand => {
    const normalizedBrandName = normalizeIntentText(brand);
    if (normalizedBrandName && normalizedMessage.includes(normalizedBrandName)) return true;

    if (normalizeBrand(brand) === normalizedTargetBrand) {
      return ['i w', 'iw carnival'].some(alias => normalizedMessage.includes(alias));
    }
    return false;
  }) || null;
};

const isStandaloneCarnivalMention = (messageText) => {
  const text = normalizeIntentText(messageText);
  return /\bcarnival\b/.test(text) && !/\b(?:i w|iw)\s+carnival\b/.test(text);
};

const isProductAvailabilityQuestion = (messageText) => {
  const text = normalizeIntentText(messageText);
  return /\b(?:co ban|co ma|co mau|co hang|co khong|kinh doanh|shop co|ben shop co|ben em co|tu van|muon mua|can mua|tim mua)\b/.test(text);
};

const getPotentialSkuMention = (messageText) => {
  const text = normalizeIntentText(messageText).toUpperCase();
  const tokens = text.match(/[A-Z0-9]+(?:-[A-Z0-9]+)*/g) || [];
  const hasExplicitSkuLabel = /\b(?:MA|MAU|SKU)\b/.test(text);

  return tokens
    .filter(token => {
      if (/^\d+(?:MM|CM|M|ATM)$/.test(token)) return false;
      if (/^[A-Z]+\d+[A-Z0-9-]*$/.test(token) && token.length >= 4) return true;
      if (/^\d+[A-Z][A-Z0-9-]*$/.test(token) && token.length >= 4) return true;
      return hasExplicitSkuLabel && /^\d{5,}$/.test(token);
    })
    .sort((left, right) => right.length - left.length)[0] || null;
};

const getUnknownBrandInquirySubject = (messageText) => {
  const text = normalizeIntentText(messageText);
  const patterns = [
    /\b(?:thuong hieu|hang)\s+([a-z][a-z0-9]*(?:\s+[a-z][a-z0-9]*){0,2})/,
    /\b(?:shop|ben shop|ben em)\s+co(?: ban)?\s+([a-z][a-z0-9]*(?:\s+[a-z][a-z0-9]*){0,2})/,
    /\b(?:co ban|kinh doanh|tu van|muon mua|can mua|tim mua)\s+([a-z][a-z0-9]*(?:\s+[a-z][a-z0-9]*){0,2})/,
    /^([a-z][a-z0-9]*(?:\s+[a-z][a-z0-9]*)?)\s+(?:co\s+)?(?:chinh hang|hang that|auth|authentic|co khong)\b/
  ];
  const genericStarts = new Set([
    'dong', 'ho', 'nam', 'nu', 'mau', 'ma', 'nay', 'do', 'san', 'pham',
    'day', 'mat', 'size', 'gia', 'loai', 'kieu', 'phong', 'chong', 'bao',
    'giao', 'ship', 'freeship', 'hop', 'so', 'the', 'pin', 'may', 'kinh',
    'vo', 'co', 'con', 'hang', 'thuong', 'hieu', 'chinh', 'that', 'gia',
    'fake', 'auth', 'authentic'
  ]);

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const candidate = match[1]
      .split(/\b(?:khong|ko|k|a|ha|nhi|nhe)\b/)[0]
      .trim();
    const words = candidate.split(' ').filter(Boolean);
    if (words.length > 0 && !genericStarts.has(words[0])) {
      return candidate;
    }
  }

  return null;
};

const getCatalogScopeReply = (messageText) => {
  const catalogSkuMention = getCatalogSkuMention(messageText);
  if (!catalogSkuMention && isStandaloneCarnivalMention(messageText)) {
    return getCarnivalAmbiguityReply();
  }

  if (!catalogSkuMention && (isProductAvailabilityQuestion(messageText) || isAuthenticityQuestion(messageText))) {
    if (getPotentialSkuMention(messageText)) {
      return getUnsupportedProductReply('mã này');
    }

    const mentionedCatalogBrand = getMentionedCatalogBrand(messageText);
    if (!mentionedCatalogBrand && getUnknownBrandInquirySubject(messageText)) {
      return getUnsupportedProductReply('thương hiệu này');
    }
  }

  return null;
};

const getBrandRedirectReply = ({ brand = '', sku = '' } = {}) => {
  const availabilityLine = sku && brand
    ? `Dạ bên shop có mã ${sku} của thương hiệu ${brand} ạ.`
    : brand
      ? `Dạ bên shop có kinh doanh thương hiệu ${brand} ạ.`
      : '';
  const redirectLine = `Hiện shop đang tập trung tư vấn ${CHATBOT_TARGET_BRAND}; anh/chị có muốn tham khảo các mẫu ${CHATBOT_TARGET_BRAND} không ạ?`;
  return availabilityLine ? `${availabilityLine} ${redirectLine}` : `Dạ ${redirectLine}`;
};

const getCatalogSkuMention = (messageText) => {
  getCatalogProducts();
  const tokens = String(messageText || '').toUpperCase().match(/[A-Z0-9]+(?:-[A-Z0-9]+)*/g) || [];

  for (const token of tokens.sort((a, b) => b.length - a.length)) {
    if (token.length < 4 || !/[A-Z]/.test(token) || !/\d/.test(token)) continue;
    if (getProductInfoFromCatalog(token)) return { sku: token, isTargetBrand: true };
    if (catalogCache.excludedSkus.has(token)) return { sku: token, isTargetBrand: false };
  }

  return null;
};

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
        const thinkingBudget = modelName.includes('pro') ? 128 : 0;
        const config = {
          generationConfig: {
            ...(requireJSON ? { responseMimeType: 'application/json' } : {}),
            thinkingConfig: { thinkingBudget }
          }
        };
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
      return readJsonFileSync(SETTINGS_PATH);
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
  const normalizedSku = String(skuCode || '').trim().toUpperCase();
  if (!normalizedSku) return null;

  const catalog = getCatalogProducts();
  let found = catalog.find(p => String(p['Mã sản phẩm'] || '').toUpperCase() === normalizedSku);
  if (!found) {
    // Fallback: Tìm biến thể đầu tiên của mã gốc này (vd: 55883G -> 55883G-T1)
    found = catalog.find(p => String(p['Mã sản phẩm'] || '').toUpperCase().startsWith(normalizedSku + '-'));
  }
  return found || null;
};

const getExactProductInfoFromCatalog = (skuCode) => {
  const normalizedSku = String(skuCode || '').trim().toUpperCase();
  if (!normalizedSku) return null;
  return getCatalogProducts().find(
    product => String(product['Mã sản phẩm'] || '').trim().toUpperCase() === normalizedSku
  ) || null;
};

const getProductInfoFromAllCatalog = (skuCode) => {
  const normalizedSku = String(skuCode || '').trim().toUpperCase();
  if (!normalizedSku) return null;

  getCatalogProducts();
  let found = catalogCache.allProducts.find(
    product => String(product['Mã sản phẩm'] || '').toUpperCase() === normalizedSku
  );
  if (!found) {
    found = catalogCache.allProducts.find(
      product => String(product['Mã sản phẩm'] || '').toUpperCase().startsWith(normalizedSku + '-')
    );
  }
  return found || null;
};

const getExactProductInfoFromAllCatalog = (skuCode) => {
  const normalizedSku = String(skuCode || '').trim().toUpperCase();
  if (!normalizedSku) return null;
  getCatalogProducts();
  return catalogCache.allProducts.find(
    product => String(product['Mã sản phẩm'] || '').trim().toUpperCase() === normalizedSku
  ) || null;
};

export const getRecentExactCatalogSku = (
  messages,
  now = Date.now(),
  maxAgeMs = 30 * 60 * 1000
) => {
  for (let index = (messages || []).length - 1; index >= 0; index--) {
    const message = messages[index];
    const createdAt = new Date(message.created_time).getTime();
    if (Number.isFinite(createdAt) && now - createdAt > maxAgeMs) break;

    if (!message?.is_from_page) {
      // A new customer image starts a new product turn. Never cross it to reuse
      // an exact SKU from an older image/conversation turn.
      if (/\[IMAGE:[^\]]*\]/i.test(String(message?.message || ''))) {
        return null;
      }
      continue;
    }

    const skuTokens = String(message.message || '')
      .toUpperCase()
      .match(/[A-Z0-9]+-[A-Z0-9]+/g) || [];
    const exactSku = skuTokens.find(token => getExactProductInfoFromCatalog(token));
    if (exactSku) return exactSku;
  }
  return null;
};

export const getRecentCustomerImageUrl = (
  messages,
  now = Date.now(),
  maxAgeMs = 10 * 60 * 1000
) => {
  for (let index = (messages || []).length - 1; index >= 0; index--) {
    const message = messages[index];
    const createdAt = new Date(message?.created_time).getTime();
    if (Number.isFinite(createdAt) && now - createdAt > maxAgeMs) break;
    if (message?.is_from_page) continue;

    const imageMatches = Array.from(
      String(message?.message || '').matchAll(/\[IMAGE:\s*([^\]]+)\]/gi)
    );
    const imageUrl = imageMatches.at(-1)?.[1]?.trim();
    if (imageUrl) return imageUrl;
  }
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

    const allProducts = getCatalogProducts();
    const uniqueCatalog = [];
    const seenSku = new Set();

    for (const product of allProducts) {
      const sku = product['Mã sản phẩm'];
      if (!sku) continue;

      const baseSku = sku.split('-')[0];
      let description = [
        product['Mô tả ngắn'],
        product['Lấy cảm hứng từ'],
        product['Phong cách']
      ].filter(Boolean).join(' - ');
      if (!description) description = CHATBOT_TARGET_BRAND;

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
    let hasS = false, hasT = false, hasD = false;
    const variants = getCatalogProducts().filter(
      p => p['Mã sản phẩm'] && p['Mã sản phẩm'].startsWith(baseSku + '-')
    );
    variants.forEach(v => {
      if (v['Mã sản phẩm'].includes('-S')) hasS = true;
      if (v['Mã sản phẩm'].includes('-T')) hasT = true;
      if (v['Mã sản phẩm'].includes('-D')) hasD = true;
    });

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
  const variants = getCatalogProducts().filter(
    p => p['Mã sản phẩm'] && p['Mã sản phẩm'].startsWith(baseSku + '-')
  );
  if (variants.length > 0) {
    
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

export const buildProductFormText = ({
  sku,
  productInfo,
  shopeeLink = '',
  hasSentForm = false
}) => {
  const price = getGiaBan(sku, productInfo) || 'Đang cập nhật';
  const shopeeLine = shopeeLink ? `\n\n🛒 Link Shopee: ${shopeeLink}` : '';

  if (hasSentForm) {
    return `Dạ mẫu bản màu này (${sku}) có giá ưu đãi hiện tại là ${price} ạ.${shopeeLine}`;
  }

  const strapMaterial = getChatLieuDay(sku, productInfo);
  return `Shop xin chào 🤗
Cảm ơn anh/chị đã quan tâm tới sản phẩm của Shop. Dưới đây là thông tin chi tiết để anh/chị tiện tham khảo ạ.

-Mã Sản Phẩm: ${sku} -
📏Kích thước mặt số : ${productInfo["Kích thước mặt"] || productInfo["Size"] || "Đang cập nhật"}
🤿Khả năng chống nước : ${productInfo["Độ chịu nước"] || productInfo["Water resistance"] || "Đang cập nhật"}
⚙️Bộ máy : ${productInfo["Loại máy"] || productInfo["Bộ máy"] || "Đang cập nhật"} chính hãng
⏳Chế độ bảo hành máy 5 năm.
🗜️Chất liệu vỏ : Thép không gỉ 316L đúc đặc.
⛓️Chất liệu dây: ${strapMaterial}
🔎 Kính sapphire hạn chế trầy xước.

✅ Giá bán : ${price}${shopeeLine}|||${PRODUCT_FOLLOW_UP_MESSAGE}`;
};

// --- CORE AI LOGIC ---

const parsedVisionCatalogLimit = Number.parseInt(
  process.env.CHATBOT_VISION_CATALOG_LIMIT || '350',
  10
);
const VISION_CATALOG_LIMIT = Number.isFinite(parsedVisionCatalogLimit)
  ? Math.max(100, parsedVisionCatalogLimit)
  : 350;
const MAX_VISION_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_VISION_IMAGES = 4;
const MAX_HASH_FAMILY_HINTS = 3;
const MAX_VARIANTS_PER_HASH_FAMILY = 4;
const MAX_STAGE2_CANDIDATES = 20;
const VISION_BOUNDING_BOX_SCALE = 1000;
const VISION_CROP_PADDING_RATIO = 0.12;
const VISION_CANDIDATE_CACHE_TTL_MS = 30 * 60 * 1000;
const VISION_CANDIDATE_CACHE_MAX_ITEMS = 160;
const visionCandidateImageCache = new Map();

const toVisionImagePart = (buffer, mimeType = 'image/jpeg') => ({
  inlineData: {
    data: buffer.toString('base64'),
    mimeType
  }
});

const fetchVisionImageSource = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const declaredSize = Number(response.headers.get('content-length')) || 0;
  if (declaredSize > MAX_VISION_SOURCE_BYTES) {
    throw new Error(`Ảnh vượt giới hạn ${MAX_VISION_SOURCE_BYTES / 1024 / 1024} MB`);
  }

  const sourceBuffer = Buffer.from(await response.arrayBuffer());
  if (sourceBuffer.length > MAX_VISION_SOURCE_BYTES) {
    throw new Error(`Ảnh vượt giới hạn ${MAX_VISION_SOURCE_BYTES / 1024 / 1024} MB`);
  }

  const responseMimeType = response.headers.get('content-type') || 'image/jpeg';
  return {
    sourceBuffer,
    mimeType: responseMimeType.startsWith('image/') ? responseMimeType : 'image/jpeg'
  };
};

const buildVisionImagePart = async (sourceBuffer, mimeType, enhanced = false) => {
  try {
    let pipeline = sharp(sourceBuffer)
      .rotate()
      .resize({
        width: enhanced ? 2560 : 2048,
        height: enhanced ? 2560 : 2048,
        fit: 'inside',
        withoutEnlargement: !enhanced
      })
      .flatten({ background: '#ffffff' });

    if (enhanced) {
      pipeline = pipeline
        .normalize()
        .sharpen(1.4)
        .modulate({ brightness: 1.05 });
    }

    const optimizedBuffer = await pipeline
      .jpeg({ quality: enhanced ? 92 : 88, mozjpeg: true })
      .toBuffer();
    return toVisionImagePart(optimizedBuffer);
  } catch (error) {
    console.warn(`⚠️ Không tối ưu được ảnh Vision, dùng ảnh gốc: ${error.message}`);
    return toVisionImagePart(sourceBuffer, mimeType);
  }
};

const getVisionImagePartFromUrl = async (url) => {
  const { sourceBuffer, mimeType } = await fetchVisionImageSource(url);
  return buildVisionImagePart(sourceBuffer, mimeType);
};

const getVisionCandidateImageBufferFromUrl = async (url, sku = '') => {
  const localThumbnail = getLocalCatalogThumbnailBuffer(sku, url);
  if (localThumbnail) return localThumbnail;
  const cached = visionCandidateImageCache.get(url);
  if (cached?.expiresAt > Date.now()) {
    return cached.buffer;
  }

  const { sourceBuffer } = await fetchVisionImageSource(url);
  const buffer = await sharp(sourceBuffer)
    .rotate()
    .resize(320, 300, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  visionCandidateImageCache.delete(url);
  visionCandidateImageCache.set(url, {
    buffer,
    expiresAt: Date.now() + VISION_CANDIDATE_CACHE_TTL_MS
  });
  while (visionCandidateImageCache.size > VISION_CANDIDATE_CACHE_MAX_ITEMS) {
    const oldestKey = visionCandidateImageCache.keys().next().value;
    visionCandidateImageCache.delete(oldestKey);
  }
  return buffer;
};

const buildCandidateContactSheetVisionPart = async (candidates) => {
  const columns = Math.min(4, Math.max(1, candidates.length));
  const rows = Math.ceil(candidates.length / columns);
  const cellWidth = 340;
  const cellHeight = 350;
  const composites = [];

  candidates.forEach((candidate, candidateIndex) => {
    const left = (candidateIndex % columns) * cellWidth;
    const top = Math.floor(candidateIndex / columns) * cellHeight;
    const safeSku = String(candidate.sku || '').replace(/[^A-Z0-9-]/gi, '');
    const label = Buffer.from(
      `<svg width="${cellWidth}" height="50">`
      + `<rect width="${cellWidth}" height="50" fill="white"/>`
      + `<text x="${cellWidth / 2}" y="32" font-family="Arial" font-size="24" `
      + `font-weight="bold" text-anchor="middle" fill="black">${safeSku}</text>`
      + `</svg>`
    );
    composites.push(
      { input: candidate.buffer, left: left + 10, top: top + 4 },
      { input: label, left, top: top + 300 }
    );
  });

  const contactSheetBuffer = await sharp({
    create: {
      width: columns * cellWidth,
      height: rows * cellHeight,
      channels: 3,
      background: '#eeeeee'
    }
  })
    .composite(composites)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  return toVisionImagePart(contactSheetBuffer);
};

const getCustomerVisionImagePartsFromUrl = async (url) => {
  const { sourceBuffer, mimeType } = await fetchVisionImageSource(url);
  const [original, enhanced] = await Promise.all([
    buildVisionImagePart(sourceBuffer, mimeType),
    buildVisionImagePart(sourceBuffer, mimeType, true)
  ]);
  return { original, enhanced, sourceBuffer, mimeType };
};

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const getVisionWatchBoundingBox = (visionAnalysis, imageIndex) => {
  const entries = Array.isArray(visionAnalysis?.watch_bboxes)
    ? visionAnalysis.watch_bboxes
    : [];
  const entry = entries.find(item => Number(item?.image_index) === imageIndex)
    || entries[imageIndex];
  const rawBox = Array.isArray(entry)
    ? entry
    : entry?.box_2d || entry?.box || entry?.bbox;
  if (!Array.isArray(rawBox) || rawBox.length !== 4) return null;

  const values = rawBox.map(Number);
  if (values.some(value => !Number.isFinite(value))) return null;
  const scale = Math.max(...values) <= 1.01 ? 1 : VISION_BOUNDING_BOX_SCALE;
  const normalized = values.map(value => clampNumber(value / scale, 0, 1));
  const [top, left, bottom, right] = normalized;
  if (bottom - top < 0.08 || right - left < 0.08) return null;
  return { top, left, bottom, right };
};

const buildCroppedWatchVisionPart = async (sourceBuffer, boundingBox) => {
  if (!sourceBuffer || !boundingBox) return null;

  try {
    const orientedBuffer = await sharp(sourceBuffer).rotate().toBuffer();
    const metadata = await sharp(orientedBuffer).metadata();
    if (!metadata.width || !metadata.height) return null;

    const boxWidth = boundingBox.right - boundingBox.left;
    const boxHeight = boundingBox.bottom - boundingBox.top;
    const horizontalPadding = boxWidth * VISION_CROP_PADDING_RATIO;
    const verticalPadding = boxHeight * VISION_CROP_PADDING_RATIO;
    const leftRatio = clampNumber(boundingBox.left - horizontalPadding, 0, 1);
    const topRatio = clampNumber(boundingBox.top - verticalPadding, 0, 1);
    const rightRatio = clampNumber(boundingBox.right + horizontalPadding, 0, 1);
    const bottomRatio = clampNumber(boundingBox.bottom + verticalPadding, 0, 1);
    const left = Math.floor(leftRatio * metadata.width);
    const top = Math.floor(topRatio * metadata.height);
    const width = Math.max(1, Math.ceil(rightRatio * metadata.width) - left);
    const height = Math.max(1, Math.ceil(bottomRatio * metadata.height) - top);

    const croppedBuffer = await sharp(orientedBuffer)
      .extract({
        left,
        top,
        width: Math.min(width, metadata.width - left),
        height: Math.min(height, metadata.height - top)
      })
      .resize({
        width: 1800,
        height: 1800,
        fit: 'inside',
        withoutEnlargement: false
      })
      .normalize()
      .sharpen(1.25)
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();

    return toVisionImagePart(croppedBuffer);
  } catch (error) {
    console.warn(`Khong the cat vung dong ho tu anh khach: ${error.message}`);
    return null;
  }
};

const getVisionSkuTokens = (value) => {
  const tokens = String(value || '').toUpperCase().match(/[A-Z0-9]+(?:-[A-Z0-9]+)*/g) || [];
  return Array.from(new Set(tokens.filter(
    token => token.length >= 4 && /[A-Z]/.test(token) && /\d/.test(token)
  )));
};

const getSkuFamily = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .split('-')[0];

const getExactSkusInFamily = (familyCode, { targetBrandOnly = false } = {}) => {
  const normalizedFamily = getSkuFamily(familyCode);
  if (!normalizedFamily) return [];
  getCatalogProducts();

  return Array.from(new Set(catalogCache.allProducts
    .filter(product => {
      const sku = String(product['Mã sản phẩm'] || '').trim().toUpperCase();
      if (!sku.includes('-') || getSkuFamily(sku) !== normalizedFamily) return false;
      return !targetBrandOnly
        || normalizeBrand(product['Thương hiệu']) === normalizedTargetBrand;
    })
    .map(product => String(product['Mã sản phẩm'] || '').trim().toUpperCase())
    .filter(Boolean)));
};

export const getVisionCatalogCandidates = (
  visionAnalysis,
  hashCandidateSku = null,
  likelyHashCandidateSkus = []
) => {
  getCatalogProducts();
  const allProducts = catalogCache.allProducts;
  const normalizedHashCandidate = String(hashCandidateSku || '').trim().toUpperCase();
  const normalizedHashFamily = getSkuFamily(normalizedHashCandidate);
  const normalizedLikelyHashCandidates = Array.from(new Set(
    (likelyHashCandidateSkus || [])
      .map(sku => String(sku || '').trim().toUpperCase())
      .filter(Boolean)
  ));
  const likelyHashRank = new Map(
    normalizedLikelyHashCandidates.map((sku, index) => [sku, index])
  );
  const likelyFamilyRank = new Map();
  normalizedLikelyHashCandidates.forEach((sku, index) => {
    const family = getSkuFamily(sku);
    if (family && !likelyFamilyRank.has(family)) {
      likelyFamilyRank.set(family, index);
    }
  });
  const analyzedBrand = Number(visionAnalysis?.brand_confidence) >= 0.8
    && String(visionAnalysis?.brand_evidence || '').trim()
    ? visionAnalysis?.brand
    : '';
  const ocrText = [
    visionAnalysis?.text_in_image,
    visionAnalysis?.model_code,
    analyzedBrand
  ].filter(Boolean).join(' ');
  const visualFeatures = visionAnalysis?.visual_features
    && typeof visionAnalysis.visual_features === 'object'
    ? visionAnalysis.visual_features
    : {};
  const visualFeatureText = Object.values(visualFeatures)
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .join(' ');
  const description = String(visionAnalysis?.description || '');
  const normalizedVisionDescription = normalizeIntentText(
    `${visionAnalysis?.model_code || ''} ${description} ${visualFeatureText}`
  );
  const skuTokens = getVisionSkuTokens(ocrText);
  const mentionedBrand = getMentionedCatalogBrand(ocrText);
  const normalizedStrapHint = normalizeIntentText(visualFeatures.strap_type || '');
  const visionStrapType = /\b(?:steel|metal|thep|kim loai)\b/.test(normalizedStrapHint)
    || /\b(?:day|bracelet).{0,24}\b(?:thep|kim loai|bac)\b/.test(normalizedVisionDescription)
    ? 'steel'
    : /\b(?:leather|da)\b/.test(normalizedStrapHint)
      || /\b(?:day|strap).{0,24}\b(?:da|leather)\b/.test(normalizedVisionDescription)
      ? 'leather'
      : /\b(?:rubber|silicone|cao su)\b/.test(normalizedStrapHint)
        || /\b(?:day|strap).{0,24}\b(?:cao su|rubber|silicone)\b/.test(normalizedVisionDescription)
        ? 'rubber'
        : '';
  const normalizedDialHint = normalizeIntentText(visualFeatures.dial_color || '');
  const dialColorMatchers = [
    {
      query: /\b(?:mat|mat so).{0,24}\b(?:trang|bac|silver|white)\b/,
      hint: /\b(?:trang|bac|silver|white)\b/,
      product: /\b(?:trang|bac|kham trai trang)\b/
    },
    {
      query: /\b(?:mat|mat so).{0,24}\b(?:xanh duong|xanh bien|navy|blue)\b/,
      hint: /\b(?:xanh duong|xanh bien|navy|blue)\b/,
      product: /\b(?:xanh duong|xanh bien|navy)\b/
    },
    {
      query: /\b(?:mat|mat so).{0,24}\b(?:den|black)\b/,
      hint: /\b(?:den|black)\b/,
      product: /\b(?:den|kham trai den|ngoc trai den)\b/
    },
    {
      query: /\b(?:mat|mat so).{0,24}\b(?:xanh la|green)\b/,
      hint: /\b(?:xanh la|green)\b/,
      product: /\b(?:xanh la|green)\b/
    },
    {
      query: /\b(?:mat|mat so).{0,24}\b(?:nau|brown)\b/,
      hint: /\b(?:nau|brown)\b/,
      product: /\b(?:nau|brown)\b/
    },
    {
      query: /\b(?:mat|mat so).{0,24}\b(?:do|red)\b/,
      hint: /\b(?:do|red)\b/,
      product: /\b(?:do|red)\b/
    }
  ].filter(({ query, hint }) =>
    query.test(normalizedVisionDescription) || hint.test(normalizedDialHint)
  );
  const styleSignals = [
    { query: /\bnautilus\b/, product: /\bnautilus\b/ },
    { query: /\b(?:royal oak|royal-oak)\b/, product: /\b(?:royal oak|royal-oak)\b/ },
    { query: /\b(?:tonneau|thung ruou)\b/, product: /\b(?:tonneau|thung ruou)\b/ },
    {
      query: /\b(?:santos|vuong bo tron|rounded square)\b/,
      product: /\b(?:santos|vuong bo tron|rounded square)\b/
    }
  ].filter(({ query }) => query.test(normalizedVisionDescription));
  const normalizedDialLayout = normalizeIntentText(visualFeatures.dial_layout || '');
  const wantsSimpleDial = /\b(?:three hand|three hands|three hand date|3 hand|ba kim|simple dial)\b/
    .test(normalizedDialLayout);
  const complexDialMatcher = /\b(?:chronograph|tourbillon|open heart|skeleton|moonphase|moon phase|subdial|sub dial)\b/;
  const normalizedCaseHint = normalizeIntentText([
    visualFeatures.case_shape,
    ...(Array.isArray(visualFeatures.distinctive_features)
      ? visualFeatures.distinctive_features
      : [])
  ].filter(Boolean).join(' '));
  const wantsAngularCase = /\b(?:octagonal|rounded square|square|bat giac|vuong bo tron)\b/
    .test(normalizedCaseHint);
  const wantsRoundCase = /\b(?:round|tron)\b/.test(normalizedCaseHint);
  const normalizedBezelHint = normalizeIntentText(visualFeatures.bezel_style || '');
  const wantsPlainBezel = /\b(?:plain|smooth|khong dinh da|tron)\b/.test(normalizedBezelHint);
  const wantsGemBezel = /\b(?:diamond|gem|stone|dinh da)\b/.test(normalizedBezelHint);
  const queryTokens = new Set(
    normalizeIntentText(`${ocrText} ${description}`)
      .split(' ')
      .filter(token => token.length >= 3 && ![
        'dong', 'ho', 'mau', 'mat', 'day', 'anh', 'san', 'pham', 'chiec',
        'hinh', 'co', 'voi', 'mot', 'cua'
      ].includes(token))
  );

  const ranked = allProducts.map((product, index) => {
    const sku = String(product['Mã sản phẩm'] || '').trim().toUpperCase();
    const brand = String(product['Thương hiệu'] || '').trim();
    const normalizedDial = normalizeIntentText(product['Màu mặt số']);
    const normalizedStrap = normalizeIntentText(product['Chất liệu dây']);
    const normalizedInspiration = normalizeIntentText(product['Lấy cảm hứng từ']);
    const normalizedAppearance = normalizeIntentText([
      product['Tên sản phẩm'],
      product['Mô tả ngắn'],
      product['Mô tả đầy đủ']
    ].filter(Boolean).join(' '));
    const searchable = normalizeIntentText([
      product['Tên sản phẩm'],
      product['Màu mặt số'],
      product['Chất liệu dây'],
      product['Chất liệu vỏ'],
      product['Phong cách'],
      product['Lấy cảm hứng từ'],
      product['Mô tả ngắn'],
      product['Mô tả đầy đủ']
    ].filter(Boolean).join(' '));
    let score = 0;

    const hashBrandCompatible = !mentionedBrand
      || normalizeBrand(brand) === normalizeBrand(mentionedBrand);
    if (normalizedHashCandidate && hashBrandCompatible) {
      if (sku === normalizedHashCandidate) score += 250;
      else if (normalizedHashFamily && getSkuFamily(sku) === normalizedHashFamily) {
        score += 120;
      }
    }

    if (hashBrandCompatible) {
      const directHintRank = likelyHashRank.get(sku);
      if (Number.isInteger(directHintRank)) {
        score += Math.max(16, 48 - directHintRank * 4);
      }

      const familyHintRank = likelyFamilyRank.get(getSkuFamily(sku));
      if (Number.isInteger(familyHintRank)) {
        score += Math.max(32, 88 - familyHintRank * 7);
      }
    }

    if (visionStrapType) {
      const strapMatches = visionStrapType === 'steel'
        ? /\b(?:thep|kim loai)\b/.test(normalizedStrap)
        : visionStrapType === 'leather'
          ? /\bda\b/.test(normalizedStrap)
          : /\b(?:cao su|rubber|silicone)\b/.test(normalizedStrap);
      score += strapMatches ? 36 : -18;
    }

    if (dialColorMatchers.length > 0) {
      const dialMatches = dialColorMatchers.some(
        ({ product: matcher }) => matcher.test(normalizedDial)
      );
      score += dialMatches ? 28 : -8;
    }

    for (const { product: matcher } of styleSignals) {
      score += matcher.test(normalizedInspiration) || matcher.test(searchable)
        ? 110
        : -24;
    }

    if (wantsSimpleDial) {
      score += complexDialMatcher.test(searchable) ? -52 : 24;
    } else if (complexDialMatcher.test(normalizedDialLayout)) {
      score += complexDialMatcher.test(searchable) ? 52 : -18;
    }

    if (wantsAngularCase) {
      score += /\b(?:bat giac|goc canh|vuong bo tron|octagonal|rounded square)\b/
        .test(normalizedAppearance)
        ? 64
        : -24;
    } else if (wantsRoundCase) {
      score += /\b(?:mat tron|vanh tron|bezel tron|round case)\b/.test(normalizedAppearance)
        ? 32
        : 0;
    }

    const productHasGemBezel = /\b(?:vien|vanh|bezel).{0,28}\b(?:dinh da|diamond|gem|stone)\b/
      .test(searchable);
    if (wantsPlainBezel) score += productHasGemBezel ? -32 : 14;
    if (wantsGemBezel) score += productHasGemBezel ? 38 : -16;

    for (const token of skuTokens) {
      const normalizedToken = token.replace(/[^A-Z0-9]/g, '');
      const normalizedSku = sku.replace(/[^A-Z0-9]/g, '');
      if (normalizedSku === normalizedToken) score += 200;
      else if (normalizedSku.startsWith(normalizedToken) || normalizedToken.startsWith(normalizedSku)) score += 120;
      else if (normalizedSku.includes(normalizedToken)) score += 80;
    }

    if (mentionedBrand && normalizeBrand(brand) === normalizeBrand(mentionedBrand)) {
      score += 60;
    }

    for (const token of queryTokens) {
      if (searchable.includes(token)) score += 2;
    }

    return { product, score, index };
  }).sort((left, right) => right.score - left.score || left.index - right.index);

  const hasUsefulSignal = ranked[0]?.score > 0;
  const selected = hasUsefulSignal
    ? ranked.slice(0, VISION_CATALOG_LIMIT)
    : ranked;

  return selected.map(({ product }) => ({
    sku: product['Mã sản phẩm'],
    brand: product['Thương hiệu'],
    dial: product['Màu mặt số'],
    strap: product['Chất liệu dây'],
    case: product['Chất liệu vỏ'],
    style: product['Phong cách'] || '',
    inspiration: product['Lấy cảm hứng từ'] || '',
    desc: String(product['Mô tả ngắn'] || '').slice(0, 280)
  }));
};

const hasStrongStructuredVisionSignal = (visionAnalysis) => {
  const brandIsReliable = Number(visionAnalysis?.brand_confidence) >= 0.8
    && String(visionAnalysis?.brand_evidence || '').trim();
  if (!brandIsReliable) return false;

  const features = visionAnalysis?.visual_features || {};
  const combined = normalizeIntentText([
    visionAnalysis?.model_code,
    visionAnalysis?.description,
    ...Object.values(features).flatMap(value => Array.isArray(value) ? value : [value])
  ].filter(Boolean).join(' '));
  const signals = [
    /\b(?:nautilus|royal oak|tonneau|santos|tank|octagonal|rounded square)\b/.test(combined),
    /\b(?:black|white|silver|blue|navy|green|brown|red|den|trang|bac|xanh|nau|do)\b/.test(combined),
    /\b(?:steel|metal|leather|rubber|silicone|thep|kim loai|cao su)\b/.test(combined),
    /\b(?:three hand|chronograph|tourbillon|open heart|skeleton|moonphase|subdial)\b/.test(combined)
  ].filter(Boolean).length;
  return signals >= 3;
};

export const getHashFamilyVisionCandidates = (
  catalogCandidates,
  likelyHashCandidateSkus
) => {
  const hintedFamilies = Array.from(new Set(
    (likelyHashCandidateSkus || [])
      .map(getSkuFamily)
      .filter(Boolean)
  )).slice(0, MAX_HASH_FAMILY_HINTS);
  const selectedSkus = [];

  for (const family of hintedFamilies) {
    const rankedFamilySkus = catalogCandidates
      .filter(candidate => getSkuFamily(candidate.sku) === family)
      .map(candidate => String(candidate.sku || '').trim().toUpperCase())
      .filter(Boolean);
    const topFamilySkus = rankedFamilySkus.slice(
      0,
      MAX_VARIANTS_PER_HASH_FAMILY - 1
    );
    const topVariantType = String(topFamilySkus[0] || '').split('-')[1]?.[0] || '';
    const representativeSku = topVariantType
      ? rankedFamilySkus.find(sku => sku === `${family}-${topVariantType}1`)
      : null;
    const familySkus = Array.from(new Set([
      ...topFamilySkus,
      representativeSku
    ].filter(Boolean))).slice(0, MAX_VARIANTS_PER_HASH_FAMILY);
    selectedSkus.push(...familySkus);
  }

  return Array.from(new Set(selectedSkus));
};

const sanitizeDetectedBrand = (value) => String(value || '')
  .replace(/[^\p{L}\p{N}&.' -]/gu, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 40);

const getVisionRecognitionFallback = (visionAnalysis) => {
  const visibleText = String(visionAnalysis?.text_in_image || '');
  const rawBrand = sanitizeDetectedBrand(visionAnalysis?.brand);
  const brandEvidence = String(visionAnalysis?.brand_evidence || '').trim();
  const brandConfidence = Number(visionAnalysis?.brand_confidence) || 0;
  const catalogBrandFromText = getMentionedCatalogBrand(visibleText);
  const catalogBrandFromAnalysis = getMentionedCatalogBrand(rawBrand);
  const catalogBrand = catalogBrandFromText
    || (brandConfidence >= 0.85 && brandEvidence ? catalogBrandFromAnalysis : null);
  const standaloneCarnival = isStandaloneCarnivalMention(visibleText)
    || (rawBrand && isStandaloneCarnivalMention(rawBrand));

  if (catalogBrand) {
    return {
      sku: null,
      brand: catalogBrand,
      isCatalogBrand: true,
      message: getRecognizedImageBrandReply(catalogBrand)
    };
  }

  if (standaloneCarnival) {
    return {
      sku: null,
      brand: 'Carnival',
      isCatalogBrand: false,
      preserveScopeReply: true,
      message: getCarnivalAmbiguityReply()
    };
  }

  if (rawBrand && brandConfidence >= 0.9 && brandEvidence) {
    return {
      sku: null,
      brand: rawBrand,
      isCatalogBrand: false,
      preserveScopeReply: true,
      message: getUnsupportedImageBrandReply(rawBrand)
    };
  }

  return { sku: null, brand: null, isCatalogBrand: false, message: getUnrecognizedImageReply() };
};

const buildAttentionWatchVisionPart = async sourceBuffer => {
  if (!sourceBuffer) return null;
  try {
    const buffer = await sharp(sourceBuffer)
      .rotate()
      .resize(1400, 1400, { fit: 'cover', position: sharp.strategy.attention })
      .flatten({ background: '#ffffff' })
      .normalize()
      .sharpen(1.2)
      .jpeg({ quality: 91, mozjpeg: true })
      .toBuffer();
    return toVisionImagePart(buffer);
  } catch (error) {
    console.warn(`Cannot build fast Vision crop: ${error.message}`);
    return null;
  }
};

const verifyVisionCandidateSkus = async ({
  candidateSkus,
  customerImageParts,
  requiredBrand = '',
  logLabel = 'Vision verification'
}) => {
  const startedAt = Date.now();
  const normalizedCandidateSkus = Array.from(new Set((candidateSkus || [])
    .map(sku => String(sku || '').trim().toUpperCase())
    .filter(Boolean)))
    .slice(0, MAX_STAGE2_CANDIDATES);
  if (!normalizedCandidateSkus.length || !customerImageParts?.length) {
    return { sku: null, elapsedMs: Date.now() - startedAt };
  }

  const { getAllProductsWithImages } = await import('./sheet.service.js');
  const allProducts = await getAllProductsWithImages();
  const productsBySku = new Map(allProducts.map(product => [
    String(product.sku || '').trim().toUpperCase(),
    product
  ]));
  const candidateImages = normalizedCandidateSkus
    .map(sku => productsBySku.get(sku))
    .filter(product => product && getExactProductInfoFromAllCatalog(product.sku));
  if (!candidateImages.length) {
    return { sku: null, elapsedMs: Date.now() - startedAt };
  }

  const loadedCandidateImages = await Promise.all(candidateImages.map(async candidate => {
    try {
      return {
        sku: String(candidate.sku || '').trim().toUpperCase(),
        buffer: await getVisionCandidateImageBufferFromUrl(candidate.imageUrl, candidate.sku)
      };
    } catch (error) {
      console.warn(`[${logLabel}] Cannot load catalog image ${candidate.sku}: ${error.message}`);
      return null;
    }
  }));
  const verifiedCandidateImages = loadedCandidateImages.filter(Boolean);
  const verifiedCandidateSkus = verifiedCandidateImages.map(candidate => candidate.sku);
  if (!verifiedCandidateSkus.length) {
    return { sku: null, elapsedMs: Date.now() - startedAt };
  }

  const candidateContactSheetPart = await buildCandidateContactSheetVisionPart(
    verifiedCandidateImages
  );
  const requiredBrandRule = requiredBrand
    ? `The customer image must visibly match brand "${requiredBrand}".`
    : 'Reject a candidate when the visible logo or brand differs from the catalog product.';
  const prompt = `The first image(s) are customer photos of one watch. The LAST image is a catalog contact sheet; each exact SKU is printed below its product photo.
Compare the customer watch against every catalog cell and return an exact variant only when case shape, dial layout, dial color, strap material/color, indices, date position and decorations all match.
${requiredBrandRule}
Important: standalone "Carnival" is not "I&W Carnival" unless the I&W name/logo is visibly supported.
Do not infer a color variant from model family alone. One major mismatch means exact_match=false and sku=null.
Return JSON only:
{"sku":"one exact printed SKU, MULTIPLE_MODELS, or null","exact_match":true,"confidence":0.0,"visible_brand":"brand name or null","brand_confidence":0.0,"brand_evidence":"visible logo/text or empty","mismatch_reason":"short reason"}
Set exact_match=true only when all major visible details match and confidence is at least 0.92.`;

  console.log(`${logLabel}: comparing ${verifiedCandidateSkus.length} catalog variants.`);
  const result = await runWithModelFallback([
    prompt,
    ...customerImageParts,
    candidateContactSheetPart
  ], true);
  const responseText = result.response.text();
  const parsed = cleanJSONResponse(responseText) || {};
  const visionAnalysis = {
    brand: String(parsed.visible_brand || '').trim() || null,
    brand_confidence: Number(parsed.brand_confidence) || 0,
    brand_evidence: String(parsed.brand_evidence || '').trim()
  };
  const rawSku = String(parsed.sku || '').trim().toUpperCase();
  if (rawSku === 'MULTIPLE_MODELS') {
    return {
      sku: rawSku,
      elapsedMs: Date.now() - startedAt,
      responseText,
      visionAnalysis
    };
  }

  const exactSku = verifiedCandidateSkus.find(candidateSku => rawSku === candidateSku);
  const confidence = Number(parsed.confidence) || 0;
  const exactProduct = parsed.exact_match === true && confidence >= 0.92 && exactSku
    ? getExactProductInfoFromAllCatalog(exactSku)
    : null;
  const brandMatches = !requiredBrand
    || normalizeBrand(exactProduct?.['Thương hiệu']) === normalizeBrand(requiredBrand);
  if (exactProduct && brandMatches) {
    console.log(`${logLabel}: confirmed ${exactSku} at ${confidence} in ${Date.now() - startedAt} ms.`);
    return {
      sku: exactSku,
      brand: String(exactProduct['Thương hiệu'] || '').trim(),
      isCatalogBrand: true,
      message: '',
      elapsedMs: Date.now() - startedAt,
      responseText,
      visionAnalysis
    };
  }

  console.log(`${logLabel}: no safe exact match in ${Date.now() - startedAt} ms.`);
  return {
    sku: null,
    elapsedMs: Date.now() - startedAt,
    responseText,
    visionAnalysis,
    mismatchReason: String(parsed.mismatch_reason || '').trim()
  };
};

/**
 * Xử lý Lớp 3: Gọi Gemini Vision
 */
export const runLayer3GeminiVision = async (
  imageUrls,
  messageText,
  {
    hashCandidateSku = null,
    likelyHashCandidateSkus = [],
    localEmbeddingCandidateSkus = [],
    preloadedCustomerImageSources = []
  } = {}
) => {
  try {
    const customerImageParts = [];
    const enhancedCustomerImageParts = [];
    const customerImageSources = [];
    for (const [imageIndex, url] of imageUrls.slice(0, MAX_VISION_IMAGES).entries()) {
      try {
        const imageParts = preloadedCustomerImageSources[imageIndex]
          || await getCustomerVisionImagePartsFromUrl(url);
        customerImageParts.push(imageParts.original);
        enhancedCustomerImageParts.push(imageParts.enhanced);
        customerImageSources.push(imageParts);
      } catch (e) {
        console.error(`[Lớp 3] Lỗi tải ảnh khách từ FB:`, e.message);
      }
    }

    if (customerImageParts.length === 0) {
      return { sku: null, message: getUnrecognizedImageReply() };
    }

    if (localEmbeddingCandidateSkus.length > 0) {
      const attentionParts = (await Promise.all(
        customerImageSources.map(source => buildAttentionWatchVisionPart(source.sourceBuffer))
      )).filter(Boolean);
      const fastCustomerParts = Array.from(new Set([
        ...(attentionParts.length > 0 ? attentionParts : enhancedCustomerImageParts),
        ...customerImageParts
      ])).slice(0, MAX_VISION_IMAGES);
      const fastResult = await verifyVisionCandidateSkus({
        candidateSkus: localEmbeddingCandidateSkus,
        customerImageParts: fastCustomerParts,
        logLabel: 'Local fast path'
      });
      if (fastResult.sku) return fastResult;
      console.log('Local fast path was ambiguous; returning a safe one-pass fallback.');
      return getVisionRecognitionFallback(fastResult.visionAnalysis || {});
    }

    // Chặng 1: Semantic Search & Text OCR
    const analysisImageParts = enhancedCustomerImageParts.length > 0
      ? enhancedCustomerImageParts
      : customerImageParts;
    const prompt1A = `Khách hàng gửi ${analysisImageParts.length} ảnh đã được tối ưu độ phân giải, tương phản và độ nét. Lời nhắn: "${messageText}".
Nhiệm vụ: 
1. Đọc MỌI chữ/số xuất hiện trong TẤT CẢ CÁC ẢNH (đặc biệt là mã sản phẩm, thương hiệu).
2. LƯU Ý QUAN TRỌNG: Nếu ảnh là một bức ảnh ghép (collage) gồm nhiều ô nhỏ, chụp nhiều góc cạnh khác nhau của CÙNG 1 CHIẾC ĐỒNG HỒ, hãy coi đó là DUY NHẤT 1 MẪU ĐỒNG HỒ, không được nhầm lẫn thành nhiều mẫu.
3. Mô tả ngoại hình đồng hồ (màu mặt số, màu vỏ, loại dây) của (các) mẫu xuất hiện.
4. Chỉ xác định thương hiệu khi nhìn thấy logo/tên hãng đủ rõ. "Carnival" đứng riêng KHÔNG phải là "I&W Carnival"; chỉ ghi "I&W Carnival" khi ảnh thể hiện đủ tên hoặc logo I&W.
5. Mỗi ảnh là một ảnh khách gửi đã được tối ưu để đọc chi tiết; không được tự tạo thêm sản phẩm.
6. Với mỗi ảnh gốc, khoanh đúng chiếc đồng hồ bằng box_2d theo thứ tự [ymin, xmin, ymax, xmax], tọa độ chuẩn hóa 0-1000. Loại phần giao diện TikTok/Facebook, chữ chèn, bàn tay và nền nếu có thể.
7. Phân loại cấu trúc mặt số thật cụ thể; không gộp mặt ba kim đơn giản với chronograph, open-heart, skeleton, tourbillon hoặc moonphase.
Trả về JSON:
{
  "text_in_image": "các chữ đọc được",
  "brand": "tên thương hiệu nhìn thấy hoặc null",
  "brand_confidence": 0.0-1.0,
  "brand_evidence": "chữ/logo làm căn cứ hoặc rỗng",
  "model_code": "mã sản phẩm nhìn thấy hoặc null",
  "description": "mô tả ngoại hình",
  "watch_bboxes": [{"image_index": 0, "box_2d": [ymin, xmin, ymax, xmax]}],
  "visual_features": {
    "case_shape": "round|octagonal|rounded square|tonneau|rectangular|other",
    "dial_color": "màu chính",
    "strap_type": "steel|leather|rubber|other",
    "dial_layout": "three hand date|three hand|chronograph|open heart|skeleton|tourbillon|moonphase|other",
    "index_style": "baton|roman|arabic|diamond|mixed|other",
    "date_position": "3|6|12|no date|unknown",
    "bezel_style": "plain|diamond|textured|other",
    "distinctive_features": ["chi tiết nhận diện"]
  }
}`;

    console.log(`🤖 Đang chạy Lớp 3 Chặng 1A (Vision OCR)...`);
    const result1A = await runWithModelFallback([
      prompt1A,
      ...analysisImageParts
    ], true);
    const visionOutput = result1A.response.text();
    console.log(`🤖 Kết quả Vision:`, visionOutput);
    const visionAnalysis = cleanJSONResponse(visionOutput) || {
      text_in_image: visionOutput,
      description: visionOutput
    };
    const brandGateResult = getVisionRecognitionFallback(visionAnalysis);
    if (brandGateResult.preserveScopeReply) {
      console.log(
        `🛑 Vision chặn ứng viên hash ${hashCandidateSku || '(không có)'} do nhận diện thương hiệu ${brandGateResult.brand || 'ngoài phạm vi'}.`
      );
      return brandGateResult;
    }

    const croppedCustomerImageParts = (
      await Promise.all(customerImageSources.map(async (source, imageIndex) => {
        const boundingBox = getVisionWatchBoundingBox(visionAnalysis, imageIndex);
        return buildCroppedWatchVisionPart(source.sourceBuffer, boundingBox);
      }))
    ).filter(Boolean);
    if (croppedCustomerImageParts.length > 0) {
      console.log(
        `Đã tách ${croppedCustomerImageParts.length} vùng đồng hồ khỏi nền để đối chiếu SKU.`
      );
    }

    const visionCatalogCandidates = getVisionCatalogCandidates(
      visionAnalysis,
      hashCandidateSku,
      likelyHashCandidateSkus
    );
    const hashFamilyCandidates = getHashFamilyVisionCandidates(
      visionCatalogCandidates,
      likelyHashCandidateSkus
    );
    const useStructuredShortlist = hasStrongStructuredVisionSignal(visionAnalysis);
    let stage1Result = { candidates: [] };

    if (useStructuredShortlist) {
      stage1Result.candidates = visionCatalogCandidates
        .slice(0, MAX_STAGE2_CANDIDATES)
        .map(candidate => String(candidate.sku || '').trim().toUpperCase())
        .filter(Boolean);
      console.log('Dùng bộ lọc đặc trưng ảnh trực tiếp; bỏ qua chặng semantic trung gian.');
    } else {
      let catalogData = JSON.stringify(visionCatalogCandidates);
      let prompt1B = `Bạn là chuyên gia tư vấn. Dựa vào kết quả phân tích ảnh:
${visionOutput}
Và lời nhắn của khách: "${messageText}"

Dưới đây là các sản phẩm từ toàn bộ dữ liệu Product của shop được dùng để nhận diện (JSON):
${catalogData}

Nhiệm vụ: Tìm tối đa 5 mã SKU khớp nhất với phân tích trên, không giới hạn ở ${CHATBOT_TARGET_BRAND}. Không được trả về SKU ngoài danh sách.
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
      catalogData = null;
      prompt1B = null;

      try {
        const text = result1B.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        stage1Result = JSON.parse(jsonMatch[0]);
        stage1Result.candidates = Array.isArray(stage1Result.candidates)
          ? stage1Result.candidates.map(sku => String(sku || '').trim().toUpperCase()).filter(Boolean)
          : [];
      } catch (e) {
        console.error("[Lớp 3] Lỗi parse JSON Chặng 1B:", e.message);
        fs.appendFileSync('debug_log.txt', `[Lớp 3] JSON Error 1B: ${e.message}\n`);
      }
    }

    stage1Result.candidates = Array.from(new Set([
      ...(useStructuredShortlist ? [] : hashFamilyCandidates),
      ...(stage1Result.candidates || [])
    ])).slice(0, MAX_STAGE2_CANDIDATES);

    if (!stage1Result.candidates || stage1Result.candidates.length === 0) {
      return getVisionRecognitionFallback(visionAnalysis);
    }

    console.log('🤖 Chặng 1 Lớp 3 đã lọc ứng viên:', stage1Result.candidates);
    console.log(
      `🤖 Chuẩn bị Chặng 2. Heap ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB.`
    );

    // Chặng 2: Visual Verification (So sánh ảnh chéo)
    const { getAllProductsWithImages } = await import('./sheet.service.js');
    const allProducts = await getAllProductsWithImages();
    const candidateSkuSet = new Set(stage1Result.candidates);
    const candidateImages = allProducts.filter(
      p => candidateSkuSet.has(String(p.sku || '').trim().toUpperCase())
        && getExactProductInfoFromAllCatalog(p.sku)
    );

    if (candidateImages.length === 0) {
      return getVisionRecognitionFallback(visionAnalysis);
    }

    // Tải song song ảnh ứng viên để giảm thời gian nhận diện biến thể.
    const verificationCustomerImageParts = croppedCustomerImageParts.length > 0
      ? croppedCustomerImageParts
      : customerImageParts;
    const loadedCandidateImages = await Promise.all(candidateImages.map(async (candidate) => {
      try {
        return {
          sku: String(candidate.sku || '').trim().toUpperCase(),
          buffer: await getVisionCandidateImageBufferFromUrl(candidate.imageUrl, candidate.sku)
        };
      } catch (error) {
        console.error(`[Lớp 3] Ngoại lệ khi tải ảnh kho SKU ${candidate.sku}:`, error.message);
        return null;
      }
    }));

    const verifiedCandidateImages = loadedCandidateImages.filter(Boolean);
    const verifiedCandidateSkus = verifiedCandidateImages.map(candidate => candidate.sku);
    if (verifiedCandidateSkus.length === 0) {
      return getVisionRecognitionFallback(visionAnalysis);
    }
    const candidateContactSheetPart = await buildCandidateContactSheetVisionPart(
      verifiedCandidateImages
    );
    const prompt2 = `Các ảnh đầu là vùng đồng hồ đã tách từ ảnh khách gửi (hoặc ảnh gốc nếu không thể tách). Ảnh CUỐI CÙNG là bảng ảnh sản phẩm của shop; mã SKU chính xác được in ngay bên dưới từng ô.
Nhiệm vụ: So sánh đồng hồ của khách với từng ô trong bảng và đọc đúng nhãn SKU nằm ngay dưới ô khớp.
Chỉ xác nhận SKU khi ảnh khách và ảnh sản phẩm khớp cùng một chiếc đồng hồ, không được chọn mẫu chỉ vì nhìn gần giống.
LƯU Ý CỰC KỲ QUAN TRỌNG:
- Nếu ảnh nhìn rõ logo/tên hãng thì thương hiệu trên ảnh khách phải khớp thương hiệu của SKU ứng viên. "Carnival" riêng không được coi là "I&W Carnival".
- So sánh theo thứ tự: hình dáng vỏ/niềng, mặt đơn hay nhiều mặt phụ, bố cục cọc số, màu mặt, dây, vị trí lịch và các chi tiết trang trí.
- Mặt ba kim đơn giản tuyệt đối không được ghép với chronograph, open-heart, skeleton, tourbillon hoặc moonphase.
- Chỉ cần một chi tiết lớn khác nhau (ví dụ mặt bạc thay vì xanh, dây đen thay vì xanh, bố cục cọc số khác) thì exact_match phải là false và sku phải là null.
- Nếu ảnh khách là ảnh ghép của cùng một chiếc đồng hồ thì coi là một mẫu, nhưng vẫn phải trả về null nếu không có ảnh kho khớp chính xác.
- Chỉ trả về "MULTIPLE_MODELS" nếu tập ảnh khách chứa nhiều chiếc đồng hồ có form thiết kế khác biệt hoàn toàn.
- Không được trả về mã gốc hoặc tự đoán biến thể màu.
- Trường "sku" chỉ chứa nguyên mã in dưới ảnh, không kèm tên hãng, dấu ngoặc hoặc lời giải thích.
Chỉ trả về JSON định dạng:
{ "sku": "SKU chính xác, MULTIPLE_MODELS hoặc null", "exact_match": true/false, "confidence": 0.0-1.0, "mismatch_reason": "chi tiết khớp hoặc khác nhau" }.
    Chỉ đặt exact_match=true khi mọi đặc điểm chính đều khớp và confidence từ 0.92 trở lên.`;

    console.log(
      `🤖 Đang chạy Lớp 3 Chặng 2 với ${verifiedCandidateSkus.length} ảnh đối chiếu.`
    );
    const result2 = await runWithModelFallback([
      prompt2,
      ...verificationCustomerImageParts,
      candidateContactSheetPart
    ], true);
    const responseText2 = result2.response.text();
    let stage2Result = { sku: null };
    try {
      stage2Result = cleanJSONResponse(responseText2) || JSON.parse(responseText2);
    } catch (e) { }

    const rawExactSku = String(stage2Result.sku || '').trim().toUpperCase();
    const exactSku = verifiedCandidateSkus.find(
      candidateSku => rawExactSku === candidateSku
        || rawExactSku.includes(candidateSku)
    ) || rawExactSku;
    const confidence = Number(stage2Result.confidence) || 0;
    const isVerifiedExactMatch = stage2Result.exact_match === true
      && confidence >= 0.92
      && verifiedCandidateSkus.includes(exactSku);

    if (exactSku === "MULTIPLE_MODELS") {
      return { sku: exactSku, message: "" };
    }

    const exactProduct = isVerifiedExactMatch ? getExactProductInfoFromAllCatalog(exactSku) : null;
    const exactProductMatchesVisionBrand = !brandGateResult.isCatalogBrand
      || normalizeBrand(exactProduct?.['Thương hiệu']) === normalizeBrand(brandGateResult.brand);
    if (exactProduct && exactProductMatchesVisionBrand) {
      console.log(`🤖 Chặng 2 Lớp 3 xác nhận SKU: ${exactSku} (confidence ${confidence})`);
      return {
        sku: exactSku,
        brand: String(exactProduct['Thương hiệu'] || '').trim(),
        isCatalogBrand: true,
        message: ""
      };
    } else {
      if (exactProduct && !exactProductMatchesVisionBrand) {
        console.warn(
          `🛑 Từ chối SKU ${exactSku}: Vision đọc thương hiệu ${brandGateResult.brand}, nhưng SKU thuộc ${exactProduct['Thương hiệu']}.`
        );
      }
      fs.appendFileSync('debug_log.txt', `[Lớp 3] Chặng 2 Failed. Candidates: ${stage1Result.candidates.join(',')}. Result2: ${result2.response.text()}\n`);
      return getVisionRecognitionFallback(visionAnalysis);
    }

  } catch (error) {
    console.error("[Lớp 3] Lỗi gọi Gemini Vision:", error);
    fs.appendFileSync('debug_log.txt', `[Lớp 3] Error Catch: ${error.message}\n`);
    return { sku: null, message: getUnrecognizedImageReply() };
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
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const isProductPhotoRequest = (messageText) => {
  const text = normalizeIntentText(messageText);
  return /\b(?:gui(?: them)?|xin|xem|co|muon xem|tham khao)\s+(?:anh|hinh)\b/.test(text)
    || /\bcho\s+(?:(?:anh|chi|em|toi|minh)\s+)?(?:xem\s+)?(?:anh|hinh)\b/.test(text)
    || /\b(?:anh|hinh)\s+(?:thuc te|that|chi tiet|san pham)\b/.test(text);
};

export const getFocusedProductQuestion = (messageText) => {
  const text = normalizeIntentText(messageText);
  if (
    /\b(?:size|kich thuoc|duong kinh)\b/.test(text)
    || /\bmat(?: so)?\s+bao nhieu\b/.test(text)
    || /\bbao nhieu\s*mm\b/.test(text)
  ) {
    return 'size';
  }
  return null;
};

export const getFocusedProductReply = (messageText, sku, productInfo = {}) => {
  if (getFocusedProductQuestion(messageText) !== 'size') return null;

  const size = String(
    productInfo['Kích thước mặt']
      || productInfo.Size
      || ''
  ).trim();
  if (!size) {
    return `Dạ kích thước mặt của mẫu ${sku} hiện đang được cập nhật ạ. Em sẽ nhờ nhân viên shop kiểm tra lại chính xác cho anh/chị nhé.`;
  }

  return `Dạ mẫu ${sku} có kích thước mặt ${size} ạ. Anh/chị cho em xin chu vi cổ tay, em tư vấn độ vừa vặn chính xác hơn nhé.`;
};

export const shouldSendFullProductForm = (messageText) => {
  const text = normalizeIntentText(messageText);
  const asksPrice = /\b(?:gia|bao gia|bao nhieu tien|gia bao nhieu)\b/.test(text)
    || /\b(?:ma|mau|con|chiec|dong ho|san pham)(?: nay| do)?\s+bao nhieu\b/.test(text);
  const asksDetails = /\b(?:thong so|thong tin chi tiet|chi tiet san pham|gioi thieu san pham)\b/.test(text);
  const asksPurchase = /\b(?:dat hang|mua o dau|mua the nao|cach mua|link shopee|link mua|gui link|chot don)\b/.test(text);
  const asksAvailability = /\b(?:co ban|co ma|co hang|shop co|ben shop co|ben em co|muon mua|can mua|tim mua)\b/.test(text)
    || /\bco mau(?: nay| do)? khong\b/.test(text);
  return asksPrice
    || asksDetails
    || asksPurchase
    || asksAvailability;
};

export const getRecentProductIntentText = (
  messages,
  now = Date.now(),
  maxAgeMs = 10 * 60 * 1000,
  imageLeadMs = 5_000
) => {
  const rows = Array.isArray(messages) ? messages : [];
  let latestCustomerImageTime = null;

  for (let index = rows.length - 1; index >= 0; index--) {
    const message = rows[index];
    if (message?.is_from_page) continue;
    if (!/\[IMAGE:[^\]]*\]/i.test(String(message?.message || ''))) continue;

    const createdAt = new Date(message.created_time).getTime();
    if (Number.isFinite(createdAt) && now - createdAt <= maxAgeMs) {
      latestCustomerImageTime = createdAt;
    }
    break;
  }

  const oldestAllowedTime = latestCustomerImageTime !== null
    ? latestCustomerImageTime - imageLeadMs
    : now - maxAgeMs;

  for (let index = rows.length - 1; index >= 0; index--) {
    const message = rows[index];
    if (message?.is_from_page) continue;

    const createdAt = new Date(message?.created_time).getTime();
    if (Number.isFinite(createdAt) && createdAt < oldestAllowedTime) continue;
    if (Number.isFinite(createdAt) && now - createdAt > maxAgeMs) continue;

    const text = String(message?.message || '')
      .replace(/\[(?:IMAGE|VIDEO|FILE|AUDIO):[^\]]*\]/gi, '')
      .trim();
    if (!text) continue;

    if (
      shouldSendFullProductForm(text)
      || getFocusedProductQuestion(text)
      || isProductPhotoRequest(text)
    ) {
      return text;
    }
  }

  return '';
};

const isAuthenticityQuestion = (messageText) => {
  const text = normalizeIntentText(messageText);
  return /\b(?:chinh hang|hang that|hang auth|authentic|hang gia|hang fake|fake|real)\b/.test(text);
};

const isGeneralAuthenticityQuestion = (messageText) => {
  const text = normalizeIntentText(messageText);
  return /^(?:shop|ben shop|cua shop|san pham ben shop|hang ben shop|dong ho ben shop)\b/.test(text);
};

const UNKNOWN_AUTHENTICITY_REPLY =
  'Dạ, shop chưa có đủ thông tin để xác nhận mẫu này có phải hàng chính hãng không ạ.';

const GENERAL_AUTHENTICITY_REPLY =
  'Dạ, các thương hiệu bên shop đang bán đều là hàng chính hãng ạ.';

const getVerifiedAuthenticityReply = (sku, productInfo) => {
  const brand = String(productInfo?.['Thương hiệu'] || CHATBOT_TARGET_BRAND).trim();
  return sku
    ? `Dạ, mẫu ${sku} của ${brand} bên shop là hàng chính hãng ạ.`
    : `Dạ, các mẫu ${brand} bên shop là hàng chính hãng ạ.`;
};

const isWarrantySupportRequest = (messageText) => {
  const text = normalizeIntentText(messageText);
  return /\b(?:bao hanh|sua chua|sua dong ho|hong|bi loi|loi may|hap hoi|vao nuoc|nuoc vao|dong nuoc|mo kinh|chet may|dung may|khong chay|chay sai|roi kim|gay day|vo kinh|tray xuoc)\b/.test(text)
    || /\b(?:moi mua|vua mua).{0,50}\b(?:bi|hong|loi|hap hoi|vao nuoc)\b/.test(text);
};

const isExplicitSupportClosingPhrase = (messageText) => {
  const lastLine = String(messageText || '')
    .split(/\r?\n/)
    .map(line => normalizeIntentText(line))
    .filter(Boolean)
    .at(-1) || '';
  return /^(?:(?:shop|ad)\s+)?(?:ho tro|giup)(?:\s+(?:toi|minh|em))?(?:\s+(?:voi|nhe|nha|a))?$/.test(lastLine)
    || /^nho\s+(?:shop|ad)\s+(?:ho tro|giup)(?:\s+(?:toi|minh|em))?(?:\s+(?:voi|nhe|nha|a))?$/.test(lastLine);
};

const WARRANTY_RETURN_SIGNATURE = 'gửi lại đồng hồ giúp em để shop tiến hành kiểm tra trực tiếp';
const WARRANTY_CONTEXT_WINDOW_MS = 10 * 60 * 1000;
const WARRANTY_RECEIVING_ADDRESS =
  'Số 14 LK4, Tổng Cục V, Yên Xá, Tân Triều, Hà Nội';
const WARRANTY_HOTLINE =
  String(process.env.CHATBOT_HOTLINE || '0977 758 365').trim();

const getWarrantyReturnReply = () => {
  const returnMessage =
    'Dạ anh/chị gửi lại đồng hồ giúp em để shop tiến hành kiểm tra trực tiếp nhé. Khi nhận được sản phẩm, bên em sẽ kiểm tra tình trạng và phản hồi phương án xử lý cụ thể cho anh/chị. Trong lúc chờ, anh/chị vui lòng không tự mở đáy hoặc sấy nóng đồng hồ ạ.';
  const contactMessage =
    `📍 Địa chỉ tiếp nhận: ${WARRANTY_RECEIVING_ADDRESS}. Hotline: ${WARRANTY_HOTLINE}. Anh/chị có thể để lại số điện thoại để nhân viên shop gọi hướng dẫn đóng gói và tiếp nhận, hoặc gọi hotline/số điện thoại in trên thẻ bảo hành trước khi gửi đồng hồ ạ.`;
  return `${returnMessage}|||${contactMessage}`;
};

const getWarrantyIntakeReply = ({ brand, sku = '' }) => {
  void brand;
  void sku;
  return getWarrantyReturnReply();
};

const getUnverifiedWarrantyReply = () =>
  getWarrantyReturnReply();

const getWarrantyBrandMismatchReply = (brand = '') => {
  void brand;
  return getWarrantyReturnReply();
};

const getRecentWarrantyContext = (messages) => {
  const cutoff = Date.now() - WARRANTY_CONTEXT_WINDOW_MS;
  const recentMessages = (messages || []).filter((message) => {
    const createdAt = new Date(message.created_time).getTime();
    return !Number.isFinite(createdAt) || createdAt >= cutoff;
  });

  let complaintIndex = -1;
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    if (!message.is_from_page && isWarrantySupportRequest(message.message)) {
      complaintIndex = index;
      break;
    }
  }

  if (complaintIndex < 0) {
    return { hasComplaint: false, alreadyReplied: false };
  }

  const recentCustomerComplaint = recentMessages[complaintIndex];
  const complaintTime = new Date(recentCustomerComplaint.created_time).getTime();
  const hasNewerUnrelatedCustomerTopic = recentMessages
    .slice(complaintIndex + 1)
    .some((message) => {
      if (message.is_from_page) return false;

      const customerText = String(message.message || '')
        .replace(/\[(?:IMAGE|VIDEO|FILE|AUDIO):[^\]]*\]/gi, '')
        .trim();

      if (!customerText) return false;
      return !isWarrantySupportRequest(customerText)
        && !isExplicitSupportClosingPhrase(customerText);
    });

  if (hasNewerUnrelatedCustomerTopic) {
    return { hasComplaint: false, alreadyReplied: false };
  }

  const alreadyReplied = recentMessages.some((message) => {
    if (!message.is_from_page) return false;
    const replyTime = new Date(message.created_time).getTime();
    if (
      Number.isFinite(complaintTime)
      && Number.isFinite(replyTime)
      && replyTime < complaintTime
    ) {
      return false;
    }
    return normalizeIntentText(message.message).includes(
      normalizeIntentText(WARRANTY_RETURN_SIGNATURE),
    );
  });

  return { hasComplaint: true, alreadyReplied };
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

export const isDiscountRequest = (messageText) => {
  const text = normalizeIntentText(messageText);
  return /\b(?:giam gia|giam them|bot gia|gia bot|co bot|fix gia|gia fix|chot gia|gia chot|uu dai them|sale them|khuyen mai them|re hon)\b/.test(text);
};

export const buildShopeeDiscountReply = ({ sku, shopeeLink }) =>
  `Dạ mẫu ${sku} khi đặt trực tiếp trên Shopee thường có giá tốt hơn đáng kể nhờ voucher và ưu đãi của sàn ạ. Anh/chị bấm đúng link dưới đây, áp dụng thêm voucher/freeship đang có để nhận mức giá tốt nhất nhé:

🛒 Link Shopee: ${shopeeLink}

Anh/chị chốt mẫu này thì đặt trực tiếp qua link giúp em để hưởng trọn ưu đãi ạ.`;

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
 - Chi duoc khang dinh chinh hang khi co SKU thuoc danh muc shop va san pham duoc mua truc tiep tu shop.
 - Mau, thuong hieu hoac anh chua doi chieu duoc voi SKU trong danh muc thi phai noi khong the xac nhan chinh hang.
 - Khong de lo cac tu noi bo nhu "danh muc", "he thong", "sheet" hoac "SKU duoc phep" trong cau tra loi cho khach.
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
 Tuyet doi khong khang dinh chinh hang cho mau/thuong hieu ngoai danh muc hoac chua doi chieu duoc SKU. Voi san pham trong danh muc, chi cam ket cho hang mua truc tiep tu shop.
 Khong dung cac tu noi bo nhu "danh muc", "he thong", "sheet" hoac "SKU duoc phep" khi viet cau tra loi cho khach.

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
    const catalogScopeReply = getCatalogScopeReply(newMessage);
    if (catalogScopeReply) {
      console.log('ℹ️ Phản hồi theo phạm vi thương hiệu/mã sản phẩm của shop.');
      return catalogScopeReply;
    }

    const excludedBrand = getMentionedExcludedBrand(newMessage);
    if (excludedBrand) {
      console.log(`ℹ️ Chuyển hướng yêu cầu ${excludedBrand} sang ${CHATBOT_TARGET_BRAND}.`);
      return getBrandRedirectReply({ brand: excludedBrand });
    }
    const skuMention = getCatalogSkuMention(newMessage);
    if (skuMention && !skuMention.isTargetBrand) {
      console.log(`ℹ️ Bỏ qua SKU ${skuMention.sku} vì không thuộc ${CHATBOT_TARGET_BRAND}.`);
      const productInfo = getProductInfoFromAllCatalog(skuMention.sku);
      return getBrandRedirectReply({
        brand: String(productInfo?.['Thương hiệu'] || '').trim(),
        sku: skuMention.sku
      });
    }

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
    const soldBrandsText = getSoldBrandsText();

    const systemPrompt = `Bạn là trợ lý ảo chuyên tư vấn đồng hồ ${CHATBOT_TARGET_BRAND} của shop.
Hãy trả lời lịch sự, thân thiện, dùng emoji hợp lý. Không bịa đặt thông tin.
LƯU Ý QUAN TRỌNG:
1. NGÔN NGỮ CHÍNH LÀ TIẾNG VIỆT. Bạn có thể dùng một số từ Tiếng Anh thông dụng trong thương mại (như: Shop, Sale, Size, Freeship, Fullbox, SKU). BẠN KHÔNG BIẾT VÀ KHÔNG ĐƯỢC PHÉP DÙNG BẤT KỲ NGÔN NGỮ NÀO KHÁC. KHÔNG DỊCH THUẬT.
2. TUYỆT ĐỐI KHÔNG TỰ BỊA ĐẶT TÍNH NĂNG (như Bluetooth, AI, Smartwatch, đo nhịp tim...) nếu không có trong dữ liệu. Đồng hồ ở đây là đồng hồ cơ/pin truyền thống.
3. Lệnh Tối Cao KHI BÁO GIÁ HOẶC GIỚI THIỆU SẢN PHẨM CỤ THỂ: Bạn TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ VIẾT thông tin sản phẩm (giá, kích thước...). Thay vào đó, BẠN BẮT BUỘC CHỈ CẦN XUẤT RA DUY NHẤT 1 CÚ PHÁP ĐÚNG NHƯ SAU:
[PRODUCT: Mã_SKU_Sản_Phẩm]

Hệ thống sẽ tự động bắt lấy cú pháp này và chèn Form mẫu thông số hoàn chỉnh vào. Bạn CHỈ ĐƯỢC PHÉP trả lời thêm ở NGAY BÊN DƯỚI cú pháp này (xuống dòng) NẾU khách có hỏi thêm câu hỏi phụ (như ship, bảo hành...). Tuyệt đối không tự sinh lời chào!
4. NẾU KHÁCH TÌM KIẾM THEO FORM DÁNG (ví dụ: Hublot, Nautilus, RM, Tonneau, Tank), hãy tra cứu trong DANH SÁCH SẢN PHẨM bên dưới để đề xuất mã SKU phù hợp bằng cú pháp [PRODUCT: Mã_SKU_Sản_Phẩm].
 5. PHẠM VI THƯƠNG HIỆU: Các thương hiệu shop đang bán là ${soldBrandsText}. CHỈ được tư vấn chi tiết, báo giá và giới thiệu sản phẩm ${CHATBOT_TARGET_BRAND}. Nếu khách hỏi thương hiệu hoặc mã không thuộc các thương hiệu shop đang bán, phải nói rõ shop không kinh doanh, nêu các thương hiệu đang có và hỏi khách có muốn tham khảo không. Không nhắc tới sheet, dữ liệu nội bộ hoặc danh mục. Riêng khi khách chỉ nói "Carnival", KHÔNG được tự hiểu là ${CHATBOT_TARGET_BRAND}; phải nói shop chỉ bán ${CHATBOT_TARGET_BRAND}, không phải Carnival riêng, rồi xin mã sản phẩm để kiểm tra.
 6. QUY TẮC MÃ SẢN PHẨM: Các đuôi số (như G1, G2, G3) thể hiện phiên bản niềng/vành bezel: Đuôi 1 (ví dụ G1) là niềng trơn, Đuôi 2 (ví dụ G2) là niềng đính đá, Đuôi 3 (ví dụ G3) là đính full đá. TUYỆT ĐỐI KHÔNG gọi chúng là "phiên bản màu sắc" khi giải thích cho khách. Màu sắc là phần đuôi phụ đằng sau (như -S1, -D1). NẾU khách hỏi mã chung chung (ví dụ 55851), HÃY HỎI RÕ khách muốn bản niềng nào (niềng trơn, niềng đá hay đính full đá).
 7. XÁC NHẬN CHÍNH HÃNG: Nếu thương hiệu hoặc SKU có trong dữ liệu Product của shop thì trả lời ngắn gọn đó là hàng chính hãng. Nếu không tìm thấy thì không được xác nhận. Với câu hỏi này TUYỆT ĐỐI không gửi form sản phẩm, thông số, ảnh bổ sung, giá, link mua hàng hoặc hỏi khách có cần báo giá không. Không nhắc các từ nội bộ như "danh mục", "hệ thống", "sheet" hoặc "SKU được phép".

DANH SÁCH SẢN PHẨM ${CHATBOT_TARGET_BRAND} ĐƯỢC PHÉP TƯ VẤN (Mã & mô tả):
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
            temperature: 0.4,
            thinkingConfig: { thinkingBudget: modelName.includes('pro') ? 128 : 0 }
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

    const excludedDraftBrand = getMentionedExcludedBrand(draftReply);
    if (excludedDraftBrand) {
      return getBrandRedirectReply({ brand: excludedDraftBrand });
    }

    // --- ÉP FORM MẪU BẰNG CODE ---
    const productMatch = draftReply.match(/\[PRODUCT:\s*([a-zA-Z0-9-]+)\]/i);
    if (productMatch) {
      const sku = productMatch[1].toUpperCase();
      const productInfo = getExactProductInfoFromCatalog(sku);

      if (!productInfo) {
        if (getProductInfoFromCatalog(sku)) {
          return {
            reply: `Dạ mã ${sku} có nhiều phiên bản khác nhau nên em chưa thể báo giá chính xác từ mã chung này ạ. Anh/chị gửi giúp em mã đầy đủ trên sản phẩm hoặc ảnh rõ mặt số để em kiểm tra đúng giá và link Shopee nhé.`,
            productImageUrl: null,
            sku: null
          };
        }
        return getBrandRedirectReply();
      }

      const shopeeLink = await getProductShopeeLink(sku, productInfo);
      const baseSku = sku.split('-')[0];
      const hasSentForm = history.some(
        msg => msg.is_from_page
          && (msg.message || '').includes(`Mã Sản Phẩm: ${baseSku}`)
      );
      const formText = buildProductFormText({
        sku,
        productInfo,
        shopeeLink,
        hasSentForm
      });

      // Bỏ mọi câu AI viết thêm quanh [PRODUCT] để không báo giá hoặc hỏi màu lần hai.
      const productImageUrl = productInfo['imageUrl'] || productInfo['Link ảnh sản phẩm'];
      return { reply: formText, productImageUrl: productImageUrl || null, sku };
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
const pendingAttachmentMessages = new Map();
const ATTACHMENT_PAIR_WINDOW_MS = 1800;
const VISUAL_REFERENCE_PAIR_WINDOW_MS = 3500;
const COMPLETE_ATTACHMENT_SETTLE_MS = 150;
const EXPLICIT_CLOSING_SETTLE_MS = 350;
const normalizeTimerStartMs = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
};

const formatChatbotDuration = milliseconds => {
  const safeMilliseconds = Math.max(0, Math.round(Number(milliseconds) || 0));
  return `${(safeMilliseconds / 1000).toFixed(2)}s (${safeMilliseconds}ms)`;
};

const logCompletedChatbotTimer = ({
  conversation,
  conversationId,
  timerStartedAtMs,
  processingStartedAtMs,
  responseReadyAtMs,
  platformSendDurationMs,
  platformSendCompletedAtMs,
  sentCount
}) => {
  if (!platformSendCompletedAtMs || !sentCount) return;
  const queueAndSettleMs = processingStartedAtMs - timerStartedAtMs;
  const botProcessingMs = responseReadyAtMs - processingStartedAtMs;
  const totalUntilSentMs = platformSendCompletedAtMs - timerStartedAtMs;
  const platformName = String(conversation.platform || conversation.type || 'platform')
    .toUpperCase();
  const customerName = String(
    conversation.sender_name || conversation.sender_id || conversationId
  ).trim();
  console.log([
    '',
    '============================================================',
    `⏱️ [CHATBOT TIMER] ${customerName} | ${conversationId}`,
    `   Gom tin + chờ hàng đợi : ${formatChatbotDuration(queueAndSettleMs)}`,
    `   Xử lý chatbot/AI       : ${formatChatbotDuration(botProcessingMs)}`,
    `   API gửi ${platformName.padEnd(12)}: ${formatChatbotDuration(platformSendDurationMs)}`,
    `   TỔNG ĐẾN KHI GỬI XONG : ${formatChatbotDuration(totalUntilSentMs)}`,
    `   Số tin đã gửi          : ${sentCount}`,
    '============================================================',
    ''
  ].join('\n'));
};

const stripAttachmentMarkers = (messageText) =>
  String(messageText || '')
    .replace(/\[(?:IMAGE|VIDEO|FILE|AUDIO):[^\]]*\]/gi, '')
    .trim();

const referencesIncomingAttachment = (messageText) => {
  const text = normalizeIntentText(stripAttachmentMarkers(messageText));
  return /\b(?:ma|mau|chiec|con|em|san pham|dong ho|cai|anh|hinh)\s+(?:nay|do|tren)\b/.test(text);
};

export const isProductContextFollowUp = (messageText) => {
  return referencesIncomingAttachment(messageText)
    || shouldSendFullProductForm(messageText)
    || Boolean(getFocusedProductQuestion(messageText))
    || isProductPhotoRequest(messageText)
    || isDiscountRequest(messageText);
};

const schedulePendingMessageBatch = (
  conversationId,
  messageText,
  imageUrls,
  settings,
  receivedAtMs
) => {
  const existing = pendingAttachmentMessages.get(conversationId);
  if (existing?.timer) clearTimeout(existing.timer);
  const hasCompleteImageQuestion = Boolean(String(messageText || '').trim())
    && (imageUrls?.length || 0) > 0;
  const settleDelayMs = isExplicitSupportClosingPhrase(messageText)
    ? EXPLICIT_CLOSING_SETTLE_MS
    : hasCompleteImageQuestion
      ? COMPLETE_ATTACHMENT_SETTLE_MS
      : referencesIncomingAttachment(messageText)
        ? VISUAL_REFERENCE_PAIR_WINDOW_MS
        : ATTACHMENT_PAIR_WINDOW_MS;

  const timer = setTimeout(() => {
    pendingAttachmentMessages.delete(conversationId);
    enqueueConversationProcessing(
      conversationId,
      messageText,
      imageUrls,
      settings,
      receivedAtMs
    );
  }, settleDelayMs);

  pendingAttachmentMessages.set(conversationId, {
    messageText,
    imageUrls,
    receivedAtMs,
    timer
  });
};

const enqueueConversationProcessing = (
  conversationId,
  messageText,
  imageUrls,
  settings,
  receivedAtMs
) => {
  if (!convQueues[conversationId]) {
    convQueues[conversationId] = Promise.resolve();
  }

  convQueues[conversationId] = convQueues[conversationId]
    .then(() => processConversation(
      conversationId,
      messageText,
      imageUrls,
      settings,
      receivedAtMs
    ))
    .catch(err => console.error("Lỗi trong hàng đợi xử lý Bot:", err.message));
};

export const handleIncomingMessage = async (
  conversationId,
  messageText,
  imageUrl = null,
  timing = {}
) => {
  const settings = getSettings();
  if (!settings.botEnabled) return; // Bot bị tắt toàn cục

  const cleanMessageText = stripAttachmentMarkers(messageText);
  const pending = pendingAttachmentMessages.get(conversationId);
  const currentReceivedAtMs = normalizeTimerStartMs(timing?.receivedAtMs);
  const receivedAtMs = pending?.receivedAtMs
    ? Math.min(pending.receivedAtMs, currentReceivedAtMs)
    : currentReceivedAtMs;

  if (imageUrl) {
    const pendingImageUrls = pending?.imageUrls || [];
    const combinedImageUrls = [...pendingImageUrls, imageUrl];
    const combinedText = [pending?.messageText, cleanMessageText].filter(Boolean).join('\n');

    if (combinedText) {
      console.log(`⚡ Đang gom tin nhắn với ${combinedImageUrls.length} ảnh cho hội thoại ${conversationId}.`);
      schedulePendingMessageBatch(
        conversationId,
        combinedText,
        combinedImageUrls,
        settings,
        receivedAtMs
      );
      return;
    }

    schedulePendingMessageBatch(conversationId, '', combinedImageUrls, settings, receivedAtMs);
    return;
  }

  if (pending?.imageUrls?.length) {
    const combinedText = [pending.messageText, cleanMessageText].filter(Boolean).join('\n');
    console.log(`⚡ Đang gom ${pending.imageUrls.length} ảnh với tin nhắn cho hội thoại ${conversationId}.`);
    schedulePendingMessageBatch(
      conversationId,
      combinedText,
      pending.imageUrls,
      settings,
      receivedAtMs
    );
    return;
  }

  if (referencesIncomingAttachment(cleanMessageText)) {
    const combinedText = [pending?.messageText, cleanMessageText].filter(Boolean).join('\n');
    schedulePendingMessageBatch(conversationId, combinedText, [], settings, receivedAtMs);
    return;
  }

  if (pending) {
    const combinedText = [pending.messageText, cleanMessageText].filter(Boolean).join('\n');
    schedulePendingMessageBatch(
      conversationId,
      combinedText,
      pending.imageUrls || [],
      settings,
      receivedAtMs
    );
    return;
  }

  enqueueConversationProcessing(conversationId, cleanMessageText, [], settings, receivedAtMs);
};

const processConversation = async (
  conversationId,
  messageText,
  imageUrls,
  settings,
  receivedAtMs
) => {
  const processingStartedAtMs = Date.now();
  const timerStartedAtMs = normalizeTimerStartMs(receivedAtMs);
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
    let authenticityProductConfirmed = null;
    let authenticityBrandConfirmed = null;
    let preserveCatalogScopeReply = false;
    const asksAuthenticity = isAuthenticityQuestion(messageText);
    let asksWarrantySupport = isWarrantySupportRequest(messageText);
    const isSupportFollowUp = isExplicitSupportClosingPhrase(messageText);

    if (!asksWarrantySupport && (imageUrls?.length || isSupportFollowUp)) {
      const recentMessages = await getMessagesByConversation(conversationId);
      const warrantyContext = getRecentWarrantyContext(recentMessages);
      if (warrantyContext.alreadyReplied) {
        if (isSupportFollowUp) {
          replyMessage =
            'Dạ vâng ạ, anh/chị để lại số điện thoại giúp em; nhân viên shop sẽ liên hệ hướng dẫn tiếp nhận nhé.';
          console.log(`ℹ️ [Bảo hành] Khách nhắn bổ sung sau hướng dẫn; chỉ xác nhận ngắn.`);
        } else {
          console.log(`ℹ️ [Bảo hành] Đã hướng dẫn khách gửi lại sản phẩm; bỏ qua phản hồi nhận diện ảnh lặp.`);
          return;
        }
      } else if (imageUrls?.length) {
        asksWarrantySupport = warrantyContext.hasComplaint;
      }
    }

    // 1.5: Kiểm tra khách có yêu cầu xem ảnh sản phẩm không
    const isAskingPhotos = isProductPhotoRequest(messageText);
    if (
      !replyMessage
      && isAiAllowed
      && (!imageUrls || imageUrls.length === 0)
      && isDiscountRequest(messageText)
    ) {
      const recentMessages = await getMessagesByConversation(conversationId);
      const mentionedSku = getCatalogSkuMention(messageText)?.sku;
      const discountSku = getExactProductInfoFromAllCatalog(mentionedSku)
        ? mentionedSku
        : getRecentExactCatalogSku(recentMessages);

      if (discountSku) {
        const productInfo = await getProductInfoBySku(discountSku);
        const shopeeLink = getShopeeLinkFromProductInfo(productInfo);
        if (shopeeLink) {
          replyMessage = buildShopeeDiscountReply({
            sku: discountSku,
            shopeeLink
          });
          console.log(`✅ Dẫn khách chốt ${discountSku} trên Shopee để nhận ưu đãi.`);
        }
      }
    }

    const instantReply = isAiAllowed && (!imageUrls || imageUrls.length === 0)
      ? getInstantTextReply(messageText)
      : null;

    if (instantReply) {
      replyMessage = instantReply;
    }

    if (!replyMessage && asksWarrantySupport) {
      replyMessage = getWarrantyReturnReply();
      console.log(`✅ [Bảo hành] Hướng dẫn khách gửi lại sản phẩm để shop kiểm tra trực tiếp.`);
    }

    const catalogSkuMention = getCatalogSkuMention(messageText);
    const catalogScopeReply = asksWarrantySupport && imageUrls?.length
      ? null
      : getCatalogScopeReply(messageText);
    if (!replyMessage && catalogScopeReply) {
      replyMessage = catalogScopeReply;
      preserveCatalogScopeReply = true;
    } else if (
      !replyMessage
      && catalogSkuMention
      && !(asksWarrantySupport && imageUrls?.length)
    ) {
      let resolvedSku = catalogSkuMention.sku;
      let productInfo = getExactProductInfoFromAllCatalog(resolvedSku)
        || getProductInfoFromAllCatalog(resolvedSku);

      if (catalogSkuMention.isTargetBrand && !getExactProductInfoFromAllCatalog(resolvedSku)) {
        const recentMessages = await getMessagesByConversation(conversationId);
        const referenceImageUrl = imageUrls?.[0]
          || getRecentCustomerImageUrl(recentMessages);
        const familyCandidates = getExactSkusInFamily(resolvedSku, {
          targetBrandOnly: true
        });

        if (referenceImageUrl && familyCandidates.length > 0) {
          const visualSku = await findVisualMatchForSkus(
            referenceImageUrl,
            familyCandidates
          );
          if (visualSku) {
            resolvedSku = visualSku;
            productInfo = getExactProductInfoFromAllCatalog(visualSku);
            console.log(
              `✅ Ảnh gần nhất xác nhận mã chung ${catalogSkuMention.sku} là ${visualSku}.`
            );
          }
        }
      }

      if (asksWarrantySupport && productInfo) {
        replyMessage = getWarrantyIntakeReply({
          brand: String(productInfo['Thương hiệu'] || '').trim(),
          sku: String(productInfo['Mã sản phẩm'] || resolvedSku).trim()
        });
      } else if (catalogSkuMention.isTargetBrand) {
        skuConfirmed = resolvedSku;
        console.log(`⚡ Nhận diện trực tiếp SKU ${skuConfirmed} thuộc ${CHATBOT_TARGET_BRAND}.`);
      } else if (asksAuthenticity) {
        authenticityProductConfirmed = productInfo;
      } else {
        replyMessage = getBrandRedirectReply({
          brand: String(productInfo?.['Thương hiệu'] || '').trim(),
          sku: resolvedSku
        });
      }
    }

    if (
      !replyMessage
      && !skuConfirmed
      && (!imageUrls || imageUrls.length === 0)
      && isProductContextFollowUp(messageText)
    ) {
      const recentMessages = await getMessagesByConversation(conversationId);
      const recentSku = getRecentExactCatalogSku(recentMessages);
      if (recentSku) {
        skuConfirmed = recentSku;
        console.log(`⚡ Dùng lại SKU gần nhất ${recentSku} cho câu hỏi nối tiếp.`);
      }
    }

    if (!replyMessage && asksWarrantySupport && (!imageUrls || imageUrls.length === 0)) {
      const mentionedBrand = getMentionedCatalogBrand(messageText);
      replyMessage = mentionedBrand
        ? getWarrantyIntakeReply({ brand: mentionedBrand })
        : getUnverifiedWarrantyReply();
    }
    
    if (!replyMessage && isAskingPhotos && (!imageUrls || imageUrls.length === 0)) {
      // Tìm SKU từ tin nhắn của khách trước (nếu khách nói rõ mã)
      let lastSku = null;
      const userSkuMatch = (messageText || '').match(/(?:mã|sku|mẫu)\s+([a-zA-Z0-9-]+)/i);
      if (userSkuMatch) {
        lastSku = userSkuMatch[1].toUpperCase();
      } else {
        // Tìm SKU chính xác gần nhất trong lịch sử hội thoại.
        const historyRows = await getMessagesByConversation(conversationId);
        lastSku = getRecentExactCatalogSku(historyRows);
      }

      if (lastSku && !getProductInfoFromCatalog(lastSku)) {
        const productInfo = getProductInfoFromAllCatalog(lastSku);
        replyMessage = getBrandRedirectReply({
          brand: String(productInfo?.['Thương hiệu'] || '').trim(),
          sku: productInfo ? lastSku : ''
        });
      } else if (lastSku) {
        console.log(`📸 Khách yêu cầu xem ảnh sản phẩm ${lastSku}. Đang lấy từ Google Drive...`);
        try {
          const { urls: driveUrls, source } = await getProductImagesFromDrive(lastSku, 5);
          
          if (driveUrls.length > 0) {
            // Gửi từng ảnh qua Messenger
            const responseReadyAtMs = Date.now();
            let sentCount = 0;
            let platformSendDurationMs = 0;
            let platformSendCompletedAtMs = null;
            for (const imgUrl of driveUrls) {
              try {
                const imageSendStartedAtMs = Date.now();
                const imageResult = await replyImageCRM(conversation.sender_id, imgUrl, conversation.type, conversationId);
                platformSendCompletedAtMs = Date.now();
                platformSendDurationMs += platformSendCompletedAtMs - imageSendStartedAtMs;
                sentCount++;

                const imgMsgId = imageResult.message_id;
                const imgTime = new Date().toISOString();
                const imageMessage = `📸 Ảnh ${lastSku} - ${sentCount}/${driveUrls.length}\n[IMAGE: ${imgUrl}]`;
                await saveMessage(imgMsgId, conversationId, imageMessage, true, imgTime);
                try {
                  broadcastCRM('new_message', {
                    conversationId,
                    message: { id: imgMsgId, conversation_id: conversationId, message: imageMessage, is_from_page: 1, created_time: imgTime }
                  });
                } catch (e) { /* ignore */ }
                
              } catch (imgErr) {
                console.error(`⚠️ Lỗi gửi ảnh Drive ${sentCount + 1}:`, imgErr.message);
              }
            }

            // Gửi tin nhắn text kèm theo
            replyMessage = `Dạ anh/chị ơi, em vừa gửi ${sentCount} ảnh thực tế mẫu ${lastSku.split('-')[0]} để anh/chị tham khảo nha! 📸😊 Anh/chị xem có ưng mẫu nào thì cho em biết để em tư vấn thêm ạ!`;

            // Gửi text và return luôn
            const textSendStartedAtMs = Date.now();
            const sendResult = await replyCRM(conversation.sender_id, replyMessage, conversation.type, conversationId);
            platformSendCompletedAtMs = Date.now();
            platformSendDurationMs += platformSendCompletedAtMs - textSendStartedAtMs;
            const botMsgId = sendResult?.message_id || sendResult?.id || ('msg_bot_' + Date.now() + Math.floor(Math.random() * 1000));
            await saveMessage(botMsgId, conversationId, replyMessage, true, new Date().toISOString());
            try {
              broadcastCRM('new_message', {
                conversationId,
                message: { id: botMsgId, conversation_id: conversationId, message: replyMessage, is_from_page: 1, created_time: new Date().toISOString() }
              });
            } catch (e) { /* ignore */ }
            logCompletedChatbotTimer({
              conversation,
              conversationId,
              timerStartedAtMs,
              processingStartedAtMs,
              responseReadyAtMs,
              platformSendDurationMs,
              platformSendCompletedAtMs,
              sentCount: sentCount + 1
            });
            return; // Xong, không cần xử lý thêm
          } else {
            // Không có ảnh trong Drive → thông báo cho khách
            replyMessage = `Dạ anh/chị ơi, hiện tại mẫu ${lastSku.split('-')[0]} chưa có ảnh thực tế sẵn ạ 😅 Em sẽ báo nhân viên kho chụp và gửi lại cho anh/chị sớm nhất nha! Anh/chị có muốn xem thêm mẫu nào khác không ạ?`;
            const responseReadyAtMs = Date.now();
            const textSendStartedAtMs = Date.now();
            const sendResult = await replyCRM(conversation.sender_id, replyMessage, conversation.type, conversationId);
            const platformSendCompletedAtMs = Date.now();
            const botMsgId = sendResult?.message_id || sendResult?.id || ('msg_bot_' + Date.now() + Math.floor(Math.random() * 1000));
            await saveMessage(botMsgId, conversationId, replyMessage, true, new Date().toISOString());
            try {
              broadcastCRM('new_message', {
                conversationId,
                message: { id: botMsgId, conversation_id: conversationId, message: replyMessage, is_from_page: 1, created_time: new Date().toISOString() }
              });
            } catch (e) { /* ignore */ }
            logCompletedChatbotTimer({
              conversation,
              conversationId,
              timerStartedAtMs,
              processingStartedAtMs,
              responseReadyAtMs,
              platformSendDurationMs: platformSendCompletedAtMs - textSendStartedAtMs,
              platformSendCompletedAtMs,
              sentCount: 1
            });
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
    if (!replyMessage && imageUrls && imageUrls.length > 0) {
      console.log(`🤖 Bot đang xử lý ${imageUrls.length} ảnh từ khách...`);
      let hashCandidateSku = null;
      let likelyHashCandidateSkus = [];
      let localEmbeddingCandidateSkus = [];
      let targetImageHash = null;
      let preloadedCustomerImageSources = [];

      void sendSenderActionCRM(
        conversation.sender_id,
        'typing_on',
        conversation.type,
        conversationId
      ).catch(() => {});

      // Pixel comparison may confirm an exact catalog image immediately.
      // Perceptual hash alone remains only a source of candidates for Vision.
      if (imageUrls.length === 1) {
        try {
          const preloadedImage = await getCustomerVisionImagePartsFromUrl(imageUrls[0]);
          preloadedCustomerImageSources = [preloadedImage];
          targetImageHash = await computeHashFromBuffer(preloadedImage.sourceBuffer);
        } catch (error) {
          console.warn('Không thể tải trước ảnh khách, Vision sẽ tự tải lại:', error.message);
        }

        if (targetImageHash) {
          const likelyHashCandidates = await findLikelySkuCandidates(targetImageHash, 12);
          likelyHashCandidateSkus = likelyHashCandidates
            .map(candidate => candidate.sku)
            .filter(sku => getProductInfoFromAllCatalog(sku));
          if (likelyHashCandidateSkus.length > 0) {
            console.log(
              `ℹ️ Hash gợi ý họ model cho Vision: ${likelyHashCandidateSkus.slice(0, 8).join(', ')}.`
            );
          }

          const hashResult = await findMatchingSku(
            targetImageHash,
            undefined,
            preloadedCustomerImageSources[0]?.sourceBuffer || imageUrls[0]
          );
          if (hashResult && getExactProductInfoFromAllCatalog(hashResult)) {
            hashCandidateSku = hashResult;
            const productInfo = getExactProductInfoFromAllCatalog(hashResult);
            if (asksWarrantySupport) {
              replyMessage = getWarrantyIntakeReply({
                brand: String(productInfo['Thương hiệu'] || '').trim(),
                sku: String(productInfo['Mã sản phẩm'] || hashResult).trim()
              });
            } else if (normalizeBrand(productInfo['Thương hiệu']) === normalizedTargetBrand) {
              skuConfirmed = hashResult;
            } else if (asksAuthenticity) {
              authenticityProductConfirmed = productInfo;
            } else {
              replyMessage = getBrandRedirectReply({
                brand: String(productInfo['Thương hiệu'] || '').trim(),
                sku: hashResult
              });
            }
            console.log(`✅ Đối chiếu pixel xác nhận chính xác SKU ${hashCandidateSku}.`);
          } else if (hashResult) {
            console.log(`ℹ️ Hash trả về SKU ${hashResult} nhưng mã không có trong Product.`);
          }
        }

        if (!replyMessage && !skuConfirmed && preloadedCustomerImageSources[0]?.sourceBuffer) {
          const localResult = await findLocalImageMatches(
            preloadedCustomerImageSources[0].sourceBuffer
          );
          localEmbeddingCandidateSkus = localResult.verificationCandidates || [];
          if (localResult.available) {
            console.log(
              `Local image search: ${localResult.elapsedMs} ms, family `
              + `${localResult.family || 'unknown'}, score ${Number(localResult.familyScore || 0).toFixed(3)}, `
              + `${localEmbeddingCandidateSkus.length} verification candidates.`
            );
          }

          if (localResult.exactSku && getExactProductInfoFromAllCatalog(localResult.exactSku)) {
            const productInfo = getExactProductInfoFromAllCatalog(localResult.exactSku);
            hashCandidateSku = localResult.exactSku;
            if (asksWarrantySupport) {
              replyMessage = getWarrantyIntakeReply({
                brand: String(productInfo['Thương hiệu'] || '').trim(),
                sku: String(productInfo['Mã sản phẩm'] || localResult.exactSku).trim()
              });
            } else if (normalizeBrand(productInfo['Thương hiệu']) === normalizedTargetBrand) {
              skuConfirmed = localResult.exactSku;
            } else if (asksAuthenticity) {
              authenticityProductConfirmed = productInfo;
            } else {
              replyMessage = getBrandRedirectReply({
                brand: String(productInfo['Thương hiệu'] || '').trim(),
                sku: localResult.exactSku
              });
            }
            console.log(`Local image model confirmed exact catalog SKU ${localResult.exactSku}.`);
          }
        }
      }

      // Lớp 3: Gemini Vision (OCR thương hiệu + đối chiếu ảnh bắt buộc)
      if (!replyMessage && !skuConfirmed && settings.enableLayer3 !== false && isAiAllowed) {
        console.log(`🤖 Chuyển qua Lớp 3: Gemini Vision`);
        const layer3Result = await runLayer3GeminiVision(imageUrls, messageText, {
          hashCandidateSku,
          likelyHashCandidateSkus,
          localEmbeddingCandidateSkus,
          preloadedCustomerImageSources
        });

        if (layer3Result.sku === "MULTIPLE_MODELS") {
          replyMessage = asksWarrantySupport
            ? 'Dạ em thấy ảnh có nhiều mẫu khác nhau nên chưa thể xác nhận đúng chiếc cần bảo hành ạ. Anh/chị gửi riêng ảnh cận logo và mặt đáy của chiếc đang gặp lỗi, kèm thẻ bảo hành hoặc bill/mã đơn để shop kiểm tra chính xác nhé.'
            : "Dạ shop đã nhận được nhiều mẫu đồng hồ khác nhau ạ. Để tránh báo nhầm, anh/chị cho shop biết mình muốn kiểm tra chiếc nào trước nhé!";
        } else if (layer3Result.sku) {
          // Chỉ Vision mới được xác nhận SKU; hash không bao giờ tự sinh form.
          const productInfo = getExactProductInfoFromAllCatalog(layer3Result.sku);
          if (productInfo && targetImageHash) {
            void rememberRecognizedCustomerImage(targetImageHash, layer3Result.sku)
              .catch(error => console.warn('Không thể ghi nhớ ảnh khách:', error.message));
          }
          if (productInfo && asksWarrantySupport) {
            replyMessage = getWarrantyIntakeReply({
              brand: String(productInfo['Thương hiệu'] || '').trim(),
              sku: String(productInfo['Mã sản phẩm'] || layer3Result.sku).trim()
            });
            console.log(`✅ [Bảo hành] Vision xác nhận ${layer3Result.sku}; chuyển sang thu thập chứng từ mua hàng.`);
          } else if (productInfo && normalizeBrand(productInfo['Thương hiệu']) === normalizedTargetBrand) {
            skuConfirmed = layer3Result.sku;
            console.log(`✅ [Lớp 3] Xác nhận SKU: ${layer3Result.sku} → Sinh Form trực tiếp`);
          } else if (productInfo && asksAuthenticity) {
            authenticityProductConfirmed = productInfo;
            console.log(`✅ [Lớp 3] Xác nhận SKU ${layer3Result.sku} cho câu hỏi chính hãng.`);
          } else if (productInfo) {
            replyMessage = getBrandRedirectReply({
              brand: String(productInfo['Thương hiệu'] || '').trim(),
              sku: layer3Result.sku
            });
            console.log(`✅ [Lớp 3] Nhận diện SKU ${layer3Result.sku} thuộc thương hiệu có trong Product.`);
          } else {
            replyMessage = getUnrecognizedImageReply();
          }
        } else {
          if (asksWarrantySupport && layer3Result.isCatalogBrand && layer3Result.brand) {
            replyMessage = getWarrantyIntakeReply({ brand: layer3Result.brand });
            console.log(`✅ [Bảo hành] Vision xác nhận thương hiệu ${layer3Result.brand}; chuyển sang thu thập chứng từ mua hàng.`);
          } else if (asksWarrantySupport && layer3Result.preserveScopeReply) {
            replyMessage = getWarrantyBrandMismatchReply(layer3Result.brand);
            preserveCatalogScopeReply = true;
          } else if (asksWarrantySupport) {
            replyMessage = getUnverifiedWarrantyReply();
          } else if (asksAuthenticity && layer3Result.isCatalogBrand && layer3Result.brand) {
            authenticityBrandConfirmed = layer3Result.brand;
            replyMessage = "";
          } else {
            replyMessage = layer3Result.message || getUnrecognizedImageReply();
            if (layer3Result.preserveScopeReply) {
              preserveCatalogScopeReply = true;
            }
          }
        }
      } else if (!replyMessage && !skuConfirmed) {
        replyMessage = asksWarrantySupport
          ? getUnverifiedWarrantyReply()
          : getUnrecognizedImageReply();
      }
    }

    if (asksAuthenticity && !preserveCatalogScopeReply) {
      const verifiedProduct = authenticityProductConfirmed
        || (skuConfirmed ? getProductInfoFromAllCatalog(skuConfirmed) : null);
      const mentionedBrand = authenticityBrandConfirmed || getMentionedCatalogBrand(messageText);
      const isSpecificUnverifiedProduct = (imageUrls?.length || 0) > 0
        || referencesIncomingAttachment(messageText)
        || Boolean(getMentionedExcludedBrand(messageText))
        || !isGeneralAuthenticityQuestion(messageText);

      if (verifiedProduct) {
        replyMessage = getVerifiedAuthenticityReply(
          String(verifiedProduct['Mã sản phẩm'] || skuConfirmed || '').toUpperCase(),
          verifiedProduct
        );
      } else if (mentionedBrand) {
        replyMessage = getVerifiedAuthenticityReply('', { 'Thương hiệu': mentionedBrand });
      } else {
        replyMessage = isSpecificUnverifiedProduct
          ? UNKNOWN_AUTHENTICITY_REPLY
          : GENERAL_AUTHENTICITY_REPLY;
      }
    }

    // 2.5: Nếu đã xác nhận SKU, trả lời theo đúng ý định trước khi cân nhắc Form.
    if (replyMessage) {
      console.log('⚡ Bot dùng phản hồi nhanh, bỏ qua Gemini.');
    } else if (skuConfirmed) {
      const sku = skuConfirmed.toUpperCase();
      const productInfo = getExactProductInfoFromCatalog(sku);
      if (!productInfo) {
        replyMessage = `Dạ mã ${sku} có nhiều phiên bản khác nhau nên em chưa thể báo giá chính xác từ mã chung này ạ. Anh/chị gửi giúp em mã đầy đủ trên sản phẩm hoặc ảnh rõ mặt số để em kiểm tra đúng giá và link Shopee nhé.`;
        console.log(`ℹ️ Từ chối sinh Form từ mã họ ${sku}; cần SKU biến thể chính xác.`);
      } else {
        const historyRows = await getMessagesByConversation(conversationId);
        const recentIntentText = getRecentProductIntentText(historyRows);
        const effectiveMessageText = recentIntentText
          && normalizeIntentText(recentIntentText) !== normalizeIntentText(messageText)
          ? `${recentIntentText}\n${messageText}`
          : messageText;
        const focusedReply = getFocusedProductReply(effectiveMessageText, sku, productInfo);
        const wantsFullProductForm = shouldSendFullProductForm(effectiveMessageText);

        if (focusedReply && !wantsFullProductForm) {
          replyMessage = focusedReply;
          console.log(`⚡ [Trả lời thuộc tính] Chỉ trả kích thước cho SKU ${sku}.`);
        } else if (wantsFullProductForm) {
          const hasSentForm = historyRows.some(
            msg => msg.is_from_page
              && (msg.message || '').includes(`Mã Sản Phẩm: ${sku}`)
          );
          const shopeeLink = await getProductShopeeLink(sku, productInfo);
          replyMessage = buildProductFormText({
            sku,
            productInfo,
            shopeeLink,
            hasSentForm
          });
          console.log(`✅ [Form trực tiếp] Đã sinh Form cho SKU ${sku}, bỏ qua AI text.`);
        } else {
          const brand = String(productInfo['Thương hiệu'] || CHATBOT_TARGET_BRAND).trim();
          replyMessage = `Dạ em nhận diện đây là mẫu ${brand} ${sku} ạ. Anh/chị muốn hỏi về giá, kích thước hay thông tin nào của mẫu này ạ?`;
          console.log(`⚡ [Nhận diện sản phẩm] Xác nhận SKU ${sku}, chưa gửi Form khi khách chưa yêu cầu.`);
        }

        // Chỉ truy xuất và gửi ảnh khi khách chủ động yêu cầu.
        if (isAskingPhotos && conversation.type === 'inbox') {
          try {
            console.log(`📸 Đang tìm ảnh thực tế cho ${sku} từ Drive (anh_tu_chup)...`);
            const driveResult = await getProductImagesFromDrive(sku, 3, 'anh_tu_chup');
            const productImageUrl = productInfo['imageUrl'] || productInfo['Link ảnh sản phẩm'];
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
              const imgMsgId = imageResult.message_id;
              const imgTime = new Date().toISOString();
              const imageMessage = `📸 Ảnh sản phẩm ${sku}\n[IMAGE: ${url}]`;
              await saveMessage(imgMsgId, conversationId, imageMessage, true, imgTime);
              try {
                broadcastCRM('new_message', {
                  conversationId,
                  message: { id: imgMsgId, conversation_id: conversationId, message: imageMessage, is_from_page: 1, created_time: imgTime }
                });
              } catch (e) { /* ignore broadcast error */ }
            }
          } catch (imgErr) {
            console.error(`⚠️ Lỗi khi gửi ảnh preview cho ${sku}:`, imgErr.message);
          }
        } else if (conversation.type === 'inbox') {
          console.log(`⚡ Bỏ qua tải ảnh cho ${sku}: khách chưa yêu cầu xem ảnh.`);
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

      const activeProductMessage = [...recentHistory].reverse().find(msg => {
        if (!msg.is_from_page || !/Mã Sản Phẩm:\s*[A-Za-z0-9-]+/i.test(msg.message || '')) return false;
        const createdAt = new Date(msg.created_time).getTime();
        return Number.isFinite(createdAt) && Date.now() - createdAt <= 30 * 60 * 1000;
      });
      const activeSkuMatch = activeProductMessage?.message?.match(/Mã Sản Phẩm:\s*([A-Za-z0-9-]+)/i);
      if (activeSkuMatch) {
        const activeSku = activeSkuMatch[1];
        const variants = getCatalogProducts().filter(
          p => p['Mã sản phẩm'] && p['Mã sản phẩm'].startsWith(activeSku + '-')
        );
        if (variants.length > 0) {
          const colorMap = variants.map(v => `- ${v['Mã sản phẩm']}: Màu ${v['Màu mặt số']}`).join('\n');
          systemImageContext += `\n[THÔNG TIN CHỌN MÀU: Khách đang quan tâm mã ${activeSku}. Các biến thể màu hiện có:\n${colorMap}\nChỉ khi khách CHỦ ĐỘNG YÊU CẦU XEM ẢNH, hãy dùng cú pháp [AVATAR: Mã_SKU] để gửi ảnh Avatar bản màu đó, ví dụ: [AVATAR: ${variants[0]['Mã sản phẩm']}]. Nếu khách chưa xin ảnh thì chỉ trả lời bằng chữ. TUYỆT ĐỐI KHÔNG dùng cú pháp PRODUCT trong trường hợp này!]\n\n`;
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
          if (isAskingPhotos && avtUrl && conversation.type === 'inbox') {
            hasAvatar = true;
            try {
              console.log(`📸 Đang gửi ảnh AVT màu sắc ${avtSku} cho khách...`);
              const imageResult = await replyImageCRM(conversation.sender_id, avtUrl, conversation.type, conversationId);
              const imgMsgId = imageResult.message_id;
              const imgTime = new Date().toISOString();
              const imageMessage = `📸 Ảnh AVT ${avtSku}\n[IMAGE: ${avtUrl}]`;
              await saveMessage(imgMsgId, conversationId, imageMessage, true, imgTime);
              try {
                broadcastCRM('new_message', { conversationId, message: { id: imgMsgId, conversation_id: conversationId, message: imageMessage, is_from_page: 1, created_time: imgTime } });
              } catch (e) { /* ignore */ }
            } catch(e) {
              console.error(`⚠️ Lỗi khi gửi ảnh AVT ${avtSku}:`, e.message);
            }
          }
        }
        
        replyMessage = replyMessage.replace(avatarRegex, '').trim();

        // Chỉ truy xuất và gửi ảnh khi khách chủ động yêu cầu.
        if (isAskingPhotos && geminiResult.sku && conversation.type === 'inbox' && !hasAvatar) {
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
              const imgMsgId = imageResult.message_id;
              const imgTime = new Date().toISOString();
              const imageMessage = `📸 Ảnh sản phẩm ${geminiResult.sku}\n[IMAGE: ${url}]`;
              await saveMessage(imgMsgId, conversationId, imageMessage, true, imgTime);
              try {
                broadcastCRM('new_message', {
                  conversationId,
                  message: { id: imgMsgId, conversation_id: conversationId, message: imageMessage, is_from_page: 1, created_time: imgTime }
                });
              } catch (e) { /* ignore */ }
            }
          } catch (imgErr) {
            console.error(`⚠️ Lỗi khi gửi ảnh preview:`, imgErr.message);
          }
        } else if (isAskingPhotos && geminiResult.productImageUrl && conversation.type === 'inbox' && !hasAvatar) {
          // Trường hợp chỉ hỏi lại biến thể (sku = null), gửi 1 ảnh catalog
          try {
            const imageResult = await replyImageCRM(conversation.sender_id, geminiResult.productImageUrl, conversation.type, conversationId);
            const imgMsgId = imageResult.message_id;
            const imgTime = new Date().toISOString();
            const imageMessage = `📸 Ảnh sản phẩm\n[IMAGE: ${geminiResult.productImageUrl}]`;
            await saveMessage(imgMsgId, conversationId, imageMessage, true, imgTime);
            try {
              broadcastCRM('new_message', { conversationId, message: { id: imgMsgId, conversation_id: conversationId, message: imageMessage, is_from_page: 1, created_time: imgTime } });
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
    const responseReadyAtMs = Date.now();
    let platformSendDurationMs = 0;
    let platformSendCompletedAtMs = null;
    
    for (const msg of messagesToSend) {
      // Gửi qua nền tảng
      const sendStartedAtMs = Date.now();
      const sendResult = await replyCRM(conversation.sender_id, msg, conversation.type, conversationId);
      platformSendCompletedAtMs = Date.now();
      platformSendDurationMs += platformSendCompletedAtMs - sendStartedAtMs;
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

    logCompletedChatbotTimer({
      conversation,
      conversationId,
      timerStartedAtMs,
      processingStartedAtMs,
      responseReadyAtMs,
      platformSendDurationMs,
      platformSendCompletedAtMs,
      sentCount: messagesToSend.length
    });

  } catch (error) {
    console.error("Lỗi xử lý luồng chatbot:", error.message);
  }
};
