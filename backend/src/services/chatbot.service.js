import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConversationById, getMessagesByConversation, updateBotPausedStatus, saveMessage } from '../utils/crm.db.js';
import { findMatchingSku, computeHashFromUrl } from './image-hash.service.js';
import { getProductInfoBySku } from './sheet.service.js';
import { replyCRM } from './crm.service.js';
import { broadcastCRM } from '../routes/api.routes.js';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KNOWLEDGE_PATH = path.join(__dirname, '../../config/chatbot-knowledge.md');
const SETTINGS_PATH = path.join(__dirname, '../../config/settings.json');
const IMAGE_REPLY_TEMPLATE_PATH = path.join(__dirname, '../../config/bot_image_reply_template.md');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const getSettings = () => {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch (e) {}
  return { botEnabled: false, botPauseHours: 2, botDelayMin: 3, botDelayMax: 8, enableLayer2: true, enableLayer3: true };
};

const getKnowledgeText = () => {
  try {
    if (fs.existsSync(KNOWLEDGE_PATH)) {
      return fs.readFileSync(KNOWLEDGE_PATH, 'utf8');
    }
  } catch (e) {}
  return "Bạn là trợ lý ảo tư vấn đồng hồ của cửa hàng I&W Carnival.";
};

const getImageReplyTemplate = () => {
  try {
    if (fs.existsSync(IMAGE_REPLY_TEMPLATE_PATH)) {
      return fs.readFileSync(IMAGE_REPLY_TEMPLATE_PATH, 'utf8');
    }
  } catch (e) {}
  return `Dạ mẫu anh/chị gửi là **{{PRODUCT_NAME}}** (Mã: {{SKU}}).\nGiá sản phẩm là: **{{PRICE}}** ạ! Anh/chị có muốn đặt hàng luôn không ạ? 😊`;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRandomDelay = (minSec, maxSec) => {
  const min = minSec * 1000;
  const max = maxSec * 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// --- CORE AI LOGIC ---

/**
 * Xử lý Lớp 3: Gọi Gemini Vision
 */
const runLayer3GeminiVision = async (imageUrl, messageText) => {
  try {
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();
    const customerMimeType = response.headers.get("content-type") || "image/jpeg";
    const customerImageBase64 = Buffer.from(buffer).toString("base64");
    
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });
    
    // Đọc catalog
    const catalogPath = path.join(__dirname, '../../data/catalog.json');
    let catalogData = '[]';
    if (fs.existsSync(catalogPath)) catalogData = fs.readFileSync(catalogPath, 'utf8');

    // Chặng 1: Semantic Search & Text OCR
    const prompt1 = `Bạn là chuyên gia tư vấn đồng hồ. Khách hàng gửi ảnh (có thể là ảnh chụp màn hình). Lời nhắn: "${messageText}".
Hãy đọc chữ trong ảnh và phân tích ngoại hình đồng hồ.
Dưới đây là danh sách sản phẩm (JSON):
${catalogData}

Nhiệm vụ: Tìm tối đa 5 mã SKU có khả năng khớp nhất với đồng hồ trong ảnh.
Trả về JSON định dạng:
{
  "candidates": ["SKU1", "SKU2"],
  "message": "Nếu không tìm thấy ứng viên nào, hãy viết câu trả lời thân thiện cho khách (ví dụ: xin thêm thông tin, hỏi mức giá)"
}`;

    const imagePart1 = { inlineData: { data: customerImageBase64, mimeType: customerMimeType } };
    const result1 = await model.generateContent([prompt1, imagePart1]);
    const responseText1 = result1.response.text();
    let stage1Result = { candidates: [], message: "" };
    try {
      stage1Result = JSON.parse(responseText1);
    } catch(e) {
      console.log('Lỗi parse JSON chặng 1:', responseText1);
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
    const imageParts2 = [imagePart1]; // Ảnh đầu tiên là ảnh khách gửi
    let index = 1;
    let candidateIndexMap = {}; // Map số thứ tự ảnh -> SKU
    
    for (const c of candidateImages) {
      try {
        const res = await fetch(c.imageUrl);
        const buf = await res.arrayBuffer();
        const mime = res.headers.get("content-type") || "image/jpeg";
        imageParts2.push({ inlineData: { data: Buffer.from(buf).toString("base64"), mimeType: mime } });
        candidateIndexMap[index] = c.sku;
        index++;
      } catch(e) {}
    }

    const prompt2 = `Ảnh đầu tiên (index 0) là ảnh khách gửi. Các ảnh tiếp theo (từ index 1 trở đi) là ảnh gốc của các mẫu: ${Object.values(candidateIndexMap).join(', ')}.
Nhiệm vụ: So sánh tỷ lệ, góc cạnh, chi tiết vị trí ốc, cọc số... giữa ảnh 0 và các ảnh gốc. Bức ảnh 0 chứa chiếc đồng hồ giống Y HỆT bức ảnh số mấy?
Trả về JSON định dạng:
{ "exact_match_index": số thứ tự bức ảnh gốc giống nhất (nếu không có nào giống y hệt thì trả về null) }`;

    const result2 = await model.generateContent([prompt2, ...imageParts2]);
    const responseText2 = result2.response.text();
    let stage2Result = { exact_match_index: null };
    try {
      stage2Result = JSON.parse(responseText2);
    } catch(e) {}

    const exactSku = stage2Result.exact_match_index ? candidateIndexMap[stage2Result.exact_match_index] : null;
    
    if (exactSku) {
      console.log(`🤖 Chặng 2 Lớp 3 chốt hạ SKU: ${exactSku}`);
      return { sku: exactSku, message: "" };
    } else {
      return { sku: null, message: "Dạ mẫu này đẹp quá ạ! 😍 Anh/chị cho shop biết thêm thích mức giá khoảng bao nhiêu để shop tư vấn mẫu tương tự nha!" };
    }

  } catch (error) {
    console.error("Lỗi Lớp 3 (Gemini Vision):", error.message);
    return { sku: null, message: "Dạ mẫu này đẹp quá ạ! 😍 Anh/chị cho shop biết thêm thích mức giá khoảng bao nhiêu để shop tư vấn nha!" };
  }
};

/**
 * Xử lý Bot trả lời bằng Text (Gemini)
 */
const runGeminiText = async (history, newMessage) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const systemPrompt = `Bạn là trợ lý ảo tư vấn đồng hồ của I&W Carnival.
Hãy trả lời lịch sự, thân thiện, dùng emoji hợp lý. Không bịa đặt thông tin.
Dưới đây là thông tin cửa hàng:
---
${getKnowledgeText()}
---
`;
    // Build history format for Gemini
    let chatHistory = [];
    let expectedRole = "user";

    // Prepare messages: combine sequential messages of the same role
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
      groupedMessages.shift(); // Remove the leading 'model' message if there is one
    }

    // Ensure the last message in history is "model" (because newMessage is "user")
    if (groupedMessages.length > 0 && groupedMessages[groupedMessages.length - 1].role !== "model") {
      // If the last message is "user", we can just append it to the newMessage and remove it from history
      const lastMsg = groupedMessages.pop();
      newMessage = lastMsg.text + "\n" + newMessage;
    }

    chatHistory = groupedMessages.map(g => ({
      role: g.role,
      parts: [{ text: g.text }]
    }));

    const chat = model.startChat({
      history: chatHistory,
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }
    });

    const result = await chat.sendMessage(newMessage);
    return result.response.text();
  } catch (error) {
    console.error("Lỗi Gemini Text:", error.message);
    return "Dạ shop đã nhận được tin nhắn. Sẽ có nhân viên hỗ trợ anh/chị ngay ạ!";
  }
};


// --- MAIN WORKFLOW ---

export const handleIncomingMessage = async (conversationId, messageText, imageUrl = null) => {
  const settings = getSettings();
  if (!settings.botEnabled) return; // Bot bị tắt toàn cục

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

    let replyMessage = "";

    // 2. Xử lý tin nhắn CÓ ẢNH
    if (imageUrl) {
      console.log(`🤖 Bot đang xử lý ảnh từ khách...`);
      
      let skuFound = null;
      let usedLayer = 0;

      // Tính hash của ảnh khách gửi
      const targetHash = await computeHashFromUrl(imageUrl);

      // Lớp 1 + 2: So sánh Hash trong DB (Cùng hàm findMatchingSku)
      if (targetHash) {
         skuFound = await findMatchingSku(targetHash, 5);
         if (skuFound) usedLayer = 1; // Khớp hash!
      }

      if (skuFound) {
        // Tra cứu giá từ Google Sheets
        const productInfo = await getProductInfoBySku(skuFound);
        if (productInfo) {
          const price = productInfo["Giá bán"] || "Đang cập nhật";
          const name = productInfo["Tên sản phẩm"] || skuFound;
          
          const template = getImageReplyTemplate();
          replyMessage = template
            .replace(/\{\{PRODUCT_NAME\}\}/g, name)
            .replace(/\{\{SKU\}\}/g, skuFound)
            .replace(/\{\{PRICE\}\}/g, price);
        } else {
          replyMessage = `Dạ mẫu anh/chị gửi có mã là **${skuFound}**. Anh/chị đợi chút để nhân viên shop kiểm tra tồn kho nha!`;
        }
      } else {
        // Lớp 3: Gemini Vision (2-Stage Verification)
        if (settings.enableLayer3 !== false) {
           console.log(`🤖 Chuyển qua Lớp 3: Gemini Vision`);
           const layer3Result = await runLayer3GeminiVision(imageUrl, messageText);
           
           if (layer3Result.sku) {
             // Lớp 3 đã tìm thấy SKU chính xác
             const productInfo = await getProductInfoBySku(layer3Result.sku);
             if (productInfo) {
               const price = productInfo["Giá bán"] || "Đang cập nhật";
               const name = productInfo["Tên sản phẩm"] || layer3Result.sku;
               const template = getImageReplyTemplate();
               replyMessage = template
                 .replace(/\{\{PRODUCT_NAME\}\}/g, name)
                 .replace(/\{\{SKU\}\}/g, layer3Result.sku)
                 .replace(/\{\{PRICE\}\}/g, price);
             } else {
               replyMessage = layer3Result.message;
             }
           } else {
             // Lớp 3 không chốt được mã
             replyMessage = layer3Result.message;
           }
        } else {
           replyMessage = "Dạ mẫu này bên shop cần nhân viên kiểm tra lại chút xíu, anh/chị đợi lát nha!";
        }
      }
    } 
    // 3. Xử lý tin nhắn CHỈ CÓ TEXT
    else {
      console.log(`🤖 Bot đang xử lý Text bằng Gemini...`);
      // Lấy lịch sử 10 tin nhắn gần nhất
      const historyRows = await getMessagesByConversation(conversationId);
      const recentHistory = historyRows.slice(-10); // Không gửi quá dài để đỡ token
      
      replyMessage = await runGeminiText(recentHistory, messageText || '');
    }

    // 4. Delay tự nhiên và Gửi Reply
    const delayTime = getRandomDelay(settings.botDelayMin || 3, settings.botDelayMax || 8);
    console.log(`⏳ Bot delay ${delayTime}ms trước khi gửi...`);
    await delay(delayTime);

    // Gửi qua nền tảng
    await replyCRM(conversation.sender_id, replyMessage, conversation.type, conversationId);
    console.log(`✅ Bot đã trả lời: ${replyMessage}`);

    // Cập nhật DB và UI cục bộ
    const botMessageId = 'msg_bot_' + Date.now();
    const createdTime = new Date().toISOString();
    await saveMessage(botMessageId, conversationId, replyMessage, true, createdTime);
    
    try {
      broadcastCRM('new_message', {
        conversationId,
        message: {
          id: botMessageId,
          conversation_id: conversationId,
          message: replyMessage,
          is_from_page: 1,
          created_time: createdTime
        }
      });
    } catch (e) {
      console.log('⚠️ Không thể broadcast tin nhắn Bot lên UI:', e.message);
    }

  } catch (error) {
    console.error("Lỗi xử lý luồng chatbot:", error.message);
  }
};
