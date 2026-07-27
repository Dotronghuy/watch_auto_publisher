import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import sharp from 'sharp';
import { getFolderIdByName, getImagesInFolder, getVideosInFolder, downloadFileFromDrive, getFoldersInFolder } from './drive.service.js';
import { getProductInfoBySku, updateProductPostInfo, getAllProductsPostInfo, clearExpiredPostInfo } from './sheet.service.js';
import { readFromSheet } from './sheets.service.js';
import { getPostedImageIds, addPostedImageId, addPostMetric } from '../utils/history.js';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assertGeneratedImagesAreNotInputReferences,
  generateBackgroundOnChatGPT,
  generateContentOnChatGPT
} from './playwright.service.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import { generateBackgroundOnSD } from './sd.service.js';
import { telegramEvents, sendBatchToTelegram } from './telegram.service.js';
import { publishToInstagram, publishCarouselToInstagram, publishFBReels, publishIGReels, publishThreadChain } from './meta.service.js';
import { addMusicToVideo, hasAudioStream } from './video.service.js';
import { addActivity } from '../utils/activity.js';
import { liveLog } from '../utils/liveLog.js';
import { shouldTryNextSkuAfterAiFailure } from './auto-publish-policy.js';
import { computeHashFromBuffer } from './image-hash.service.js';
import { checkAdbDevice, dumpUI, findNodeByKeyword, tap, inputText, runAdbCommand, sleep } from './adb.service.js';
import { saveImageHash } from '../utils/crm.db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, '../../config/settings.json');
const geminiTemplatePath = path.join(__dirname, '../../config/gemini-prompt-template.md');

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://127.0.0.1:5678/webhook-test/test-ai';
const ROOT_DRIVE_FOLDER_ID = process.env.ROOT_DRIVE_FOLDER_ID || '1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl';
const SAMPLE_IMAGES_DIR = path.join(__dirname, '../../config/sample_images');
const GPT_IMAGE_PROMPT_PATH = path.join(__dirname, '../../config/gpt_image_prompt.md');

const generateImageWithEngine = async (imagePath, promptsArray, abortSignal, sampleImagePath, isNewSession, extraWatchImages) => {
    let engine = 'chatgpt';
    try {
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            engine = settings.imageGenerationEngine || 'chatgpt';
        }
    } catch(e) {}
    
    if (engine === 'sd') {
        return await generateBackgroundOnSD(imagePath, promptsArray, abortSignal, sampleImagePath, isNewSession, extraWatchImages);
    } else {
        return await generateBackgroundOnChatGPT(imagePath, promptsArray, abortSignal, sampleImagePath, isNewSession, extraWatchImages);
    }
};

// ==========================================
// CONTENT RANDOMIZER (THÊM ĐỂ ĐA DẠNG NỘI DUNG)
// ==========================================
export const getToneInstructionText = (tone, perspective, cta) => {
  let instruction = `\n\n[YÊU CẦU BẮT BUỘC KHÁC NHAU MỖI BÀI]\n- Giọng văn: ${tone}\n- Góc nhìn: ${perspective}\n`;
  
  if (tone === 'Sang trọng, tinh tế') {
    instruction += `- QUY TẮC BẮT BUỘC CHO PHONG CÁCH SANG TRỌNG:
  + Hook (Câu mở đầu FB): Phải thật ngắn gọn, mạnh mẽ, in hoa, đập vào mắt (Ví dụ: "KHÔNG PHẢI MẪU TRẮNG NÀO CŨNG LÊN TAY SẠCH VÀ SANG."). KHÔNG viết hook quá dài dòng.
  + Từ vựng: Đa dạng từ ngữ, không lạm dụng "sạch và sang". Hãy linh hoạt dùng: "sáng cổ tay", "gọn mắt", "thanh lịch", "lên tay chỉn chu", "sang mà không gồng".
  + Emoji: Dùng các emoji sang trọng như ✨, 💎, ⌚, 🥂. CẤM dùng emoji kiểu cũ như 🕰️ hay các icon sến súa.
  + ĐỐI VỚI BÀI FACEBOOK: Bài rất ngắn (50-80 từ). Dùng Call to Action (CTA): "${cta}"
  + ĐỐI VỚI BÀI INSTAGRAM: BỎ QUA Call to Action (CTA). Caption IG phải thật ngắn, mang tính thẩm mỹ (Vd: "Mặt trắng, dây bạc — đủ sạch, đủ sang, đủ để cổ tay có điểm nhấn. ✨"). KHÔNG chèo kéo mua hàng.`;
  } else if (tone === 'Gần gũi, đời thường') {
    instruction += `- QUY TẮC BẮT BUỘC CHO PHONG CÁCH GẦN GŨI, ĐỜI THƯỜNG:
  + Hook (Câu mở đầu FB): BẮT BUỘC VIẾT HOA TOÀN BỘ, phải bắt tai và thu hút (Ví dụ: "MUỐN MỘT CHIẾC ĐỒNG HỒ DỄ ĐEO MỖI NGÀY, MẪU NÀY RẤT ĐÁNG XEM." hoặc "CÓ NHỮNG MẪU KHÔNG CẦN QUÁ NỔI BẬT, NHƯNG LÊN TAY LẠI RẤT GỌN VÀ SÁNG.").
  + Từ vựng: Tránh dùng từ quá kỹ thuật như "dây thép". Hãy dùng "dây kim loại bạc", "dây không gỉ", "dây sáng màu".
  + Emoji: Thêm các emoji vui vẻ, sinh động (như 🌟, 🔥, 💯) để bài viết không bị khô khan.
  + ĐỐI VỚI BÀI FACEBOOK: Bài viết rất ngắn (50-80 từ), súc tích. Dùng Call to Action (CTA): "${cta}"
  + ĐỐI VỚI BÀI INSTAGRAM: Phải thật ngắn gọn, ít giải thích (Ví dụ: "Mặt trắng, dây kim loại bạc — dễ đeo, dễ phối, lên tay sạch và trưởng thành."). CTA viết tự nhiên, không chèo kéo (Ví dụ: "Cần tư vấn mẫu hợp cổ tay, để lại bình luận.").`;
  } else if (tone === 'Kể chuyện (Storytelling)') {
    instruction += `- QUY TẮC BẮT BUỘC CHO PHONG CÁCH KỂ CHUYỆN (STORYTELLING):
  + Hook (Câu mở đầu FB): BẮT BUỘC VIẾT HOA TOÀN BỘ bằng một TÌNH HUỐNG đời thường (Ví dụ: "CÓ KHÁCH TỪNG NÓI VỚI TÔI: 'TÔI CẦN MỘT CHIẾC ĐỒNG HỒ ĐI LÀM HẰNG NGÀY, NHƯNG ĐỪNG QUÁ NỔI.'").
  + Mạch văn: Dẫn dắt mượt mà từ câu chuyện sang sản phẩm, ngắn gọn không lê thê. Thêm các câu tạo cảm xúc sâu sắc ở gần cuối (Ví dụ: "Nhìn gần có chi tiết. Nhìn xa có phong thái.", "Một lựa chọn an toàn — nhưng không nhạt.").
  + Từ vựng: KHÔNG dùng từ kỹ thuật cứng nhắc như "dây thép", hãy dùng "dây kim loại bạc", "dây thép không gỉ sáng màu".
  + Emoji: Dùng khoảng 3-5 emoji tinh tế rải rác. Cấm dùng emoji sến (như 🤍, 🪞). Dùng ✨, 🌟, ☕ sẽ rất hợp.
  + ĐỐI VỚI BÀI FACEBOOK: Ngắn gọn (50-80 từ). Dùng Call to Action (CTA): "${cta}"
  + ĐỐI VỚI BÀI INSTAGRAM: Rất ngắn gọn, đọng lại cảm xúc. BỎ QUA CTA chèo kéo mua hàng.`;
  } else if (tone === 'Trực diện, chốt sale') {
    instruction += `- QUY TẮC BẮT BUỘC CHO PHONG CÁCH TRỰC DIỆN, CHỐT SALE:
  + Hook (Câu mở đầu FB): Viết HOÀN TOÀN BẰNG CHỮ IN HOA, có lực, rõ đối tượng và lợi ích (Ví dụ: "MẪU NÀY RẤT HỢP VỚI NGƯỜI THÍCH SỰ CHỈN CHU — NHƯNG KHÔNG MUỐN BỊ NHẠT. ✦").
  + Tuyệt đối KHÔNG dùng ngôn ngữ nội bộ (VD: "dễ chốt sale"). Hãy dùng "dễ phối", "rất đáng chọn", "sự an toàn có gu", "rất hợp làm quà".
  + Từ vựng: Tránh từ "dây thép". Dùng "dây kim loại bạc" hoặc "dây thép không gỉ sáng màu".
  + Emoji: Dùng emoji thu hút mạnh mẽ sự chú ý như 💥, 🔥, 💎, ✨, 🎯. KHÔNG dùng 🕰️.
  + ĐỐI VỚI BÀI FACEBOOK: Ngắn gọn (50-80 từ), đánh trực diện vào hoàn cảnh sử dụng. Cuối bài xuống dòng ghi CTA: "${cta}"
  + ĐỐI VỚI BÀI INSTAGRAM: Thật ngắn, ngắt dòng rõ ràng trước CTA.`;
  } else if (tone === 'Kiến thức chuyên gia') {
    instruction += `- QUY TẮC BẮT BUỘC CHO PHONG CÁCH KIẾN THỨC CHUYÊN GIA:
  + Hook (Câu mở đầu FB): BẮT BUỘC VIẾT HOA TOÀN BỘ, nhận định chuyên môn tinh tế (Ví dụ: "MẶT TRẮNG KHÔNG PHẢI LÚC NÀO CŨNG DỄ ĐEO — NHƯNG KHI XỬ LÝ ĐÚNG, NÓ RẤT SÁNG TAY.").
  + Mạch văn: Phân tích chuyên sâu nhưng CỰC KỲ NGẮN GỌN (Ví dụ: "thiết kế day-date đặt gọn ở góc 3 giờ"). KHÔNG gọi là "siêu phẩm" một cách sáo rỗng.
  + Từ vựng: Tránh dùng "dây thép" thô cứng, hãy dùng "dây kim loại bạc".
  + Emoji: Dùng các emoji mang tính sắc nét, chuyên môn như ✦, ◇, ⌚, ⚙️, 🔍. CẤM dùng các emoji mềm mỏng như 🤍 hay 🕊️.
  + ĐỐI VỚI BÀI FACEBOOK: Ngắn gọn (50-80 từ). CTA bắt buộc phải được đặt sau một câu đệm chuyển ý mềm mại. (Ví dụ: "Nếu bạn đang tìm một mẫu cơ đầu tiên dễ đeo và lịch sự mỗi ngày — ${cta}").
  + ĐỐI VỚI BÀI INSTAGRAM: Chọn ĐÚNG 1 thông số đắt giá. BỎ QUA HOÀN TOÀN CTA (Call to Action) để giữ độ "sang" cho khung hình.`;
  } else if (tone === 'Hài hước, thả thính') {
    instruction += `- QUY TẮC BẮT BUỘC CHO PHONG CÁCH HÀI HƯỚC, THẢ THÍNH:
  + Hook (Câu mở đầu FB): BẮT BUỘC VIẾT HOA TOÀN BỘ câu đùa vui nhộn, thả thính (Ví dụ: "MẶT TRẮNG KHÔNG CÓ LỖI. CHỈ CÓ NGƯỜI CHƯA BIẾT ĐEO SAO CHO SANG. 😌").
  + Mạch văn: Giữ nhịp độ nhanh, vui vẻ. KHÔNG phân tích thông số hay tỏ ra chuyên gia dài dòng.
  + Từ vựng: KHÔNG dùng từ kỹ thuật như "dây thép". Đổi thành "dây kim loại sáng", "dây bạc".
  + Emoji: Dùng các emoji vui nhộn, thả thính thả ga như 😌, 😎, 🔥, ✨, 🥂, 😘. CẤM dùng 🕰️.
  + ĐỐI VỚI BÀI FACEBOOK: Ngắn gọn, có duyên (50-80 từ). Chốt bằng CTA nhẹ nhàng: "${cta}"
  + ĐỐI VỚI BÀI INSTAGRAM: Cực kỳ bắt trend, dễ viral, mang tính thả thính cao.`;
  } else if (tone === 'Kể chuyện hài, phối đồ') {
    instruction += `- QUY TẮC BẮT BUỘC CHO PHONG CÁCH KỂ CHUYỆN HÀI + PHỐI ĐỒ:
  + Hook (Câu mở đầu FB): BẮT BUỘC VIẾT HOA TOÀN BỘ, mở bằng tình huống hài hước đời thường (VD: "BẠN GÁI HỎI: 'SAO ANH CÓ MỖI MỘT CHIẾC ĐỒNG HỒ MÀ ĐEO HOÀI KHÔNG CHÁN?' — TÔI: 'VÌ NÓ HỢP VỚI MỌI THỨ ANH MẶC.' 😎", "ĐI ĂN CƯỚI BẠN, LOAY HOAY CẢ TỦ ĐỒ — CUỐI CÙNG CHỌN XONG OUTFIT NHỜ MỘT CHI TIẾT TRÊN CỔ TAY. 😌").
  + Mạch văn: Kể chuyện ngắn vui vẻ (đi làm, hẹn hò, event...) → nhắc đến đồng hồ tự nhiên → gợi ý phối đồ cụ thể.
  + PHẢI có gợi ý phối đồ cụ thể (VD: "Sơ mi trắng + quần tây + mẫu này = combo đi họp không ai chê", "Polo + kaki + cổ tay sáng = weekend có gu").
  + Giọng hài kiểu Gen Z/Millennial — nhẹ nhàng, duyên dáng, KHÔNG ép hài, KHÔNG "boomer".
  + Từ vựng: TRÁNH "dây thép", dùng "dây kim loại bạc", "dây da nâu". TRÁNH quảng cáo lộ liễu.
  + Emoji: 😎, 😌, 🔥, ✨, 👔, 👗. Khoảng 4-5 emoji rải đều.
  + ĐỐI VỚI BÀI FACEBOOK: 50-80 từ. Chuyện hài → phối đồ → CTA nhẹ: "${cta}"
  + ĐỐI VỚI BÀI INSTAGRAM: 1-2 câu duyên dáng kèm gợi ý phối đồ tinh tế (VD: "Sơ mi trắng, quần tây, cổ tay sáng một chút — đủ để cả phòng họp liếc nhìn. 😌✨"). BỎ QUA CTA chèo kéo.`;
  } else if (tone === 'Phối đồ') {
    instruction += `- QUY TẮC BẮT BUỘC CHO PHONG CÁCH PHỐI ĐỒ:
  + Hook (Câu mở đầu FB): BẮT BUỘC VIẾT HOA TOÀN BỘ, gợi ý outfit ngay từ đầu (VD: "SƠ MI TRẮNG + QUẦN ÂU + MỘT CHIẾC ĐỒNG HỒ MẶT TRẮNG DÂY BẠC — BỘ 3 KHÔNG BAO GIỜ SAI. ✨", "ÁO THUN ĐEN + QUẦN JOGGER + ĐỒNG HỒ DÂY DA — CASUAL NHƯNG KHÔNG HỀ TẦM THƯỜNG. 🔥").
  + Mạch văn: Gợi ý 1-2 cách phối đồ cụ thể → giải thích tại sao đồng hồ này hợp → CTA.
  + PHẢI đề cập outfit cụ thể: tên loại áo, quần, giày, phụ kiện. KHÔNG viết chung chung "phù hợp mọi phong cách".
  + PHẢI phân biệt theo giới tính sản phẩm: NAM dùng từ (sơ mi, polo, vest, quần tây, quần kaki, giày tây, boots, sneakers trắng). NỮ dùng từ (đầm dự tiệc, áo blouse, chân váy midi, blazer, giày cao gót, túi xách).
  + Giọng điệu: Tự tin, có gu, như stylist tư vấn cho bạn. KHÔNG quảng cáo lộ liễu.
  + Từ vựng: TRÁNH "dây thép", dùng "dây kim loại bạc", "dây da nâu". Dùng từ thời trang: "outfit", "mix & match", "phong cách tối giản".
  + Emoji: 👔, 👗, ✨, 🔥, 💎, 🎯. Khoảng 4-5 emoji.
  + ĐỐI VỚI BÀI FACEBOOK: 50-80 từ. Gợi ý phối → tại sao hợp → CTA: "${cta}"
  + ĐỐI VỚI BÀI INSTAGRAM: Cực ngắn, 1-2 câu combo phối đồ + đồng hồ (VD: "Blazer đen, áo trắng, cổ tay thêm một chút ánh kim — outfit đi event không cần nghĩ nhiều. ✨"). BỎ QUA CTA chèo kéo.`;
  } else {
    instruction += `- Lời kêu gọi (CTA): ${cta}`;
  }

  // QUY TẮC TRÌNH BÀY CHUNG (ĐẢM BẢO TÍNH THẨM MỸ, CHỐNG RỐI MẮT NHƯNG KHÔNG PHÁ VỠ VĂN PHONG)
  instruction += `\n\n[QUY TẮC TRÌNH BÀY THẨM MỸ]:
1. ĐỘ DÀI: BÀI FACEBOOK PHẢI CỰC KỲ NGẮN GỌN (CHỈ TỪ 50-80 TỪ), SÚC TÍCH, KHÔNG ĐƯỢC VIẾT NHIỀU CHỮ KHIẾN NGƯỜI ĐỌC BỊ LƯỜI.
2. CÂU HOOK BẮT BUỘC: Câu đầu tiên của bài Facebook BẮT BUỘC PHẢI VIẾT HOA TOÀN BỘ CHỮ CÁI để thu hút sự chú ý.
3. CẤU TRÚC ĐOẠN VĂN: Hãy viết tối đa 2-3 câu ngắn/đoạn. Giữa các đoạn phải có một dòng trống. Tuyệt đối không viết dồn ép.
4. ĐIỂM XUYẾT EMOJI: Hãy sử dụng linh hoạt khoảng 4-6 emoji rải đều các đoạn văn để bài viết sinh động, bắt mắt. Tận dụng các icon sang trọng và thu hút. KHÂNG được để bài viết thiếu icon.`;

  // ÉP BUỘC ĐỊNH DẠNG ĐẦU RA ĐỂ CHỐNG LỖI CỦA GPT:
  instruction += `\n\n[LỆNH TỐI CAO DÀNH CHO BẠN (CẤM LÀM SAI):
1. ĐÚNG GIỚI TÍNH SẢN PHẨM: Đọc kỹ "Đối tượng" (Nam hay Nữ) ở trên. Nếu là đồng hồ Nữ, tuyệt đối KHÔNG dùng các từ ngữ nam tính (như "vest, polo, mạnh mẽ, nam tính, đầm tay, quý ông"). Hãy dùng từ ngữ mềm mại, tôn vinh phái đẹp ("thanh lịch, tôn da, đầm váy, quý phái, nhẹ nhàng"). Nếu là đồng hồ Nam, dùng từ ngữ nam tính ("lịch lãm, sơ mi, vest, phong độ"). KHÔNG viết kiểu chung chung "hợp cho cả nam và nữ".
2. CHỈ VIẾT ĐÚNG NỘI DUNG ĐƯỢC YÊU CẦU THEO NỀN TẢNG. NẾU TÔI BẢO VIẾT CHO FACEBOOK, BẠN CHỈ TRẢ VỀ DUY NHẤT BÀI FACEBOOK VÀ TUYỆT ĐỐI KHÔNG VIẾT INSTAGRAM. KHÔNG BAO GIỜ VIẾT TỪ "FACEBOOK:" HAY "INSTAGRAM:" TRONG KẾT QUẢ.]`;

  return instruction;
};

const getRandomToneAndPerspective = () => {
  // Weighted random: 90% ưu tiên (5 tone x 18%) / 10% còn lại (3 tone)
  const weightedTones = [
    { tone: "Sang trọng, tinh tế", weight: 18 },
    { tone: "Trực diện, chốt sale", weight: 18 },
    { tone: "Hài hước, thả thính", weight: 18 },
    { tone: "Kể chuyện hài, phối đồ", weight: 18 },
    { tone: "Phối đồ", weight: 18 },
    { tone: "Gần gũi, đời thường", weight: 4 },
    { tone: "Kể chuyện (Storytelling)", weight: 3 },
    { tone: "Kiến thức chuyên gia", weight: 3 },
  ];

  const perspectives = [
    "Góc nhìn của một người đam mê đồng hồ",
    "Góc nhìn của chuyên gia tư vấn thời trang",
    "Góc nhìn của người mua tặng quà",
    "Góc nhìn của thương hiệu gửi đến khách hàng"
  ];
  
  let ctas = [
    "Inbox ngay để nhận ưu đãi",
    "Để lại bình luận để được tư vấn chi tiết",
    "Đừng bỏ lỡ siêu phẩm này",
    "Nhắn tin cho shop ngay nhé"
  ];
  try {
    const marketingPath = path.join(__dirname, '../../config/watch-marketing-content.md');
    if (fs.existsSync(marketingPath)) {
      const markContent = fs.readFileSync(marketingPath, 'utf8');
      const ctaMatch = markContent.match(/### 2\\.2 Call To Action \\(CTA\\)[\\s\\S]*?(?=###|$)/);
      if (ctaMatch) {
        const ctaLines = ctaMatch[0].split('\n').filter(line => line.trim().startsWith('- '));
        if (ctaLines.length > 0) {
          ctas = ctaLines.map(line => line.replace(/^- /, '').trim());
        }
      }
    }
  } catch(e) {}

  // Weighted random selection
  const totalWeight = weightedTones.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * totalWeight;
  let randomTone = weightedTones[0].tone;
  for (const t of weightedTones) {
    roll -= t.weight;
    if (roll <= 0) { randomTone = t.tone; break; }
  }

  const randomPersp = perspectives[Math.floor(Math.random() * perspectives.length)];
  const randomCta = ctas[Math.floor(Math.random() * ctas.length)];

  return getToneInstructionText(randomTone, randomPersp, randomCta);
};

export const parseColorsFromFilename = (filename, baseSku) => {
  if (!filename) return baseSku;
  
  let mainPart = filename.split('_')[0]; 
  mainPart = mainPart.replace(/\.[^/.]+$/, "");

  const parts = mainPart.split('-');
  
  if (parts.length > 5) {
     return `${baseSku} (FULL MÀU)`;
  }
  
  let skus = [];
  let colors = [];
  for (const part of parts) {
     if (part === baseSku) continue;
     if (/^T\d+$/i.test(part) || /^M\d+$/i.test(part) || /^V\d+$/i.test(part) || /^[A-Z]\d+$/.test(part)) {
        colors.push(part);
     } else {
        skus.push(part);
     }
  }
  
  let resultList = [];
  if (skus.length === 0 && colors.length > 0) {
      resultList = colors.map(c => `${baseSku}-${c}`);
  } else {
      resultList = [baseSku, ...skus];
  }
  
  if (resultList.length === 0) return baseSku;
  return resultList.join(' và ');
};

// Lấy ngẫu nhiên 1 ảnh mẫu từ thư mục sample_images (nếu có)
const getRandomSampleImage = () => {
  if (!fs.existsSync(SAMPLE_IMAGES_DIR)) return null;
  const validExt = ['.jpg', '.jpeg', '.png', '.webp'];
  const files = fs.readdirSync(SAMPLE_IMAGES_DIR)
    .filter(f => validExt.includes(path.extname(f).toLowerCase()));
  if (files.length === 0) return null;
  const randomFile = files[Math.floor(Math.random() * files.length)];
  return path.join(SAMPLE_IMAGES_DIR, randomFile);
};

const detectSkuGenderTag = (skuName = '') => {
  const skuUpper = String(skuName || '').toUpperCase();
  if (/G\d*$|G[^A-Z]|\d+G/.test(skuUpper)) return 'MALE';
  if (/L\d*$|L[^A-Z]|\d+L/.test(skuUpper)) return 'FEMALE';
  return 'NEUTRAL';
};

const getPromptGuidePromptOrThrow = (genderTag) => {
  const promptGuidePath = path.join(__dirname, '../../config/gpt_image_prompt.md');
  if (!fs.existsSync(promptGuidePath)) {
    throw new Error('Khong tim thay backend/config/gpt_image_prompt.md');
  }
  const mdContent = fs.readFileSync(promptGuidePath, 'utf8');
  const sectionRegex = new RegExp(`\\[${genderTag}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'i');
  const sectionMatch = mdContent.match(sectionRegex);
  const searchContent = sectionMatch ? sectionMatch[0] : mdContent;

  const sceneMatches = [...searchContent.matchAll(/\*\*English instruction for GPT:\*\*\s*>\s*([\s\S]*?)(?=\n---|\n###|\n## |$)/g)];
  const validScenes = sceneMatches.map(m => m[1].trim()).filter(s => !s.startsWith('PLACEHOLDER'));

  if (validScenes.length === 0) {
    throw new Error(`Khong doc duoc prompt ${genderTag} tu backend/config/gpt_image_prompt.md`);
  }
  return validScenes[Math.floor(Math.random() * validScenes.length)];
};

const getAllSampleImageFiles = () => {
  if (!fs.existsSync(SAMPLE_IMAGES_DIR)) return [];
  const validExt = ['.jpg', '.jpeg', '.png', '.webp'];
  return fs.readdirSync(SAMPLE_IMAGES_DIR)
    .filter(f => validExt.includes(path.extname(f).toLowerCase()))
    .map(f => path.join(SAMPLE_IMAGES_DIR, f));
};

const getPromptGuideSampleImages = (genderTag) => {
  if (!fs.existsSync(GPT_IMAGE_PROMPT_PATH)) return [];
  try {
    const mdContent = fs.readFileSync(GPT_IMAGE_PROMPT_PATH, 'utf8');
    const sectionRegex = new RegExp(`\\[${genderTag}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'i');
    const sectionMatch = mdContent.match(sectionRegex);
    if (!sectionMatch) return [];

    return [...sectionMatch[0].matchAll(/\*\*Sample Image:\*\*\s*(.+)/gi)]
      .map(m => m[1].trim())
      .filter(name => name && name !== 'N/A' && !name.startsWith('PLACEHOLDER'))
      .map(name => path.join(SAMPLE_IMAGES_DIR, name))
      .filter(samplePath => fs.existsSync(samplePath));
  } catch (e) {
    return [];
  }
};

const pickHybridSampleImage = (skuName = '') => {
  const genderTag = detectSkuGenderTag(skuName);
  let source = `prompt-guide:${genderTag}`;
  let candidates = getPromptGuideSampleImages(genderTag);

  if (candidates.length === 0 && genderTag !== 'NEUTRAL') {
    candidates = getPromptGuideSampleImages('NEUTRAL');
    source = 'prompt-guide:NEUTRAL-fallback';
  }

  if (candidates.length === 0) {
    candidates = getAllSampleImageFiles();
    source = 'sample-images:fallback';
  }

  if (candidates.length === 0) {
    return { imagePath: null, genderTag, sampleName: 'N/A', source: 'none' };
  }

  const imagePath = candidates[Math.floor(Math.random() * candidates.length)];
  return {
    imagePath,
    genderTag,
    sampleName: path.basename(imagePath),
    source
  };
};

const buildHybridSceneMetadata = (skuName, sampleInfo, index) => {
  return [
    '[Hybrid AI Scene]',
    `SKU: ${skuName || 'Auto'}`,
    `Image request: ${index + 1}`,
    `Gender bucket: ${sampleInfo.genderTag}`,
    `Sample image: ${sampleInfo.sampleName}`,
    `Sample source: ${sampleInfo.source}`,
    'Logic: replace the watch in sample image with the product watch'
  ].join('\n');
};

let globalStopController = new AbortController();
let isRoutineRunning = false;

export const getIsRunning = () => isRoutineRunning;

export const resetGlobalStop = () => {
  globalStopController = new AbortController();
  return globalStopController.signal;
};
export const triggerGlobalStop = () => {
  globalStopController.abort();
};
export const forceResetRunningState = () => {
  isRoutineRunning = false;
  globalStopController = new AbortController();
};

const getSmartFilteredSkus = async (skuFolders, allProductsInfo) => {
  // DAILY VLOG chỉ đăng thủ công, tuyệt đối không đưa vào bất kỳ nhánh tự động/fallback nào.
  skuFolders = skuFolders.filter(folder =>
    !folder.name.toUpperCase().replace(/[\s_-]+/g, '').includes('DAILYVLOG')
  );

  const sheetData = await readFromSheet();

  let prioritySkus = [];
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.prioritySkus) {
        prioritySkus = settings.prioritySkus.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      }
    }
  } catch(e) {}

  if (!sheetData || sheetData.length === 0) {
    liveLog('⚠️ [Smart Filter] Không đọc được Google Sheets, chuyển về chế độ ngẫu nhiên.', 'warning', 'System');
    return skuFolders.sort(() => 0.5 - Math.random());
  }

  // Lọc các SKU có trong Google Sheets và có ảnh (0_Anh_AVT = OK)
  const validSkusFromSheet = sheetData.filter(row =>
    row['Kết Quả'] !== 'KHONG CO ANH' &&
    row['0_Anh_AVT'] === 'OK'
  );

  const parseVietnameseDate = (dateString) => {
    if (!dateString) return 0;
    const parts = dateString.split(' ');
    if (parts.length !== 2) return 0;
    const [timePart, datePart] = parts;
    const [hour, min, sec] = timePart.split(':').map(Number);
    const [day, month, year] = datePart.split('/').map(Number);
    return new Date(year, month - 1, day, hour, min, sec).getTime();
  };

  // Phân nhóm SKU theo cột "Tập Trung" (cột H)
  // P = Ưu tiên, 1 = bán chạy (80%), 2 = bán ít (15%), 0 = chưa bán (5%)
  let groups = { 'P': [], '1': [], '2': [], '0': [] };

  for (const skuFolder of skuFolders) {
    // Cooldown check
    const productInfo = allProductsInfo.find(p => p.sku === skuFolder.name);
    if (productInfo && productInfo.postDate) {
      const lastPostTime = parseVietnameseDate(productInfo.postDate);
      const cycleMs = productInfo.cycleMinutes * 60 * 1000;
      if (Date.now() - lastPostTime < cycleMs) continue;
    }

    // Kiểm tra SKU có trong Sheet
    const sheetRow = validSkusFromSheet.find(row =>
      row['Mã SKU'] === skuFolder.name || row['Ma_SKU'] === skuFolder.name
    );

    if (sheetRow) {
      const priority = String(sheetRow['Tập Trung'] || '0').trim();
      const isPriority = priority === '1*' || prioritySkus.includes(skuFolder.name.toUpperCase());
      const group = isPriority ? 'P' : (['1', '2', '0'].includes(priority) ? priority : '0');
      groups[group].push({
        folder: skuFolder,
        hasMultipleMedia: (sheetRow['1_Anh_Hang'] === 'OK' || sheetRow['2_Anh_Tu_Chup'] === 'OK') ? 2 : 1
      });
    }
  }

  // Bộ đếm: đảm bảo không quá 2 bài liên tiếp KHÔNG thuộc nhóm 1
  if (!getSmartFilteredSkus._nonGroup1Count) getSmartFilteredSkus._nonGroup1Count = 0;

  // Weighted random: quay xổ số mỗi lần chọn SKU
  const roll = Math.random() * 100;
  let selectedGroup;

  // Bảo hiểm: nếu đã 2 lần liên tiếp không phải nhóm 1 → ép nhóm 1
  const forceGroup1 = getSmartFilteredSkus._nonGroup1Count >= 2 && groups['1'].length > 0;

  if (groups['P'].length > 0) {
    selectedGroup = 'P';
    getSmartFilteredSkus._nonGroup1Count = 0;
    liveLog('⭐ [Smart Filter] Có mã SKU Ưu Tiên mới về, đăng trước!', 'highlight', 'System');
  } else if (forceGroup1) {
    selectedGroup = '1';
    getSmartFilteredSkus._nonGroup1Count = 0;
    liveLog('🔒 [Smart Filter] Bảo hiểm: ép chọn nhóm 1 sau 2 lần liên tiếp nhóm khác', 'info', 'System');
  } else if (roll < 80 && groups['1'].length > 0) {
    selectedGroup = '1';
    getSmartFilteredSkus._nonGroup1Count = 0;
  } else if (roll < 95 && groups['2'].length > 0) {
    selectedGroup = '2';
    getSmartFilteredSkus._nonGroup1Count++;
  } else if (groups['0'].length > 0) {
    selectedGroup = '0';
    getSmartFilteredSkus._nonGroup1Count++;
  } else {
    // Fallback: chọn nhóm nào có SKU
    selectedGroup = groups['1'].length > 0 ? '1' :
      groups['2'].length > 0 ? '2' : '0';
    getSmartFilteredSkus._nonGroup1Count = selectedGroup === '1' ? 0 : getSmartFilteredSkus._nonGroup1Count + 1;
  }

  const groupLabels = { 'P': 'Ưu Tiên Mới Về', '1': 'Bán chạy', '2': 'Bán ít', '0': 'Chưa bán' };
  liveLog(`🎯 [Smart Filter] Quay xổ số → Nhóm ${selectedGroup} (${groupLabels[selectedGroup]}) | ` +
    `Tổng: P:${groups['P'].length} | 1:${groups['1'].length} | 2:${groups['2'].length} | 0:${groups['0'].length}`,
    'info', 'System');

  // Nhóm được chọn lên đầu (shuffle nội bộ), các nhóm khác xếp sau
  const sortByMedia = (a, b) => {
    if (a.hasMultipleMedia !== b.hasMultipleMedia) return b.hasMultipleMedia - a.hasMultipleMedia;
    return 0.5 - Math.random();
  };

  const result = [
    ...groups[selectedGroup].sort((a, b) => {
      if (selectedGroup === 'P') {
         // Sort alphabetically for Priority group to ensure T1 -> T2 -> T3 order
         return a.folder.name.localeCompare(b.folder.name, undefined, {numeric: true});
      }
      return sortByMedia(a, b);
    }),
    ...Object.entries(groups)
      .filter(([k]) => k !== selectedGroup)
      .sort(([a], [b]) => Number(b) - Number(a)) // Ưu tiên nhóm cao hơn trước
      .flatMap(([, v]) => v.sort(sortByMedia))
  ].map(item => item.folder);

  if (result.length === 0) {
    liveLog('⚠️ [Smart Filter] Không có SKU khả dụng, dùng random.', 'warning', 'System');
    return skuFolders.sort(() => 0.5 - Math.random());
  }

  return result;
};

// ============================================================
// DRY RUN: Chạy toàn bộ luồng nhưng KHÔNG đăng lên MXH
// Trả về: { sku, postMode, fbContent, igContent, imagePaths }
// ============================================================
export const dryRunRoutine = async () => {
  isRoutineRunning = true;

  const checkAbort = () => {
    if (globalStopController.signal.aborted) {
      const err = new Error('Luồng bị dừng theo yêu cầu của người dùng.');
      err.name = 'AbortError';
      throw err;
    }
  };

  liveLog('🧪 [DRY RUN] Bắt đầu chạy thử — Sẽ KHÔNG đăng lên MXH...', 'highlight', 'System');

  const cleanTempDirectory = () => {
    // KHÔNG xóa temp khi dry-run để frontend có thể đọc ảnh
    // Chỉ xóa các file phụ (rmbg, resize)
    const tempDir = path.join(__dirname, '../../temp_images');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        if (file !== '.gitkeep' && (file.includes('_rmbg') || file.includes('_1024'))) {
          try { fs.unlinkSync(path.join(tempDir, file)); } catch (e) { }
        }
      }
    }
  };

  let localFilePaths = [];

  try {
        const brandFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    const validBrands = brandFolders.filter(f => !f.name.toLowerCase().includes('template') && !f.name.toLowerCase().includes('review'));
    let skuFolders = [];
    for (const b of validBrands) {
      const bSkus = await getFoldersInFolder(b.id);
      skuFolders = skuFolders.concat(bSkus.filter(f => !f.name.toLowerCase().includes('review')));
    }
    if (skuFolders.length === 0) throw new Error('Không tìm thấy thư mục SKU nào trong Drive!');

    const postedIds = await getPostedImageIds();

    liveLog('🔍 [DRY RUN] Đang kiểm tra lịch sử đăng bài...', 'typing', 'Google Sheets');
    const allProductsInfo = await getAllProductsPostInfo();

    checkAbort();
    const nowMs = Date.now();

    const parseVietnameseDate = (dateString) => {
      if (!dateString) return 0;
      const parts = dateString.split(' ');
      if (parts.length !== 2) return 0;
      const [timePart, datePart] = parts;
      const [hour, min, sec] = timePart.split(':').map(Number);
      const [day, month, year] = datePart.split('/').map(Number);
      return new Date(year, month - 1, day, hour, min, sec).getTime();
    };

    const shuffledSkus = await getSmartFilteredSkus(skuFolders, allProductsInfo);
    const folderTypes = ['0_Anh_AVT', '1_Anh_Hang', '2_Anh_Tu_Chup', '3_Video_Doc'];
    let selectedImages = [];
    let selectedSku = null;
    let postMode = 'SINGLE';
    let fbContent = '';
    let igContent = '';
    let thContent = '';

    for (const skuFolder of shuffledSkus) {
      if (skuFolder.name.toUpperCase().includes('DAILY VLOG')) {
        const mediaFiles = await getVideosInFolder(skuFolder.id);
        const freshMedia = mediaFiles.filter(item => !postedIds.includes(item.id));
        if (freshMedia.length > 0) {
          selectedSku = skuFolder;
          selectedImages = [freshMedia[Math.floor(Math.random() * freshMedia.length)]];
          postMode = 'REELS';
          break;
        }
        continue;
      }

      const shuffledFolderTypes = [...folderTypes].sort(() => 0.5 - Math.random());
      for (const folderName of shuffledFolderTypes) {
        const targetFolderId = await getFolderIdByName(folderName, skuFolder.id);
        if (!targetFolderId) continue;

        let mediaFiles = [];
        if (folderName === '3_Video_Doc') {
          mediaFiles = await getVideosInFolder(targetFolderId);
        } else {
          mediaFiles = await getImagesInFolder(targetFolderId);
        }

        const freshMedia = mediaFiles.filter(item => !postedIds.includes(item.id));
        if (freshMedia.length > 0) {
          selectedSku = skuFolder;
          if (folderName === '0_Anh_AVT') {
            selectedImages = [freshMedia[Math.floor(Math.random() * freshMedia.length)]];
            postMode = 'AI';
          } else if (folderName === '3_Video_Doc') {
            selectedImages = [freshMedia[Math.floor(Math.random() * freshMedia.length)]];
            postMode = 'REELS';
          } else {
            const numToPick = Math.min(freshMedia.length, Math.floor(Math.random() * 5) + 4);
            // Ảnh số 1 (theo tên file) luôn ở đầu, còn lại random
            const sorted = [...freshMedia].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            const firstImage = sorted[0];
            const rest = sorted.slice(1).sort(() => 0.5 - Math.random()).slice(0, numToPick - 1);
            selectedImages = [firstImage, ...rest];
            postMode = 'ALBUM';
          }
          break;
        }
      }
      if (selectedImages.length > 0) break;
    }

    if (selectedImages.length === 0) throw new Error('Không tìm thấy ảnh/video mới để test!');

    liveLog(`✅ [DRY RUN] Đã chọn [${postMode}] — SKU: ${selectedSku.name} — ${selectedImages.length} file`, 'highlight', 'Google Drive');
    checkAbort();

    // 2. Tải ảnh về
    for (const img of selectedImages) {
      checkAbort();
      let pathStr = await downloadFileFromDrive(img.id, img.name);

      if (postMode === 'AI') {
        const bgRemovedPath = pathStr.replace(/\.[^/.]+$/, '_rmbg.png');
        const finalPaddedPath = pathStr.replace(/\.[^/.]+$/, '_1024.png');
        try {
          liveLog('🎨 [DRY RUN] Đang xóa nền bằng remove.bg...', 'typing', 'remove.bg');
          const rmBgFormData = new FormData();
          rmBgFormData.append('size', 'auto');
          rmBgFormData.append('image_file', fs.readFileSync(pathStr), {
            filename: path.basename(pathStr),
            contentType: pathStr.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
          });
          const rmbgResponse = await axios.post('https://api.remove.bg/v1.0/removebg', rmBgFormData, {
            headers: { ...rmBgFormData.getHeaders(), 'X-Api-Key': (process.env.REMOVE_BG_API_KEY || '').trim() },
            responseType: 'arraybuffer',
          });
          fs.writeFileSync(bgRemovedPath, rmbgResponse.data);
          await sharp(bgRemovedPath)
            .resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .toFormat('png')
            .toFile(finalPaddedPath);
          pathStr = finalPaddedPath;
        } catch (rmbgErr) {
          liveLog(`⚠️ [DRY RUN] remove.bg lỗi: ${rmbgErr.message}. Dùng ảnh gốc.`, 'error', 'remove.bg');
        }
      }
      localFilePaths.push(pathStr);
    }

    // 3. AI xử lý (ChatGPT + Gemini)
    checkAbort();
    fbContent = '';
    igContent = '';
    let currentImgPromptsArray = [];
    let currentSceneTextsArray = [];
    try {
      const productInfo = await getProductInfoBySku(selectedSku.name);
      const productInfoText = productInfo ? Object.entries(productInfo).map(([k, v]) => `${k}: ${v}`).join('\n') : '';

      // 3.1 ChatGPT sinh ảnh (chế độ AI)
      let aiGeneratedImagePaths = [];
      if (postMode === 'AI' && localFilePaths.length === 1) {
        try {
          let imgPromptsArray = [];
          const isExperimentalAI = false; // TẮT chế độ thử nghiệm để dùng luồng Prompt chuẩn
          let sampleInfo = pickHybridSampleImage(selectedSku?.name);
          let sampleImg = sampleInfo.imagePath;

          if (isExperimentalAI) {
            console.log('🧪 Đang chạy chế độ AI thử nghiệm (DRY RUN): 1 ảnh AVT + 1 ảnh mẫu, gộp prompt nhận diện tay.');
            const numAiImages = 1;
            const sampleInfos = Array.from({ length: numAiImages }, (_, idx) => idx === 0 ? sampleInfo : pickHybridSampleImage(selectedSku?.name));
            sampleInfo = sampleInfos[0];
            sampleImg = sampleInfo.imagePath;
            
            if (sampleImg) liveLog(`🖼️ [DRY RUN] Dùng ảnh mẫu ${sampleInfo.genderTag}: ${sampleInfo.sampleName}`, 'highlight', 'ChatGPT');
            
            const experimentalPrompt = `Use Image 1 as the main product. Replace the watch in Image 2 with the watch from Image 1.

Look closely at Image 2. If Image 2 DOES NOT have a human hand or wrist, apply these MANDATORY rules:
- Keep the exact shape, proportions, and perspective of the watch in Image 1. Do not distort it.
- Keep the logo/text on the watch face from Image 1 exactly as it is.
- Keep the watch strap complete. Do not cut off or shorten the strap.
- Remove all existing logos, text, or branding from Image 2, but do NOT remove the logo on the watch from Image 1.
- Keep the lighting, shadows, background, and natural composition exactly as in Image 2.
- The result must look like a real product photo, not distorted or fake.
- Prioritize preserving the product from Image 1 over creatively adjusting it to fit the background.
- If there is a conflict between the layout of Image 2 and the true shape of the watch in Image 1, keep the true shape of the watch in Image 1.

If Image 2 HAS a human hand or wrist, apply these MANDATORY rules:
- Keep the exact shape, proportions, and perspective of the watch in Image 1. Do not distort it.
- Keep the logo/text on the watch face from Image 1 exactly as it is.
- Keep the watch strap complete. Do not cut off or shorten the strap.
- Remove all existing logos, text, or branding from Image 2, but do NOT remove the logo on the watch from Image 1.
- Keep the lighting, shadows, background, and natural composition exactly as in Image 2.
- The result must look like a real product photo, not distorted or fake.
- Prioritize preserving the product from Image 1 over creatively adjusting it to fit the background.
- If there is a conflict between the layout of Image 2 and the true shape of the watch in Image 1, keep the true shape of the watch in Image 1.
- Keep the hand/wrist natural, anatomically correct, not distorted, with no extra or missing fingers.
- Keep the hand posture, wrist angle, and hand placement exactly as natural as in Image 2.
- The watch must sit at the correct position on the wrist/hand as in Image 2, wrapping naturally without floating or sinking into the skin.
- The contact area between the watch strap and the wrist must be realistic, correctly proportioned, and not distorted.
- Do not change the skin color, hand shape, or overall style of Image 2 beyond what is necessary to replace the watch.`;

            imgPromptsArray = sampleInfos.map(info => ({
              prompt: experimentalPrompt,
              sampleImage: info.imagePath,
              mode: 'direct_two_image_edit'
            }));
            currentSceneTextsArray = sampleInfos.map((info, index) => buildHybridSceneMetadata(selectedSku?.name, info, index));
            const extraWatchImages = [];
            
            aiGeneratedImagePaths = await generateImageWithEngine(localFilePaths[0], imgPromptsArray, globalStopController.signal, sampleImg, false, extraWatchImages);
          } else {

          const promptGuidePath = path.join(__dirname, '../../config/gpt_image_prompt.md');
          const numAiImages = Math.floor(Math.random() * 5) + 4;

          if (fs.existsSync(promptGuidePath)) {
            const mdContent = fs.readFileSync(promptGuidePath, 'utf8');
            const skuUpper = (selectedSku?.name || '').toUpperCase();
            let genderTag = 'NEUTRAL';
            if (/G\d*$|G[^A-Z]|\d+G/.test(skuUpper)) genderTag = 'MALE';
            else if (/L\d*$|L[^A-Z]|\d+L/.test(skuUpper)) genderTag = 'FEMALE';

            const sectionRegex = new RegExp(`\\[${genderTag}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'i');
            const sectionMatch = mdContent.match(sectionRegex);
            const searchContent = sectionMatch ? sectionMatch[0] : mdContent;
            const blockRegex = /###\s+(?:MALE|FEMALE|NEUTRAL)-\d+[\s\S]*?(?=\n###|\n## |$)/gi;
            const blocks = [...searchContent.matchAll(blockRegex)].map(m => m[0]);

            const validScenes = blocks.map(block => {
              const sampleImgMatch = block.match(/\*\*Sample Image:\*\*\s*(.+)/i);
              const promptMatch = block.match(/\*\*English instruction for GPT:\*\*\s*>\s*([\s\S]*?)(?=\n---|###|## |$)/i);
              if (promptMatch && !promptMatch[1].trim().startsWith('PLACEHOLDER')) {
                return {
                  text: promptMatch[1].trim(),
                  sampleImage: sampleImgMatch ? sampleImgMatch[1].trim() : null
                };
              }
              return null;
            }).filter(Boolean);

            if (validScenes.length > 0) {
              const shuffledScenes = [...validScenes].sort(() => 0.5 - Math.random()).slice(0, numAiImages);
              const genderNote = genderTag === 'MALE'
                ? 'The person in the scene must have MASCULINE hands and appearance (male wrist, male clothing).'
                : genderTag === 'FEMALE'
                  ? 'The person in the scene must have FEMININE hands and appearance (female wrist, manicured nails, female clothing).'
                  : '';

              currentSceneTextsArray = shuffledScenes.map(s => s.text);
              imgPromptsArray = shuffledScenes.map(s => {
                let sImgPath = null;
                if (s.sampleImage && s.sampleImage !== 'N/A') {
                  const checkPath = path.join(__dirname, '../../config/sample_images', s.sampleImage);
                  if (fs.existsSync(checkPath)) sImgPath = checkPath;
                }
                return {
                  prompt: `${s.text}\n\n${genderNote}\n\nCRITICAL RULES:\n- STRICT STRAP RULE: Identify the exact strap material from the attached image (Metal/Steel, Leather, or Rubber). You MUST draw the exact same strap material and design. DO NOT change a steel bracelet into leather/rubber, and vice versa.\n- Keep the watch dial, hands, case, bracelet, brand text, and colors EXACTLY as in the provided image.\n- Lighting must be consistent between the watch and the environment.\n- Output: photorealistic, 4K commercial product photography quality.`,
                  sampleImage: sImgPath,
                  mode: 'direct_two_image_edit'
                };
              });
            } else {
              currentSceneTextsArray = Array(numAiImages).fill('white marble with luxury props');
              imgPromptsArray = Array(numAiImages).fill('This is a luxury watch image with the background removed. Place this exact watch into a high-end lifestyle flat lay scene on white marble with luxury props. CRITICAL: IGNORE ALL PREVIOUS IMAGES. Use ONLY the attached image. Do NOT alter the watch design. Photorealistic, 4K quality.');
            }
          } else {
            currentSceneTextsArray = Array(numAiImages).fill('high-end lifestyle scene');
            imgPromptsArray = Array(numAiImages).fill('This is a luxury watch image with the background removed. Place this exact watch into a high-end lifestyle scene. CRITICAL: IGNORE ALL PREVIOUS IMAGES. Use ONLY the attached image. Do NOT alter the watch design. Photorealistic, 4K quality.');
          }

          
          if (sampleImg) liveLog(`🖼️ [DRY RUN] Dùng ảnh mẫu: ${path.basename(sampleImg)}`, 'info', 'ChatGPT');

          let extraWatchImages = [];
          try {
            liveLog('📸 [DRY RUN] Đang tìm ảnh tham khảo từ Ảnh_Hãng/Ảnh_Tự_Chụp...', 'typing', 'Google Drive');
            let extraFilesToDownload = [];
            const skuSubFolders = await getFoldersInFolder(selectedSku.id);
            liveLog(`DEBUG: Tìm thấy ${skuSubFolders.length} thư mục con trong SKU`, 'info', 'System');

            const anhHangFolder = skuSubFolders.find(f => f.name.includes('1_') || f.name.toLowerCase().includes('hãng') || f.name.toLowerCase().includes('hang'));
            const tuChupFolder = skuSubFolders.find(f => f.name.includes('2_') || f.name.toLowerCase().includes('tự') || f.name.toLowerCase().includes('tu'));
            liveLog(`DEBUG: Thư mục 1: ${anhHangFolder?.name || 'Không thấy'}, Thư mục 2: ${tuChupFolder?.name || 'Không thấy'}`, 'info', 'System');

            for (const f of [anhHangFolder, tuChupFolder]) {
              if (f) {
                const imgs = await getImagesInFolder(f.id);
                liveLog(`DEBUG: Thư mục ${f.name} có ${imgs.length} file ảnh hợp lệ (chứa chữ image/)`, 'info', 'System');
                extraFilesToDownload.push(...imgs);
              }
            }
            if (extraFilesToDownload.length > 0) {
              const maxExtra = Math.min(extraFilesToDownload.length, 4);
              extraFilesToDownload = extraFilesToDownload.sort(() => 0.5 - Math.random()).slice(0, maxExtra);
              for (const file of extraFilesToDownload) {
                checkAbort();
                const p = await downloadFileFromDrive(file.id, file.name);
                extraWatchImages.push(p);
              }
              liveLog(`✅ Đã tải ${extraWatchImages.length} ảnh tham khảo cho ChatGPT`, 'success', 'Google Drive');
            }
          } catch (e) {
            liveLog(`⚠️ [DRY RUN] Lỗi khi lấy ảnh tham khảo: ${e.message}`, 'warning', 'Google Drive');
          }

          aiGeneratedImagePaths = await generateImageWithEngine(localFilePaths[0], imgPromptsArray, globalStopController.signal, sampleImg, false, extraWatchImages);
          } // KẾT THÚC isExperimentalAI
          currentImgPromptsArray = imgPromptsArray;
          const lastWatchPath = path.join(__dirname, '../../temp_images/last_watch_image.png');
          if (fs.existsSync(localFilePaths[0])) { fs.copyFileSync(localFilePaths[0], lastWatchPath); fs.unlinkSync(localFilePaths[0]); }
          localFilePaths = [...aiGeneratedImagePaths];
        } catch (pwError) {
          if (globalStopController.signal.aborted) throw pwError;
          liveLog(`⚠️ [DRY RUN] Lỗi ChatGPT: ${pwError.message}`, 'error', 'ChatGPT');
        }
      }

      // 3.2 Gemini viết content
      try {
        const skuUp = (selectedSku?.name || '').toUpperCase();
        let genderLabel = 'Unisex';
        if (/\dG$|G\d|\dG\d/.test(skuUp)) genderLabel = 'Nam (Male)';
        else if (/\dL$|L\d|\dL\d/.test(skuUp)) genderLabel = 'Nữ (Female)';

        let fbPromptFinal = null;
        let reelsPromptFinal = null;

        const originalFilename = selectedImages[0]?.name || '';
        const selectedSkuInfo = parseColorsFromFilename(originalFilename, selectedSku.name);

        if (fs.existsSync(geminiTemplatePath)) {
          const templateRaw = fs.readFileSync(geminiTemplatePath, 'utf8');

          const fillTemplate = (tmpl) => tmpl
            .replace(/\{\{SKU\}\}/g, selectedSkuInfo)
            .replace(/\{\{PRODUCT_INFO\}\}/g, productInfoText || 'Không có thông tin')
            .replace(/\{\{GENDER\}\}/g, genderLabel);

          const fbIgMatch = templateRaw.match(/## FB_AND_IG_PROMPT_TEMPLATE\s*\n([\s\S]*?)(?=\n---\n## |\n## REELS_|$)/);
          if (fbIgMatch) fbPromptFinal = fillTemplate(fbIgMatch[1].trim());

          const reelsMatch = templateRaw.match(/## REELS_PROMPT_TEMPLATE\s*\n([\s\S]*?)(?=\n---\n## |$)/);
          if (reelsMatch) reelsPromptFinal = fillTemplate(reelsMatch[1].trim());
        }

        let targetImgPathForGemini = localFilePaths[0];
        let tempImgDownloaded = null;

        // --- VÒNG LẶP CHO NHIỀU ACCOUNTS TRONG DRY RUN ---
        const accountsPath = path.join(__dirname, '../../config/accounts.json');
        let activeAccounts = [];
        if (fs.existsSync(accountsPath)) {
          activeAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')).filter(a => a.isActive);
        }
        if (activeAccounts.length === 0) {
          activeAccounts = [{ name: 'Default', isActive: true }];
        }

        let firstFbContent = null;
        let firstIgContent = null;
        let firstThContent = null;

        for (const account of activeAccounts) {
          liveLog(`🚀 Sinh Content test cho tài khoản: ${account.name}...`, 'info', 'System');
          checkAbort();
          
          if (postMode === 'REELS') {
            let reelsPrompt = '';
            if (selectedSku.name.toUpperCase().includes('DAILY VLOG')) {
               reelsPrompt = `Đây là một video Daily Vlog (hoạt động hằng ngày: đóng hàng, giao hàng, vệ sinh đồng hồ...). Hãy đóng vai nhân viên của I&W Carnival, viết một đoạn caption thật ngắn gọn, tự nhiên, vui vẻ, thân thiện. Tuyệt đối KHÔNG quảng cáo hay chèo kéo mua hàng. Chỉ dùng hashtag #iwcarnivalvietnam #iwcarnival #dailyvlog`;
            } else {
               const reelsFallback = `Hãy đóng vai TikTok creator. Viết caption ngắn giật tít cho video Reels giới thiệu đồng hồ SKU ${selectedSku.name}. Chỉ trả về caption, dùng hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival và các hashtag trending.`;
               reelsPrompt = (reelsPromptFinal || reelsFallback) + getRandomToneAndPerspective();
            }

            const sampleFolders = ['1_Anh_Hang', '2_Anh_Tu_Chup'];
            for (const sFolder of sampleFolders) {
              const sFolderId = await getFolderIdByName(sFolder, selectedSku.id);
              if (sFolderId) {
                const sImages = await getImagesInFolder(sFolderId);
                if (sImages.length > 0) {
                  const sampleImg = sImages[0];
                  tempImgDownloaded = await downloadFileFromDrive(sampleImg.id, `temp_gemini_${sampleImg.name}`);
                  targetImgPathForGemini = tempImgDownloaded;
                  break;
                }
              }
            }

            const reelsContent = await generateContentOnChatGPT(reelsPrompt, 'reels', targetImgPathForGemini);
            if (!firstFbContent) {
              firstFbContent = reelsContent;
              firstIgContent = reelsContent;
              firstThContent = reelsContent;
            }
            liveLog(`🎉 [${account.name}] Test xong Reels!`, 'success', 'System');
          } else {
            const fallbackPrompt = `Hãy viết 2 bài theo đúng format:\n## FACEBOOK:\n[Bài FB 50-80 từ, câu mở đầu VIẾT IN HOA, có hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival]\n## INSTAGRAM:\n[Caption IG 15-35 từ, góc nhìn KHÁC bài FB, có hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival]\nSản phẩm: đồng hồ SKU ${selectedSku.name}. Không kèm giải thích.`;
            const combinedPrompt = (fbPromptFinal || fallbackPrompt) + getRandomToneAndPerspective();
            const fbSpecificPrompt = combinedPrompt + "\n\n[LƯU Ý: HÃY CHỈ VIẾT NỘI DUNG CHO FACEBOOK DỰA THEO HƯỚNG DẪN TRÊN. BỎ QUA CÁC PHẦN KHÁC. TRẢ VỀ TRỰC TIẾP NỘI DUNG MÀ KHÔNG CẦN TIÊU ĐỀ ## FACEBOOK]";
            const igSpecificPrompt = combinedPrompt + "\n\n[LƯU Ý: HÃY CHỈ VIẾT NỘI DUNG CHO INSTAGRAM DỰA THEO HƯỚNG DẪN TRÊN. BỎ QUA CÁC PHẦN KHÁC. TRẢ VỀ TRỰC TIẾP NỘI DUNG MÀ KHÔNG CẦN TIÊU ĐỀ ## INSTAGRAM]";

            const accFbContent = await generateContentOnChatGPT(fbSpecificPrompt, 'fb', targetImgPathForGemini);
            const accIgContent = await generateContentOnChatGPT(igSpecificPrompt, 'ig', targetImgPathForGemini);
            
            if (!firstFbContent) {
               firstFbContent = accFbContent;
               firstIgContent = accIgContent;
            }
            liveLog(`🎉 [${account.name}] Test xong! FB: ${accFbContent?.length || 0} kt, IG: ${accIgContent?.length || 0} kt`, 'success', 'System');
          }
        }

        fbContent = firstFbContent || "Failed to generate FB content";
        igContent = firstIgContent || "Failed to generate IG content";
        thContent = firstThContent || fbContent;

        if (tempImgDownloaded && fs.existsSync(tempImgDownloaded)) fs.unlinkSync(tempImgDownloaded);

      } catch (geminiError) {
        if (globalStopController.signal.aborted) throw geminiError;
        liveLog(`⚠️ [DRY RUN] Lỗi Gemini: ${geminiError.message}`, 'error', 'Gemini');
        fbContent = `[DRY RUN FALLBACK] Đồng hồ ${selectedSku.name} — Nội dung mẫu. #iwcarnivalvietnam`;
        igContent = fbContent;
        thContent = fbContent;
      }
    } catch (e) {
      if (globalStopController.signal.aborted) throw e;
      liveLog(`⚠️ [DRY RUN] Lỗi xử lý AI: ${e.message}`, 'error', 'System');
      fbContent = `[DRY RUN FALLBACK] Đồng hồ ${selectedSku.name}.`;
      igContent = fbContent;
      thContent = fbContent;
    }

    // 4. Trả về URL ảnh qua /images/filename (nhẹ hơn base64 nhiều lần)
    const imageUrls = [];
    for (let i = 0; i < localFilePaths.length; i++) {
      const imgPath = localFilePaths[i];
      if (fs.existsSync(imgPath)) {
        const filename = path.basename(imgPath);
        imageUrls.push({
          url: `http://localhost:3000/images/${filename}`,
          prompt: currentSceneTextsArray[i] || ''
        });
      }
    }

    liveLog(`🎉 [DRY RUN] Hoàn thành! ${imageUrls.length} ảnh, FB: ${fbContent.length} ký tự, IG: ${igContent.length} ký tự, TH: ${thContent.length} ký tự`, 'success', 'System', { fbContent, igContent, thContent });

    // KHÔNG xóa temp_images để frontend load được ảnh — sẽ xóa ở lần chạy tiếp theo
    // (cleanTempDirectory sẽ được gọi khi autoPublishRoutine hoặc dry-run tiếp theo chạy)

    return {
      success: true,
      sku: selectedSku.name,
      postMode,
      fbContent,
      igContent,
      thContent,
      images: imageUrls,
      imageCount: imageUrls.length,
    };

  } catch (error) {
    cleanTempDirectory();
    liveLog(`❌ [DRY RUN] Thất bại: ${error.message}`, 'error', 'System');
    throw error;
  } finally {
    isRoutineRunning = false;
  }
};

// ============================================================
// TRAIN IMAGE ONLY: Chỉ tạo ảnh GPT để training
// ============================================================
const waitForTelegramDecision = () => {
  return new Promise((resolve) => {
    const onContinue = () => { cleanup(); resolve(true); };
    const onStop = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      telegramEvents.off('continue_training', onContinue);
      telegramEvents.off('stop_training', onStop);
    };
    telegramEvents.on('continue_training', onContinue);
    telegramEvents.on('stop_training', onStop);
  });
};

telegramEvents.on('trigger_start_training', () => {
  if (!isRoutineRunning) {
    console.log('🔄 Nhận lệnh đánh thức hệ thống từ Telegram. Đang khởi động lại vòng lặp...');
    startTelegramTrainingLoop().catch(e => console.error(e));
  }
});

export const startTelegramTrainingLoop = async (targetSku = null) => {
  isRoutineRunning = true;
  let isTraining = true;

  const checkAbort = () => {
    if (globalStopController.signal.aborted) {
      const err = new Error('Luồng bị dừng theo yêu cầu của người dùng.');
      err.name = 'AbortError';
      throw err;
    }
  };

  while (isTraining && !globalStopController.signal.aborted) {
    try {
      console.log('--- ĐÃ CHẠY VÀO VÒNG LẶP TRAIN ẢNH ---');
      liveLog('Bắt đầu vòng lặp Train Ảnh mới...', 'highlight', 'System');
          const brandFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    const validBrands = brandFolders.filter(f => !f.name.toLowerCase().includes('template') && !f.name.toLowerCase().includes('review'));
    let skuFolders = [];
    for (const b of validBrands) {
      const bSkus = await getFoldersInFolder(b.id);
      skuFolders = skuFolders.concat(bSkus.filter(f => !f.name.toLowerCase().includes('review')));
    }
    if (skuFolders.length === 0) throw new Error('Không tìm thấy thư mục SKU nào trong Drive!');

      const postedIds = await getPostedImageIds();
      checkAbort();

      const allProductsInfo = await getAllProductsPostInfo();
      const shuffledSkus = await getSmartFilteredSkus(skuFolders, allProductsInfo);
      let selectedSku = null;
      let avtImageFile = null;

      const skusToSearch = targetSku 
        ? skuFolders.filter(f => f.name.toLowerCase().includes(targetSku.toLowerCase()))
        : shuffledSkus;

      if (targetSku && skusToSearch.length === 0) {
        throw new Error(`Không tìm thấy SKU nào chứa từ khóa "${targetSku}" trên Google Drive!`);
      }

      for (const skuFolder of skusToSearch) {
        const avtFolderId = await getFolderIdByName('0_Anh_AVT', skuFolder.id);
        if (!avtFolderId) continue;
        const mediaFiles = await getImagesInFolder(avtFolderId);
        
        let validMedia = mediaFiles.filter(item => !postedIds.includes(item.id));
        // Force use any media if targetSku is set but all media has been posted
        if (targetSku && validMedia.length === 0 && mediaFiles.length > 0) {
           validMedia = mediaFiles;
        }

        if (validMedia.length > 0) {
          selectedSku = skuFolder;
          avtImageFile = validMedia[Math.floor(Math.random() * validMedia.length)];
          break;
        }
      }

      if (!selectedSku || !avtImageFile) {
        liveLog('Không tìm thấy ảnh AVT mới, tạm ngưng Train.', 'warning', 'System');
        break;
      }

      liveLog('✅ [TRAIN ẢNH] Đã chọn SKU: ' + selectedSku.name, 'highlight', 'Google Drive');

      let pathStr = await downloadFileFromDrive(avtImageFile.id, avtImageFile.name);
      const bgRemovedPath = pathStr.replace(/\.[^/.]+$/, '_rmbg.png');
      const finalPaddedPath = pathStr.replace(/\.[^/.]+$/, '_1024.png');
      try {
        liveLog('🎨 [TRAIN ẢNH] Đang xóa nền...', 'typing', 'remove.bg');
        const rmBgFormData = new FormData();
        rmBgFormData.append('size', 'auto');
        rmBgFormData.append('image_file', fs.readFileSync(pathStr), {
          filename: path.basename(pathStr),
          contentType: pathStr.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
        });
        const rmbgResponse = await axios.post('https://api.remove.bg/v1.0/removebg', rmBgFormData, {
          headers: { ...rmBgFormData.getHeaders(), 'X-Api-Key': (process.env.REMOVE_BG_API_KEY || '').trim() },
          responseType: 'arraybuffer',
        });
        fs.writeFileSync(bgRemovedPath, rmbgResponse.data);
        await sharp(bgRemovedPath).resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).toFormat('png').toFile(finalPaddedPath);
        pathStr = finalPaddedPath;
      } catch (e) {
        liveLog('⚠️ Lỗi xóa nền: ' + e.message, 'error', 'remove.bg');
      }

      let aiGeneratedImagePaths;
      let imgPromptsArray = [];
      let currentSceneTextsArray = [];
      const isExperimentalAI = true;
      let sampleInfo = pickHybridSampleImage(selectedSku?.name);
      let sampleImg = sampleInfo.imagePath;

      if (isExperimentalAI) {
        console.log('🧪 Đang chạy chế độ AI thử nghiệm (TRAIN ẢNH): 1 ảnh AVT + 1 ảnh mẫu, gộp prompt nhận diện tay.');
        const numAiImages = 10;
        const sampleInfos = Array.from({ length: numAiImages }, (_, idx) => idx === 0 ? sampleInfo : pickHybridSampleImage(selectedSku?.name));
        sampleInfo = sampleInfos[0];
        sampleImg = sampleInfo.imagePath;
        
        if (sampleImg) liveLog(`🖼️ [TRAIN ẢNH] Dùng ảnh mẫu ${sampleInfo.genderTag}: ${sampleInfo.sampleName}`, 'highlight', 'ChatGPT');

        const experimentalPrompt = `Use Image 1 as the main product. Replace the watch in Image 2 with the watch from Image 1.

Look closely at Image 2. If Image 2 DOES NOT have a human hand or wrist, apply these MANDATORY rules:
- Keep the exact shape, proportions, and perspective of the watch in Image 1. Do not distort it.
- Keep the logo/text on the watch face from Image 1 exactly as it is.
- Keep the watch strap complete. Do not cut off or shorten the strap.
- Remove all existing logos, text, or branding from Image 2, but do NOT remove the logo on the watch from Image 1.
- Keep the lighting, shadows, background, and natural composition exactly as in Image 2.
- The result must look like a real product photo, not distorted or fake.
- Prioritize preserving the product from Image 1 over creatively adjusting it to fit the background.
- If there is a conflict between the layout of Image 2 and the true shape of the watch in Image 1, keep the true shape of the watch in Image 1.

If Image 2 HAS a human hand or wrist, apply these MANDATORY rules:
- Keep the exact shape, proportions, and perspective of the watch in Image 1. Do not distort it.
- Keep the logo/text on the watch face from Image 1 exactly as it is.
- Keep the watch strap complete. Do not cut off or shorten the strap.
- Remove all existing logos, text, or branding from Image 2, but do NOT remove the logo on the watch from Image 1.
- Keep the lighting, shadows, background, and natural composition exactly as in Image 2.
- The result must look like a real product photo, not distorted or fake.
- Prioritize preserving the product from Image 1 over creatively adjusting it to fit the background.
- If there is a conflict between the layout of Image 2 and the true shape of the watch in Image 1, keep the true shape of the watch in Image 1.
- Keep the hand/wrist natural, anatomically correct, not distorted, with no extra or missing fingers.
- Keep the hand posture, wrist angle, and hand placement exactly as natural as in Image 2.
- The watch must sit at the correct position on the wrist/hand as in Image 2, wrapping naturally without floating or sinking into the skin.
- The contact area between the watch strap and the wrist must be realistic, correctly proportioned, and not distorted.
- Do not change the skin color, hand shape, or overall style of Image 2 beyond what is necessary to replace the watch.`;

        imgPromptsArray = sampleInfos.map(info => ({
          prompt: experimentalPrompt,
          sampleImage: info.imagePath,
          mode: 'direct_two_image_edit'
        }));
        currentSceneTextsArray = sampleInfos.map((info, index) => buildHybridSceneMetadata(selectedSku?.name, info, index));
        const extraWatchImages = [];

        aiGeneratedImagePaths = await generateImageWithEngine(pathStr, imgPromptsArray, globalStopController.signal, sampleImg, false, extraWatchImages);
      } else {

      const promptGuidePath = path.join(__dirname, '../../config/gpt_image_prompt.md');
      const numAiImages = 10; // Gốc là 10 ảnh mỗi mẻ

      if (fs.existsSync(promptGuidePath)) {
        const mdContent = fs.readFileSync(promptGuidePath, 'utf8');
        const skuUpper = (selectedSku?.name || '').toUpperCase();
        let genderTag = 'NEUTRAL';
        if (/G\d*$|G[^A-Z]|\d+G/.test(skuUpper)) genderTag = 'MALE';
        else if (/L\d*$|L[^A-Z]|\d+L/.test(skuUpper)) genderTag = 'FEMALE';

        const sectionRegex = new RegExp(`\\[${genderTag}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'i');
        const sectionMatch = mdContent.match(sectionRegex);
        const searchContent = sectionMatch ? sectionMatch[0] : mdContent;
        const blockRegex = /###\s+(?:MALE|FEMALE|NEUTRAL)-\d+[\s\S]*?(?=\n###|\n## |$)/gi;
        const blocks = [...searchContent.matchAll(blockRegex)].map(m => m[0]);

        const validScenes = blocks.map(block => {
          const sampleImgMatch = block.match(/\*\*Sample Image:\*\*\s*(.+)/i);
          const promptMatch = block.match(/\*\*English instruction for GPT:\*\*\s*>\s*([\s\S]*?)(?=\n---|###|## |$)/i);
          if (promptMatch && !promptMatch[1].trim().startsWith('PLACEHOLDER')) {
            return {
              text: promptMatch[1].trim(),
              sampleImage: sampleImgMatch ? sampleImgMatch[1].trim() : null
            };
          }
          return null;
        }).filter(Boolean);

        if (validScenes.length > 0) {
          const shuffledScenes = [...validScenes].sort(() => 0.5 - Math.random()).slice(0, numAiImages);
          const genderNote = genderTag === 'MALE' ? 'The person must have MASCULINE hands.' : genderTag === 'FEMALE' ? 'The person must have FEMININE hands.' : '';
          currentSceneTextsArray = shuffledScenes.map(s => s.text);
          imgPromptsArray = shuffledScenes.map(s => {
            let sImgPath = null;
            if (s.sampleImage && s.sampleImage !== 'N/A') {
              const checkPath = path.join(__dirname, '../../config/sample_images', s.sampleImage);
              if (fs.existsSync(checkPath)) sImgPath = checkPath;
            }
            return {
              prompt: `This is a luxury watch with transparent background (background already removed). Composite this exact watch into the following lifestyle scene:\n\n${s.text}\n\n${genderNote}\n\nCRITICAL RULES:\n- IGNORE ALL PREVIOUS WATCH IMAGES in this chat history. YOU MUST ONLY USE THE IMAGE ATTACHED TO THIS CURRENT MESSAGE!\n- Do NOT redraw, redesign, or modify the watch in any way.\n- STRICT STRAP RULE: Identify the exact strap material from the attached image (Metal/Steel, Leather, or Rubber). You MUST draw the exact same strap material and design. DO NOT change a steel bracelet into leather/rubber, and vice versa.\n- Keep the watch dial, hands, case, bracelet, brand text, and colors EXACTLY as in the provided image.\n- Lighting must be consistent between the watch and the environment.\n- Output: photorealistic, 4K commercial product photography quality.`,
              sampleImage: sImgPath
            };
          });
        } else {
          currentSceneTextsArray = Array(numAiImages).fill('white marble with luxury props');
          imgPromptsArray = Array(numAiImages).fill('This is a luxury watch image with the background removed. Place this exact watch into a high-end lifestyle flat lay scene on white marble with luxury props. CRITICAL: IGNORE ALL PREVIOUS IMAGES. Use ONLY the attached image. Do NOT alter the watch design.');
        }
      }

      

      let extraWatchImages = [];
      try {
        liveLog('📸 [TRAIN ẢNH] Đang tìm ảnh tham khảo từ Ảnh_Hãng/Ảnh_Tự_Chụp...', 'typing', 'Google Drive');
        let extraFilesToDownload = [];
        const skuSubFolders = await getFoldersInFolder(selectedSku.id);
        liveLog(`DEBUG: Tìm thấy ${skuSubFolders.length} thư mục con trong SKU`, 'info', 'System');

        const anhHangFolder = skuSubFolders.find(f => f.name.includes('1_') || f.name.toLowerCase().includes('hãng') || f.name.toLowerCase().includes('hang'));
        const tuChupFolder = skuSubFolders.find(f => f.name.includes('2_') || f.name.toLowerCase().includes('tự') || f.name.toLowerCase().includes('tu'));

        liveLog(`DEBUG: Thư mục 1: ${anhHangFolder?.name || 'Không thấy'}, Thư mục 2: ${tuChupFolder?.name || 'Không thấy'}`, 'info', 'System');

        for (const f of [anhHangFolder, tuChupFolder]) {
          if (f) {
            const imgs = await getImagesInFolder(f.id);
            liveLog(`DEBUG: Thư mục ${f.name} có ${imgs.length} file ảnh hợp lệ (chứa chữ image/)`, 'info', 'System');
            extraFilesToDownload.push(...imgs);
          }
        }

        if (extraFilesToDownload.length > 0) {
          const maxExtra = Math.min(extraFilesToDownload.length, 4);
          extraFilesToDownload = extraFilesToDownload.sort(() => 0.5 - Math.random()).slice(0, maxExtra);
          for (const file of extraFilesToDownload) {
            const p = await downloadFileFromDrive(file.id, file.name);
            extraWatchImages.push(p);
          }
          liveLog(`✅ Đã tải ${extraWatchImages.length} ảnh tham khảo cho ChatGPT`, 'success', 'Google Drive');
        }
      } catch (e) {
        liveLog(`⚠️ [TRAIN ẢNH] Lỗi khi lấy ảnh tham khảo: ${e.message}`, 'warning', 'Google Drive');
      }

      aiGeneratedImagePaths = await generateImageWithEngine(pathStr, imgPromptsArray, globalStopController.signal, sampleImg, false, extraWatchImages);
      } // KẾT THÚC isExperimentalAI
      const lastWatchPath = path.join(__dirname, '../../temp_images/last_watch_image.png');
      if (fs.existsSync(pathStr)) { fs.copyFileSync(pathStr, lastWatchPath); fs.unlinkSync(pathStr); }

      const imageUrls = [];
      for (let i = 0; i < aiGeneratedImagePaths.length; i++) {
        if (fs.existsSync(aiGeneratedImagePaths[i])) {
          imageUrls.push({
            path: aiGeneratedImagePaths[i],
            prompt: currentSceneTextsArray[i] || ''
          });
        }
      }

      if (imageUrls.length === 0) {
        throw new Error('ChatGPT trả về 0 ảnh thành công. Ngừng tiến trình Train Ảnh để tránh treo hệ thống.');
      }

      liveLog('🎉 [TRAIN ẢNH] Đã vẽ xong! Đang đẩy ảnh qua Telegram...', 'success', 'System');

      await sendBatchToTelegram(imageUrls, lastWatchPath, sampleImg);

      liveLog('⏳ Đang chờ bác chấm điểm trên Telegram...', 'highlight', 'System');
      const shouldContinue = await waitForTelegramDecision();

      if (!shouldContinue) {
        isTraining = false;
        liveLog('⏸️ Hệ thống Train Ảnh đã ngưng theo yêu cầu (hoặc timeout).', 'warning', 'System');
      }

    } catch (error) {
      liveLog('❌ Lỗi vòng lặp Train: ' + error.message, 'error', 'System');
      isTraining = false;
    }
  }
  isRoutineRunning = false;
};

export const trainImageOnly = async (targetSku = null) => {
  if (isRoutineRunning) throw new Error('Hệ thống đang chạy một tiến trình khác!');

  // Khởi động luồng chạy ngầm
  startTelegramTrainingLoop(targetSku).catch(console.error);

  return {
    success: true,
    sku: targetSku || 'Auto',
    postMode: 'AI',
    fbContent: '',
    igContent: '',
    images: [],
    imageCount: 0,
    trainMode: 'image',
    message: '🚀 Đã chuyển quyền điều khiển sang Telegram! Vui lòng mở điện thoại để chấm điểm ảnh.'
  };
};

// ============================================================
// TRAIN CONTENT ONLY: Chỉ tạo content để training
// ============================================================
export const trainContentOnly = async () => {
  isRoutineRunning = true;

  const checkAbort = () => {
    if (globalStopController.signal.aborted) {
      const err = new Error('Luồng bị dừng theo yêu cầu của người dùng.');
      err.name = 'AbortError';
      throw err;
    }
  };

  liveLog('📝 [TRAIN CONTENT] Bắt đầu tạo nội dung để training...', 'highlight', 'System');

  try {
        const brandFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    const validBrands = brandFolders.filter(f => !f.name.toLowerCase().includes('template') && !f.name.toLowerCase().includes('review'));
    let skuFolders = [];
    for (const b of validBrands) {
      const bSkus = await getFoldersInFolder(b.id);
      skuFolders = skuFolders.concat(bSkus.filter(f => !f.name.toLowerCase().includes('review')));
    }
    if (skuFolders.length === 0) throw new Error('Không tìm thấy thư mục SKU nào trong Drive!');

    checkAbort();

    const allProductsInfo = await getAllProductsPostInfo();
    const shuffledSkus = await getSmartFilteredSkus(skuFolders, allProductsInfo);

    let selectedSku = null;
    let selectedImages = [];
    let postMode = 'SINGLE';

    // Tìm SKU đầu tiên có thư mục AVT và có ảnh mới
    for (const skuFolder of shuffledSkus) {
      const avtFolderId = await getFolderIdByName('0_Anh_AVT', skuFolder.id);
      if (!avtFolderId) continue;

      const mediaFiles = await getImagesInFolder(avtFolderId);
      if (mediaFiles.length > 0) {
        selectedSku = skuFolder;
        selectedImages = [mediaFiles[Math.floor(Math.random() * mediaFiles.length)]];
        postMode = 'AI';
        break;
      }
    }

    if (!selectedSku) throw new Error('Không tìm thấy SKU nào có ảnh AVT để test Content!');

    liveLog(`✅ [TRAIN CONTENT] Đã chọn SKU: ${selectedSku.name}`, 'highlight', 'Google Drive');

    const productInfo = await getProductInfoBySku(selectedSku.name);
    const productInfoText = productInfo ? Object.entries(productInfo).map(([k, v]) => `${k}: ${v}`).join('\n') : '';

    const skuUp = (selectedSku?.name || '').toUpperCase();
    let genderLabel = 'Unisex';
    if (/\dG$|G\d|\dG\d/.test(skuUp)) genderLabel = 'Nam (Male)';
    else if (/\dL$|L\d|\dL\d/.test(skuUp)) genderLabel = 'Nữ (Female)';

    let fbPromptFinal = null;
    if (fs.existsSync(geminiTemplatePath)) {
      const templateRaw = fs.readFileSync(geminiTemplatePath, 'utf8');
      // KHÔNG cần nối thêm marketing + persona vào prompt nữa
      // vì 2 file đó đã được upload làm Sources trong dự án Content_Watch_AI trên ChatGPT

      const fillTemplate = (tmpl) => tmpl
        .replace(/\{\{SKU\}\}/g, selectedSku.name)
        .replace(/\{\{PRODUCT_INFO\}\}/g, productInfoText || 'Không có thông tin')
        .replace(/\{\{GENDER\}\}/g, genderLabel);

      const fbIgMatch = templateRaw.match(/## FB_AND_IG_PROMPT_TEMPLATE\s*\n([\s\S]*?)(?=\n---\n## |\n## REELS_|$)/);
      if (fbIgMatch) fbPromptFinal = fillTemplate(fbIgMatch[1].trim());
    }

    // Tìm ảnh tham chiếu cho content
    let targetImgPathForContent = null;
    const sampleFolders = ['1_Anh_Hang', '2_Anh_Tu_Chup', '0_Anh_AVT'];
    for (const sFolder of sampleFolders) {
      const sFolderId = await getFolderIdByName(sFolder, selectedSku.id);
      if (sFolderId) {
        const sImages = await getImagesInFolder(sFolderId);
        if (sImages.length > 0) {
          const sampleImg = sImages[Math.floor(Math.random() * sImages.length)];
          targetImgPathForContent = await downloadFileFromDrive(sampleImg.id, `temp_train_${sampleImg.name}`);
          break;
        }
      }
    }

    checkAbort();

    // --- VÒNG LẶP CHO NHIỀU ACCOUNTS TRONG TRAIN CONTENT ---
    const accountsPath = path.join(__dirname, '../../config/accounts.json');
    let activeAccounts = [];
    if (fs.existsSync(accountsPath)) {
      activeAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')).filter(a => a.isActive);
    }
    if (activeAccounts.length === 0) {
      activeAccounts = [{ name: 'Default', isActive: true }];
    }

    const fallbackPrompt = `Hãy viết 2 bài theo đúng format:\n## FACEBOOK:\n[Bài FB 50-80 từ, câu mở đầu VIẾT IN HOA, có hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival]\n## INSTAGRAM:\n[Caption IG 15-35 từ, góc nhìn KHÁC bài FB, có hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival]\nSản phẩm: đồng hồ SKU ${selectedSku.name}. Không kèm giải thích.`;
    
    let firstFbContent = null;
    let firstIgContent = null;

    for (const account of activeAccounts) {
      liveLog(`🚀 Sinh Content test cho tài khoản: ${account.name}...`, 'info', 'System');
      checkAbort();
      const combinedPrompt = (fbPromptFinal || fallbackPrompt) + getRandomToneAndPerspective();
      const fbSpecificPrompt = combinedPrompt + "\n\n[LƯU Ý: HÃY CHỈ VIẾT NỘI DUNG CHO FACEBOOK DỰA THEO HƯỚNG DẪN TRÊN. BỎ QUA CÁC PHẦN KHÁC. TRẢ VỀ TRỰC TIẾP NỘI DUNG MÀ KHÔNG CẦN TIÊU ĐỀ ## FACEBOOK]";
      const igSpecificPrompt = combinedPrompt + "\n\n[LƯU Ý: HÃY CHỈ VIẾT NỘI DUNG CHO INSTAGRAM DỰA THEO HƯỚNG DẪN TRÊN. BỎ QUA CÁC PHẦN KHÁC. TRẢ VỀ TRỰC TIẾP NỘI DUNG MÀ KHÔNG CẦN TIÊU ĐỀ ## INSTAGRAM]";

      const accFbContent = await generateContentOnChatGPT(fbSpecificPrompt, 'fb', targetImgPathForContent);
      const accIgContent = await generateContentOnChatGPT(igSpecificPrompt, 'ig', targetImgPathForContent);
      
      if (!firstFbContent) {
         firstFbContent = accFbContent;
         firstIgContent = accIgContent;
      }
      liveLog(`🎉 [${account.name}] Test xong! FB: ${accFbContent?.length || 0} kt, IG: ${accIgContent?.length || 0} kt`, 'success', 'System', { fbContent: accFbContent, igContent: accIgContent });
    }

    // Dọn ảnh tham chiếu tạm
    if (targetImgPathForContent && fs.existsSync(targetImgPathForContent)) fs.unlinkSync(targetImgPathForContent);

    const fbContent = firstFbContent;
    const igContent = firstIgContent;

    if (!fbContent && !igContent) throw new Error('Không tạo được nội dung nào!');

    liveLog(`🎉 [TRAIN CONTENT] Hoàn thành! FB: ${fbContent?.length || 0} ký tự, IG: ${igContent?.length || 0} ký tự`, 'success', 'System', { fbContent, igContent });

    return {
      success: true,
      sku: selectedSku.name,
      postMode: 'CONTENT',
      fbContent: fbContent || '',
      igContent: igContent || '',
      thContent: thContent || '',
      images: [],
      imageCount: 0,
      trainMode: 'content',
    };

  } catch (error) {
    liveLog(`❌ [TRAIN CONTENT] Thất bại: ${error.message}`, 'error', 'System');
    throw error;
  } finally {
    isRoutineRunning = false;
  }
};

export const autoPublishRoutine = async (retryContext = null) => {
  const isRootAttempt = retryContext === null;
  const context = retryContext || { failedAiSkus: new Set() };

  if (isRootAttempt) {
    if (isRoutineRunning) {
      throw new Error('Hệ thống đang chạy một tiến trình khác!');
    }
    isRoutineRunning = true;
  }

  const checkAbort = () => {
    if (globalStopController.signal.aborted) {
      const err = new Error('Luồng bị dừng theo yêu cầu của người dùng.');
      err.name = 'AbortError';
      throw err;
    }
  };

  if (isRootAttempt) {
    liveLog('🤖 Bắt đầu tiến trình tự động đăng bài...', 'info', 'System');
  }

  const cleanTempDirectory = () => {
    const tempDir = path.join(__dirname, '../../temp_images');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      const now = Date.now();
      for (const file of files) {
        if (file !== '.gitkeep') {
          try {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);
            // Chỉ xóa file nếu đã tồn tại quá 1 tiếng (3600000 ms)
            if (now - stats.mtimeMs > 3600000) {
              fs.unlinkSync(filePath);
            }
          } catch (e) { }
        }
      }
    }
  };

  let localFilePaths = [];
  let finalPostId = "N/A";
  let finalSkuName = "Unknown";
  let publishSucceeded = false;
  const successfulPlatforms = new Set();

  try {
        const brandFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    const validBrands = brandFolders.filter(f => !f.name.toLowerCase().includes('template') && !f.name.toLowerCase().includes('review'));
    let skuFolders = [];
    for (const b of validBrands) {
      const bSkus = await getFoldersInFolder(b.id);
      skuFolders = skuFolders.concat(bSkus.filter(f => !f.name.toLowerCase().includes('review')));
    }
    if (skuFolders.length === 0) throw new Error('Không tìm thấy thư mục SKU nào trong Drive!');

    const postedIds = await getPostedImageIds();

    liveLog('Đang kiểm tra lịch sử đăng bài từ Google Sheets...', 'typing', 'Google Sheets');
    const allProductsInfo = await getAllProductsPostInfo();

    checkAbort(); // ---- Dừng an toàn sau khi lấy dữ liệu Sheet ----
    const nowMs = Date.now();

    const eligibleSkus = [];
    const expiredButUnpickedRows = [];

    // Hàm parse ngày giờ định dạng HH:mm:ss DD/MM/YYYY
    const parseVietnameseDate = (dateString) => {
      if (!dateString) return 0;
      const parts = dateString.split(' ');
      if (parts.length !== 2) return 0;
      const [timePart, datePart] = parts;
      const [hour, min, sec] = timePart.split(':').map(Number);
      const [day, month, year] = datePart.split('/').map(Number);
      return new Date(year, month - 1, day, hour, min, sec).getTime();
    };

    for (const skuFolder of skuFolders) {
      if (context.failedAiSkus.has(skuFolder.name)) {
        console.log(`⏭️ Bỏ qua SKU ${skuFolder.name}: AI đã lỗi trong lượt job hiện tại.`);
        continue;
      }

      const productInfo = allProductsInfo.find(p => p.sku === skuFolder.name);

      if (productInfo && productInfo.postDate) {
        const lastPostTime = parseVietnameseDate(productInfo.postDate);
        // Tính theo phút (minutes) thay vì ngày như yêu cầu test của user
        const cycleMs = productInfo.cycleMinutes * 60 * 1000;
        const timePassedMs = nowMs - lastPostTime;

        if (timePassedMs < cycleMs) {
          console.log(`⏳ Bỏ qua SKU ${skuFolder.name}: Mới đăng gần đây (cần chờ thêm khoảng ${Math.ceil((cycleMs - timePassedMs) / 60000)} phút).`);
          continue; // Chưa đủ thời gian chờ -> Bỏ qua
        } else {
          // Đã đủ thời gian chờ (hết cooldown), cho phép vào danh sách bốc thăm
          // Nếu lát nữa ko bốc trúng thì sẽ đem đi clear thời gian trên Sheets
          expiredButUnpickedRows.push(productInfo.rowIndex);
        }
      }
      eligibleSkus.push(skuFolder);
    }

    if (eligibleSkus.length === 0) {
      if (context.failedAiSkus.size > 0) {
        throw new Error(
          `Đã thử và loại ${context.failedAiSkus.size} SKU lỗi AI; không còn SKU hợp lệ kế tiếp trong lượt này.`,
        );
      }
      liveLog('⚠️ Tất cả các mã SKU đang trong thời gian chờ (Cooldown). Không có mã nào hợp lệ!', 'error', 'Google Sheets');
      throw new Error('Tất cả các mã SKU đang trong thời gian chờ (Cooldown). Không có mã nào hợp lệ để đăng!');
    }

    // Áp dụng Smart Filter để ưu tiên
    const shuffledSkus = await getSmartFilteredSkus(eligibleSkus, []);

    const folderTypes = ['0_Anh_AVT', '1_Anh_Hang', '2_Anh_Tu_Chup', '3_Video_Doc'];
    let selectedImages = [];
    let selectedSku = null;
    let postMode = 'SINGLE'; // SINGLE (AI), ALBUM, hoặc REELS

    // Tìm ảnh/video chưa đăng
    for (const skuFolder of shuffledSkus) {
      if (skuFolder.name.toUpperCase().includes('DAILY VLOG')) {
        const mediaFiles = await getVideosInFolder(skuFolder.id);
        const freshMedia = mediaFiles.filter(item => !postedIds.includes(item.id));
        if (freshMedia.length > 0) {
          selectedSku = skuFolder;
          selectedImages = [freshMedia[Math.floor(Math.random() * freshMedia.length)]];
          postMode = 'REELS';
          break;
        }
        continue;
      }

      // Trộn ngẫu nhiên thứ tự ưu tiên các loại thư mục
      const shuffledFolderTypes = [...folderTypes].sort(() => 0.5 - Math.random());

      for (const folderName of shuffledFolderTypes) {
        const targetFolderId = await getFolderIdByName(folderName, skuFolder.id);
        if (!targetFolderId) continue;

        let mediaFiles = [];
        if (folderName === '3_Video_Doc') {
          mediaFiles = await getVideosInFolder(targetFolderId);
        } else {
          mediaFiles = await getImagesInFolder(targetFolderId);
        }

        const freshMedia = mediaFiles.filter(item => !postedIds.includes(item.id));

        if (freshMedia.length > 0) {
          selectedSku = skuFolder;

          if (folderName === '0_Anh_AVT') {
            // Chế độ AI thay phông nền: Lấy 1 tấm
            selectedImages = [freshMedia[Math.floor(Math.random() * freshMedia.length)]];
            postMode = 'AI';
          } else if (folderName === '3_Video_Doc') {
            // Chế độ Reels: Lấy 1 Video
            selectedImages = [freshMedia[Math.floor(Math.random() * freshMedia.length)]];
            postMode = 'REELS';
          } else {
            // Chế độ Album: Bốc ngẫu nhiên 4-8 tấm
            const numToPick = Math.min(freshMedia.length, Math.floor(Math.random() * 5) + 4); // Random 4 đến 8
            // Ảnh số 1 (theo tên file) luôn ở đầu, còn lại random
            const sorted = [...freshMedia].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            const firstImage = sorted[0];
            const rest = sorted.slice(1).sort(() => 0.5 - Math.random()).slice(0, numToPick - 1);
            selectedImages = [firstImage, ...rest];
            postMode = 'ALBUM';
          }
          break;
        }
      }

      if (selectedImages.length > 0) break; // Thoát vòng lặp ngoài nếu đã tìm được
    }

    if (selectedImages.length === 0) {
      throw new Error('Đã hết sạch ảnh/video mới chưa đăng trong tất cả các mã SKU hợp lệ.');
    }

    // Loại bỏ SKU vừa được bốc ra khỏi danh sách cần clear trên Sheets
    const pickedProductInfo = allProductsInfo.find(p => p.sku === selectedSku.name);
    if (pickedProductInfo) {
      const indexToKeep = expiredButUnpickedRows.indexOf(pickedProductInfo.rowIndex);
      if (indexToKeep !== -1) expiredButUnpickedRows.splice(indexToKeep, 1);
    }

    // Dọn dẹp (Xóa) lịch sử những mã SKU ko được chọn
    if (expiredButUnpickedRows.length > 0) {
      console.log(`🧹 Đang xóa lịch sử đăng của ${expiredButUnpickedRows.length} SKU đã hết hạn chờ để ưu tiên cho lần sau...`);
      await clearExpiredPostInfo(expiredButUnpickedRows);
    }

    liveLog(`✅ Đã chọn [Chế độ ${postMode}] - SKU: ${selectedSku.name} - Số lượng: ${selectedImages.length} ảnh`, 'highlight', 'Google Drive');

    checkAbort(); // ---- Dừng an toàn sau khi chọn ảnh/video ----

    // 2. Tải tất cả ảnh về
    for (const img of selectedImages) {
      checkAbort();
      let pathStr = await downloadFileFromDrive(img.id, img.name);

      // Nếu là ảnh AI, xử lý trực tiếp bằng Node.js để kiểm soát độ chính xác tuyệt đối 1024x1024
      if (postMode === 'AI') {
        const bgRemovedPath = pathStr.replace(/\.[^/.]+$/, "_rmbg.png");
        const finalPaddedPath = pathStr.replace(/\.[^/.]+$/, "_1024.png");

        try {
          console.log(`Đang gọi API remove.bg để gọt phông nền cho ${img.name}...`);
          const rmBgFormData = new FormData();
          rmBgFormData.append('size', 'auto');
          rmBgFormData.append('image_file', fs.readFileSync(pathStr), {
            filename: path.basename(pathStr),
            contentType: pathStr.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
          });

          const rmbgResponse = await axios.post('https://api.remove.bg/v1.0/removebg', rmBgFormData, {
            headers: {
              ...rmBgFormData.getHeaders(),
              'X-Api-Key': (process.env.REMOVE_BG_API_KEY || '').trim()
            },
            responseType: 'arraybuffer',
          });

          fs.writeFileSync(bgRemovedPath, rmbgResponse.data);

          console.log(`Đang ép kích thước ảnh thành hình vuông 1024x1024 cho OpenAI...`);
          await sharp(bgRemovedPath)
            .resize(1024, 1024, {
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 0 }
            })
            .toFormat('png')
            .toFile(finalPaddedPath);

          // Cập nhật lại đường dẫn để gửi n8n ảnh 1024x1024 này
          pathStr = finalPaddedPath;
        } catch (rmbgErr) {
          let errorMsg = rmbgErr.message;
          if (rmbgErr.response && rmbgErr.response.data) {
            try {
              errorMsg = rmbgErr.response.data.toString('utf8');
            } catch (e) { }
          }
          console.log(`⚠️ Lỗi khi xóa nền bằng remove.bg: ${errorMsg}. Vẫn tiếp tục dùng ảnh gốc.`);
        }
      }

      localFilePaths.push(pathStr);
    }

    // 3. Sử dụng Playwright để xử lý AI (Tạo ảnh & Viết Content)
    checkAbort();
    let postContent = '';
    let fbContent = '';
    let igContent = '';
    let thContent = '';
    try {
      const productInfo = await getProductInfoBySku(selectedSku.name);
      const productInfoText = productInfo ? Object.entries(productInfo).map(([k, v]) => `${k}: ${v}`).join('\n') : '';

      // 3.1 NẾU LÀ CHẾ ĐỘ AI -> Gọi ChatGPT vẽ nền (Sinh 4-6 ảnh)
      let aiGeneratedImagePaths = [];
      if (postMode === 'AI' && localFilePaths.length === 1) {
        // Chặn với cả thư viện ảnh mẫu, không chỉ ảnh mẫu được bốc ở lượt hiện tại.
        // Nhờ vậy một thumbnail cũ trong cuộc trò chuyện cũng không thể lọt ra Fanpage.
        const aiInputReferencePaths = [...localFilePaths, ...getAllSampleImageFiles()];
        try {
          const isExperimentalAI = true; // BẬT CÔNG TẮC THỬ NGHIỆM

          if (isExperimentalAI) {
            console.log('🧪 Đang chạy chế độ AI thử nghiệm: 1 ảnh AVT + 1 ảnh mẫu, gộp prompt nhận diện tay.');
            const numAiImages = Math.floor(Math.random() * 3) + 4; // Sinh 4-6 ảnh
            let sampleInfo = pickHybridSampleImage(selectedSku?.name);
            const sampleInfos = Array.from({ length: numAiImages }, (_, idx) => idx === 0 ? sampleInfo : pickHybridSampleImage(selectedSku?.name));
            sampleInfo = sampleInfos[0];
            const sampleImg = sampleInfo.imagePath;
            if (sampleImg) liveLog(`🖼️ Dùng ảnh mẫu ${sampleInfo.genderTag}: ${sampleInfo.sampleName}`, 'highlight', 'ChatGPT');
            aiInputReferencePaths.push(...sampleInfos.map(info => info.imagePath).filter(Boolean));

            const imgPromptsArray = sampleInfos.map(info => ({
              prompt: getPromptGuidePromptOrThrow(info.genderTag),
              sampleImage: info.imagePath,
              genderTag: info.genderTag,
              mode: 'direct_two_image_edit'
            }));
            const extraWatchImages = []; // Không gửi thêm ảnh tham khảo
            
            aiGeneratedImagePaths = await generateImageWithEngine(localFilePaths[0], imgPromptsArray, globalStopController.signal, sampleImg, false, extraWatchImages);
          } else {

          // Đọc prompt từ file hướng dẫn .md (nếu có), fallback về prompt mặc định
          const promptGuidePath = path.join(__dirname, '../../config/gpt_image_prompt.md');
          let imgPrompt;

          const numAiImages = Math.floor(Math.random() * 5) + 4; // Sinh ngẫu nhiên từ 4-8 ảnh
          let imgPromptsArray = [];

          if (fs.existsSync(promptGuidePath)) {
            const mdContent = fs.readFileSync(promptGuidePath, 'utf8');

            // Detect giới tính từ mã SKU
            const skuUpper = (selectedSku?.name || '').toUpperCase();
            let genderTag = 'NEUTRAL';
            if (/G\d*$|G[^A-Z]|\d+G/.test(skuUpper)) genderTag = 'MALE';
            else if (/L\d*$|L[^A-Z]|\d+L/.test(skuUpper)) genderTag = 'FEMALE';
            console.log(`🔍 [Nhánh AI] SKU: ${selectedSku?.name} → Giới tính phát hiện: ${genderTag}`);

            // Lấy đúng phần [MALE], [FEMALE] hoặc [NEUTRAL] từ file .md
            // Tách toàn bộ các mục "English instruction for GPT" có label tương ứng
            const sectionRegex = new RegExp(
              `\\[${genderTag}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'i'
            );
            const sectionMatch = mdContent.match(sectionRegex);
            const searchContent = sectionMatch ? sectionMatch[0] : mdContent;

            // Parse tất cả các scene instructions trong section đó
            const sceneMatches = [...searchContent.matchAll(
              /\*\*English instruction for GPT:\*\*\s*>\s*([\s\S]*?)(?=\n---|\n###|\n## |$)/g
            )];

            // Lọc bỏ các PLACEHOLDER chưa có nội dung thật
            const validScenes = sceneMatches
              .map(m => m[1].trim())
              .filter(s => !s.startsWith('PLACEHOLDER'));

            if (validScenes.length > 0) {
              // Xáo trộn mảng validScenes để lấy ngẫu nhiên các cảnh khác nhau
              const shuffledScenes = [...validScenes].sort(() => 0.5 - Math.random());
              // Nếu số lượng yêu cầu lớn hơn số cảnh có sẵn, có thể bị trùng, nhưng thường md file có 19 cảnh nên thoải mái
              const selectedScenes = shuffledScenes.slice(0, numAiImages);

              const genderNote = genderTag === 'MALE'
                ? 'The person in the scene must have MASCULINE hands and appearance (male wrist, male clothing).'
                : genderTag === 'FEMALE'
                  ? 'The person in the scene must have FEMININE hands and appearance (female wrist, manicured nails, female clothing).'
                  : '';

              imgPromptsArray = selectedScenes.map(sceneText => {
                return `This is a luxury watch with transparent background (background already removed). Composite this exact watch into the following lifestyle scene:\n\n${sceneText}\n\n${genderNote}\n\nCRITICAL RULES:\n- Do NOT redraw, redesign, or modify the watch in any way.\n- STRICT STRAP RULE: Identify the exact strap material from the attached image (Metal/Steel, Leather, or Rubber). You MUST draw the exact same strap material and design. DO NOT change a steel bracelet into leather/rubber, and vice versa.\n- Keep the watch dial, hands, case, bracelet, brand text, and colors EXACTLY as in the provided image.\n- Lighting must be consistent between the watch and the environment.\n- Output: photorealistic, 4K commercial product photography quality.`;
              });

              console.log(`📋 [Nhánh AI] Đã chọn ${imgPromptsArray.length} cảnh ${genderTag} khác nhau từ file .md!`);
            } else {
              // Fallback: nếu không có scene nào hợp lệ trong section → dùng NEUTRAL hoặc toàn bộ
              console.log(`⚠️ [Nhánh AI] Không có cảnh ${genderTag} hợp lệ, chuyển sang NEUTRAL.`);
              const fallbackPrompt = `This is a luxury watch image with the background removed. Place this exact watch into a high-end lifestyle flat lay scene on white marble with luxury props. CRITICAL: Do NOT alter the watch design — preserve every detail exactly as shown. Photorealistic, 4K quality.`;
              imgPromptsArray = Array(numAiImages).fill(fallbackPrompt);
            }
          } else {
            // Prompt mặc định nếu không có file .md
            const defaultPrompt = `This is a luxury watch image with the background removed. Place this exact watch into a high-end lifestyle scene. CRITICAL: Do NOT alter the watch design in any way — preserve every detail exactly as shown. Photorealistic, 4K quality.`;
            imgPromptsArray = Array(numAiImages).fill(defaultPrompt);
            console.log(`⚠️ [Nhánh AI] Không tìm thấy file gpt_image_prompt.md, dùng prompt mặc định.`);
          }

          const sampleImg = getRandomSampleImage();
          if (sampleImg) liveLog(`🖼️ Dùng ảnh mẫu tham chiếu: ${path.basename(sampleImg)}`, 'highlight', 'ChatGPT');
          if (sampleImg) aiInputReferencePaths.push(sampleImg);

          let extraWatchImages = [];
          try {
            liveLog('📸 [AUTO PUBLISH] Đang tìm ảnh tham khảo từ Ảnh_Hãng/Ảnh_Tự_Chụp...', 'typing', 'Google Drive');
            let extraFilesToDownload = [];
            const skuSubFolders = await getFoldersInFolder(selectedSku.id);
            liveLog(`DEBUG: Tìm thấy ${skuSubFolders.length} thư mục con trong SKU`, 'info', 'System');

            const anhHangFolder = skuSubFolders.find(f => f.name.includes('1_') || f.name.toLowerCase().includes('hãng') || f.name.toLowerCase().includes('hang'));
            const tuChupFolder = skuSubFolders.find(f => f.name.includes('2_') || f.name.toLowerCase().includes('tự') || f.name.toLowerCase().includes('tu'));
            liveLog(`DEBUG: Thư mục 1: ${anhHangFolder?.name || 'Không thấy'}, Thư mục 2: ${tuChupFolder?.name || 'Không thấy'}`, 'info', 'System');

            for (const f of [anhHangFolder, tuChupFolder]) {
              if (f) {
                const imgs = await getImagesInFolder(f.id);
                liveLog(`DEBUG: Thư mục ${f.name} có ${imgs.length} file ảnh hợp lệ (chứa chữ image/)`, 'info', 'System');
                extraFilesToDownload.push(...imgs);
              }
            }
            if (extraFilesToDownload.length > 0) {
              const maxExtra = Math.min(extraFilesToDownload.length, 4);
              extraFilesToDownload = extraFilesToDownload.sort(() => 0.5 - Math.random()).slice(0, maxExtra);
              for (const file of extraFilesToDownload) {
                checkAbort();
                const p = await downloadFileFromDrive(file.id, file.name);
                extraWatchImages.push(p);
                aiInputReferencePaths.push(p);
              }
              liveLog(`✅ Đã tải ${extraWatchImages.length} ảnh tham khảo cho ChatGPT`, 'success', 'Google Drive');
            }
          } catch (e) {
            liveLog(`⚠️ [AUTO PUBLISH] Lỗi khi lấy ảnh tham khảo: ${e.message}`, 'warning', 'Google Drive');
          }

          aiGeneratedImagePaths = await generateImageWithEngine(localFilePaths[0], imgPromptsArray, globalStopController.signal, sampleImg, false, extraWatchImages);
          }

          if (!Array.isArray(aiGeneratedImagePaths) || aiGeneratedImagePaths.length === 0) {
            throw new Error('ChatGPT trả về 0 ảnh AI. Dừng Auto Publish để tránh chạy tiếp khi chưa có ảnh tạo mới.');
          }

          // Lớp chặn cuối ngay trước khâu đăng: kể cả engine hoặc selector thay đổi
          // về sau, ảnh đầu ra trùng ảnh sản phẩm/ảnh mẫu vẫn không được lên Fanpage.
          await assertGeneratedImagesAreNotInputReferences(aiGeneratedImagePaths, aiInputReferencePaths);

          // Xóa ảnh gốc vì không cần thiết đăng ảnh gốc nữa
          if (fs.existsSync(localFilePaths[0])) fs.unlinkSync(localFilePaths[0]);

          // Đổi mảng localFilePaths thành các ảnh AI vừa vẽ (để lát đăng Facebook thành Album)
          localFilePaths = [...aiGeneratedImagePaths];
        } catch (pwError) {
          // Nếu lỗi do lệnh STOP → dừng ngay, không tiếp tục
          if (globalStopController.signal.aborted) {
            liveLog('⏹️ Đã dừng tiến trình theo yêu cầu.', 'error', 'System');
            throw pwError;
          }
          pwError.isAiSkuFailure = true;
          pwError.failedSku = selectedSku?.name || null;
          liveLog(
            `❌ [AUTO PUBLISH] Tạo ảnh AI cho SKU ${selectedSku?.name || 'không xác định'} thất bại: ${pwError.message}. Đang chuyển sang SKU hợp lệ kế tiếp.`,
            'error',
            'ChatGPT',
          );
          throw pwError;
        }
      }

      // --- BẮT ĐẦU VÒNG LẶP CHO NHIỀU ACCOUNTS TRONG AUTO PUBLISH ---
      const accountsPath = path.join(__dirname, '../../config/accounts.json');
      let activeAccounts = [];
      if (fs.existsSync(accountsPath)) {
        activeAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')).filter(a => a.isActive);
      }
      if (activeAccounts.length === 0) {
        liveLog('⚠️ Không có tài khoản hoạt động trong accounts.json, sẽ dùng Default Token từ .env để fallback', 'warning', 'System');
        activeAccounts = [{
           name: 'Mặc định (.env)',
           fbAccessToken: process.env.FB_PAGE_ACCESS_TOKEN,
           igAccessToken: process.env.IG_ACCESS_TOKEN,
           igUserId: process.env.IG_USER_ID,
           isActive: true
        }];
      }

      let mainPostId = null;

      for (const account of activeAccounts) {
         liveLog(`🚀 Đang xử lý cho tài khoản: ${account.name}`, 'info', 'System');
         checkAbort();

         let fbContent = null;
         let igContent = null;
         let thContent = null;
         let postContent = null;
         let targetImgPathForGemini = null;
         let tempImgDownloaded = null;

         // 3.2 GỌI GEMINI ĐỂ VIẾT CONTENT RIÊNG CHO ACCOUNT NÀY
         try {
            console.log(`🤖 [Nhánh ${postMode} - ${account.name}] Gửi ảnh sang ChatGPT để viết Content...`);
            const skuUp = (selectedSku?.name || '').toUpperCase();
            let genderLabel = 'Unisex';
            if (/\dG$|G\d|\dG\d/.test(skuUp)) genderLabel = 'Nam (Male)';
            else if (/\dL$|L\d|\dL\d/.test(skuUp)) genderLabel = 'Nữ (Female)';

            let fbPromptFinal = null;
            let reelsPromptFinal = null;

            const originalFilename = selectedImages[0]?.name || '';
            const selectedSkuInfo = parseColorsFromFilename(originalFilename, selectedSku.name);

            if (fs.existsSync(geminiTemplatePath)) {
              const templateRaw = fs.readFileSync(geminiTemplatePath, 'utf8');
              const fillTemplate = (tmpl) => tmpl
                .replace(/\{\{SKU\}\}/g, selectedSkuInfo)
                .replace(/\{\{PRODUCT_INFO\}\}/g, productInfoText || 'Không có thông tin')
                .replace(/\{\{GENDER\}\}/g, genderLabel);
              const fbIgMatch = templateRaw.match(/## FB_AND_IG_PROMPT_TEMPLATE\s*\n([\s\S]*?)(?=\n---\n## |\n## REELS_|$)/);
              if (fbIgMatch) fbPromptFinal = fillTemplate(fbIgMatch[1].trim());
              const reelsMatch = templateRaw.match(/## REELS_PROMPT_TEMPLATE\s*\n([\s\S]*?)(?=\n---\n## |$)/);
              if (reelsMatch) reelsPromptFinal = fillTemplate(reelsMatch[1].trim());
            }

            if (postMode === 'AI') {
              targetImgPathForGemini = localFilePaths[Math.floor(Math.random() * localFilePaths.length)];
            } else {
              targetImgPathForGemini = localFilePaths[0]; 
            }

            if (postMode === 'REELS') {
              let reelsPrompt = '';
              if (selectedSku.name.toUpperCase().includes('DAILY VLOG')) {
                 reelsPrompt = `Đây là một video Daily Vlog (hoạt động hằng ngày: đóng hàng, giao hàng, vệ sinh đồng hồ...). Hãy đóng vai nhân viên của I&W Carnival, viết một đoạn caption thật ngắn gọn, tự nhiên, vui vẻ, thân thiện. Tuyệt đối KHÔNG quảng cáo hay chèo kéo mua hàng. Chỉ dùng hashtag #iwcarnivalvietnam #iwcarnival #dailyvlog`;
              } else {
                 const reelsFallback = `Hãy đóng vai TikTok creator. Viết caption ngắn giật tít cho video Reels giới thiệu đồng hồ SKU ${selectedSku.name}. Chỉ trả về caption, dùng hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival và các hashtag trending.`;
                 reelsPrompt = (reelsPromptFinal || reelsFallback) + getRandomToneAndPerspective();
              }

              const sampleFolders = ['1_Anh_Hang', '2_Anh_Tu_Chup'];
              for (const sFolder of sampleFolders) {
                const sFolderId = await getFolderIdByName(sFolder, selectedSku.id);
                if (sFolderId) {
                  const sImages = await getImagesInFolder(sFolderId);
                  if (sImages.length > 0) {
                    const sampleImg = sImages[0];
                    tempImgDownloaded = await downloadFileFromDrive(sampleImg.id, `temp_gemini_${sampleImg.name}`);
                    targetImgPathForGemini = tempImgDownloaded;
                    break;
                  }
                }
              }

              const reelsContent = await generateContentOnChatGPT(reelsPrompt, 'reels', targetImgPathForGemini);
              fbContent = reelsContent;
              igContent = reelsContent; 
              thContent = reelsContent;
            } else {
              const fallbackPrompt = `Hãy viết 2 bài theo đúng format:\n## FACEBOOK:\n[Bài FB 50-80 từ, câu mở đầu VIẾT IN HOA, có hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival]\n## INSTAGRAM:\n[Caption IG 15-35 từ, góc nhìn KHÁC bài FB, có hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival]\nSản phẩm: đồng hồ SKU ${selectedSku.name}. Không kèm giải thích.`;
              const combinedPrompt = (fbPromptFinal || fallbackPrompt) + getRandomToneAndPerspective();
              const fbSpecificPrompt = combinedPrompt + "\n\n[LƯU Ý: HÃY CHỈ VIẾT NỘI DUNG CHO FACEBOOK DỰA THEO HƯỚNG DẪN TRÊN. BỎ QUA CÁC PHẦN KHÁC. TRẢ VỀ TRỰC TIẾP NỘI DUNG MÀ KHÔNG CẦN TIÊU ĐỀ ## FACEBOOK]";
              const igSpecificPrompt = combinedPrompt + "\n\n[LƯU Ý: HÃY CHỈ VIẾT NỘI DUNG CHO INSTAGRAM DỰA THEO HƯỚNG DẪN TRÊN. BỎ QUA CÁC PHẦN KHÁC. TRẢ VỀ TRỰC TIẾP NỘI DUNG MÀ KHÔNG CẦN TIÊU ĐỀ ## INSTAGRAM]";

              fbContent = await generateContentOnChatGPT(fbSpecificPrompt, 'fb', targetImgPathForGemini);
              igContent = await generateContentOnChatGPT(igSpecificPrompt, 'ig', targetImgPathForGemini);
            }

            if (tempImgDownloaded && fs.existsSync(tempImgDownloaded)) fs.unlinkSync(tempImgDownloaded);
            
            fbContent = fbContent || `[Đăng Tự Động] Khám phá ngay siêu phẩm đồng hồ ${selectedSku.name} tuyệt đẹp. #iwcarnivalvietnam #iwcarnival #donghoiwcarnival`;
            igContent = igContent || fbContent;
            thContent = fbContent;
            postContent = fbContent;

         } catch (geminiError) {
            checkAbort();
            console.log(`⚠️ Lỗi Playwright ChatGPT: ${geminiError.message}. Dùng nội dung dự phòng.`);
            fbContent = `[Đăng Tự Động] Khám phá ngay siêu phẩm đồng hồ ${selectedSku.name} tuyệt đẹp. #iwcarnivalvietnam #iwcarnival #donghoiwcarnival`;
            igContent = fbContent;
            thContent = fbContent;
            postContent = fbContent;
         }

         liveLog(`✅ [${account.name}] Đã chuẩn bị xong nội dung FB, IG & TH.`, 'success', 'System', { fbContent, igContent, thContent });

         // 5. ĐĂNG FACEBOOK & INSTAGRAM CHO TÀI KHOẢN NÀY
         checkAbort();
         const pageToken = account.fbAccessToken || process.env.FB_PAGE_ACCESS_TOKEN;
         if (!pageToken) {
            liveLog(`⚠️ Bỏ qua Facebook cho ${account.name} vì thiếu FB_PAGE_ACCESS_TOKEN`, 'warning', 'System');
            continue; // Bỏ qua đăng tài khoản này nếu không có token
         }

         const getIgDelayMs = () => {
           try {
             if (fs.existsSync(settingsPath)) {
               const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
               if (settings.mode === 'test') return 0;
               const min = parseInt(settings.igDelayMin) || 0;
               const max = parseInt(settings.igDelayMax) || min;
               if (min <= 0) return 0;
               const randomMinutes = min + Math.random() * (max - min);
               return Math.round(randomMinutes * 60 * 1000);
             }
           } catch (e) { }
           return 0; 
         };

         const sleep = (ms, abortSignal) => new Promise((resolve, reject) => {
           const timer = setTimeout(resolve, ms);
           if (abortSignal) {
             abortSignal.addEventListener('abort', () => {
               clearTimeout(timer);
               reject(new Error('Sleep bị dừng theo yêu cầu.'));
             }, { once: true });
           }
         });

         let postId = null;

         if (postMode === 'REELS') {
            let finalVideoPath = localFilePaths[0];
            const musicDir = path.join(process.cwd(), 'music_library');
            if (fs.existsSync(musicDir)) {
              const hasAudio = await hasAudioStream(finalVideoPath);
              if (hasAudio) {
                liveLog(`🎵 [${account.name}] Video đã có âm thanh gốc, bỏ qua chèn nhạc ngẫu nhiên.`, 'info', 'System');
              } else {
                const musicFiles = fs.readdirSync(musicDir).filter(f => f.toLowerCase().endsWith('.mp3'));
                if (musicFiles.length > 0) {
                  const randomMusic = musicFiles[Math.floor(Math.random() * musicFiles.length)];
                  const musicPath = path.join(musicDir, randomMusic);
                  const mixedVideoPath = finalVideoPath.replace('.mp4', `_mixed_${Date.now()}.mp4`);
                  try {
                    finalVideoPath = await addMusicToVideo(finalVideoPath, musicPath, mixedVideoPath);
                  } catch (e) { }
                }
              }
            }

            if (pageToken) {
              try {
                postId = await publishFBReels(finalVideoPath, postContent, { fbAccessToken: pageToken });
                if (postId) {
                  publishSucceeded = true;
                  successfulPlatforms.add('facebook');
                }
                try {
                  await addPostMetric('facebook_reels', postId, selectedSku.name, postContent);
                } catch (metricError) {
                  console.warn(`⚠️ FB Reels đã đăng nhưng không lưu được metric: ${metricError.message}`);
                }
                liveLog(`✅ [${account.name}] Đăng FB Reels thành công! (ID: ${postId})`, 'success', 'Facebook');
              } catch (e) { liveLog(`❌ [${account.name}] Lỗi FB Reels: ${e.message}`, 'error', 'Facebook'); }
            }

            const igTokenToUse = account.name === 'Mặc định (.env)' ? process.env.IG_ACCESS_TOKEN : account.igAccessToken;
            const igUserToUse = account.name === 'Mặc định (.env)' ? process.env.IG_USER_ID : account.igUserId;

            if (igTokenToUse && igUserToUse) {
              try {
                const delayMs = getIgDelayMs();
                if (delayMs > 0) await sleep(delayMs, globalStopController.signal);
                let igSuccess = false;
                for (let i = 1; i <= 3; i++) {
                  try {
                    await publishIGReels(finalVideoPath, igContent, [], { igAccessToken: igTokenToUse, igUserId: igUserToUse });
                    igSuccess = true;
                    publishSucceeded = true;
                    successfulPlatforms.add('instagram');
                    liveLog(`✅ [${account.name}] Đăng IG Reels thành công!`, 'success', 'Instagram');
                    break; 
                  } catch (igErr) {
                    if (i < 3) await new Promise(r => setTimeout(r, 15000));
                  }
                }
              } catch (e) { liveLog(`❌ [${account.name}] Lỗi IG Reels: ${e.message}`, 'error', 'Instagram'); }
            }

            if (finalVideoPath !== localFilePaths[0] && fs.existsSync(finalVideoPath)) {
              fs.unlinkSync(finalVideoPath);
            }

         } else if (localFilePaths.length === 1) {
            const fbFormData = new FormData();
            fbFormData.append('source', fs.createReadStream(localFilePaths[0]));
            fbFormData.append('published', 'true');
            fbFormData.append('no_story', 'false');
            fbFormData.append('message', postContent);
            fbFormData.append('access_token', pageToken);

            if (pageToken) {
               try {
                  const uploadRes = await axios.post(`https://graph.facebook.com/v21.0/me/photos`, fbFormData, {
                    headers: { ...fbFormData.getHeaders() }
                  });
                  const photoId = uploadRes.data.id;
                  postId = uploadRes.data.post_id || uploadRes.data.id;
                  if (postId) {
                    publishSucceeded = true;
                    successfulPlatforms.add('facebook');
                  }
                  try {
                    await addPostMetric('facebook', postId, selectedSku.name, postContent);
                  } catch (metricError) {
                    console.warn(`⚠️ Bài Facebook đã đăng nhưng không lưu được metric: ${metricError.message}`);
                  }
                  liveLog(`✅ [${account.name}] Đăng FB 1 ảnh thành công! (ID: ${postId})`, 'success', 'Facebook');

                  // --- MOBILE EMULATOR: TỰ ĐỘNG GẮN LINK SHOPEE ---
                  try {
                    let shopeeLinkToAttach = `https://shopee.vn/search?keyword=${selectedSku.name}`;
                    const variant = await prisma.variant.findUnique({ where: { sku: selectedSku.name } });
                    if (variant && variant.shopeeProductId) {
                       shopeeLinkToAttach = `https://shopee.vn/product/0/${variant.shopeeProductId}`; // Format chuẩn nếu có ID
                    }
                    liveLog(`🤖 [Mobile Emulator] Bắt đầu tiến trình gắn link Shopee...`, 'typing', 'Facebook');
                    await attachShopeeLinkMobile(postId, shopeeLinkToAttach);
                  } catch (e) {
                    console.error('Lỗi khi gọi giả lập mobile gắn link:', e);
                  }
                  // ------------------------------------------------

                  // Lớp 1: Lưu hash ảnh vừa đăng vào DB
                  try {
                    const imgBuffer = fs.readFileSync(localFilePaths[0]);
                    const hash = await computeHashFromBuffer(imgBuffer);
                    if (hash) {
                      await saveImageHash(hash, selectedSku.name, 'post');
                      console.log(`✅ Đã lưu hash ảnh (Lớp 1) cho SKU ${selectedSku.name}`);
                    }
                  } catch(e) { console.error('Lỗi tính hash Lớp 1:', e.message); }

                  const igTokenToUse = account.name === 'Mặc định (.env)' ? process.env.IG_ACCESS_TOKEN : account.igAccessToken;
                  const igUserToUse = account.name === 'Mặc định (.env)' ? process.env.IG_USER_ID : account.igUserId;

                  if (igTokenToUse && igUserToUse) {
                    const imgMetaRes = await axios.get(`https://graph.facebook.com/v21.0/${photoId}`, {
                      params: { fields: 'images', access_token: pageToken }
                    });
                    const publicUrl = imgMetaRes.data.images[0].source;
                    const delayMs = getIgDelayMs();
                    if (delayMs > 0) await sleep(delayMs, globalStopController.signal);
                    await publishToInstagram(igContent, publicUrl, [], { igAccessToken: igTokenToUse, igUserId: igUserToUse });
                    publishSucceeded = true;
                    successfulPlatforms.add('instagram');
                    liveLog(`✅ [${account.name}] Đăng IG 1 ảnh thành công!`, 'success', 'Instagram');
                  }
               } catch (e) { liveLog(`❌ [${account.name}] Lỗi đăng FB 1 ảnh: ${e.response?.data?.error?.message || e.message}`, 'error', 'Facebook'); }
            }

         } else {
            // ALBUM MULTI-PHOTO
            const attachedMedia = [];
            const publicUrls = [];

            if (pageToken) {
               try {
                  for (let idx = 0; idx < localFilePaths.length; idx++) {
                    const filePath = localFilePaths[idx];
                    const fbFd = new FormData();
                    fbFd.append('source', fs.createReadStream(filePath));
                    fbFd.append('published', 'false');
                    fbFd.append('access_token', pageToken);

                    const uploadRes = await axios.post(`https://graph.facebook.com/v21.0/me/photos`, fbFd, {
                      headers: { ...fbFd.getHeaders() }
                    });
                    const photoId = uploadRes.data.id;
                    attachedMedia.push({ media_fbid: photoId });

                    try {
                      const imgMetaRes = await axios.get(`https://graph.facebook.com/v21.0/${photoId}`, {
                        params: { fields: 'images', access_token: pageToken }
                      });
                      publicUrls.push(imgMetaRes.data.images[0].source);
                    } catch (e) {}
                  }

                  const feedRes = await axios.post(`https://graph.facebook.com/v21.0/me/feed`, {
                    message: postContent,
                    attached_media: attachedMedia,
                    published: true,
                    access_token: pageToken
                  });
                  postId = feedRes.data.id;
                  if (postId) {
                    publishSucceeded = true;
                    successfulPlatforms.add('facebook');
                  }
                  try {
                    await addPostMetric('facebook', postId, selectedSku.name, postContent);
                  } catch (metricError) {
                    console.warn(`⚠️ Album Facebook đã đăng nhưng không lưu được metric: ${metricError.message}`);
                  }
                  liveLog(`✅ [${account.name}] Đăng Album FB thành công! (ID: ${postId})`, 'success', 'Facebook');

                  // --- MOBILE EMULATOR: TỰ ĐỘNG GẮN LINK SHOPEE ---
                  try {
                    let shopeeLinkToAttach = `https://shopee.vn/search?keyword=${selectedSku.name}`;
                    const variant = await prisma.variant.findUnique({ where: { sku: selectedSku.name } });
                    if (variant && variant.shopeeProductId) {
                       shopeeLinkToAttach = `https://shopee.vn/product/0/${variant.shopeeProductId}`;
                    }
                    liveLog(`🤖 [Mobile Emulator] Bắt đầu tiến trình gắn link Shopee...`, 'typing', 'Facebook');
                    await attachShopeeLinkMobile(postId, shopeeLinkToAttach);
                  } catch (e) {
                    console.error('Lỗi khi gọi giả lập mobile gắn link:', e);
                  }
                  // ------------------------------------------------

                  // Lớp 1: Lưu hash các ảnh trong album vừa đăng
                  for (let idx = 0; idx < localFilePaths.length; idx++) {
                    try {
                      const imgBuffer = fs.readFileSync(localFilePaths[idx]);
                      const hash = await computeHashFromBuffer(imgBuffer);
                      if (hash) await saveImageHash(hash, selectedSku.name, 'post');
                    } catch(e) {}
                  }
                  console.log(`✅ Đã lưu hash cho ${localFilePaths.length} ảnh album (Lớp 1) SKU ${selectedSku.name}`);

                  const igTokenToUse = account.name === 'Mặc định (.env)' ? process.env.IG_ACCESS_TOKEN : account.igAccessToken;
                  const igUserToUse = account.name === 'Mặc định (.env)' ? process.env.IG_USER_ID : account.igUserId;

                  if (igTokenToUse && igUserToUse && publicUrls.length >= 2) {
                    const delayMs = getIgDelayMs();
                    if (delayMs > 0) await sleep(delayMs, globalStopController.signal);
                    const igRes = await publishCarouselToInstagram(igContent, publicUrls, [], { igAccessToken: igTokenToUse, igUserId: igUserToUse });
                    if (igRes && igRes.mediaId) {
                       publishSucceeded = true;
                       successfulPlatforms.add('instagram');
                       await addPostMetric('instagram', igRes.mediaId, selectedSku.name, igContent);
                       liveLog(`✅ [${account.name}] Đăng Album IG thành công!`, 'success', 'Instagram');
                    }
                  }
               } catch (e) { liveLog(`❌ [${account.name}] Lỗi đăng Album FB: ${e.response?.data?.error?.message || e.message}`, 'error', 'Facebook'); }
            }
         }

         if (!mainPostId && postId) mainPostId = postId;
         
         liveLog(`✅ Hoàn thành tài khoản: ${account.name}`, 'success', 'System');
      } // KẾT THÚC VÒNG LẶP CHO NHIỀU ACCOUNTS

      if (!publishSucceeded) {
        throw new Error('Không có nền tảng nào đăng bài thành công. Không cập nhật lịch sử SKU/media.');
      }

      const postId = mainPostId || "N/A";
      finalPostId = postId;
      if (selectedSku) finalSkuName = selectedSku.name;

      // Đẩy lịch sử lên giao diện Dashboard
      addActivity(`Đăng thành công sản phẩm ${selectedSku.name} lên ${activeAccounts.length} Page!`, 'success');

      // Lưu Post ID và Ngày đăng lên Google Sheets
      try {
        await updateProductPostInfo(selectedSku.name, postId);
      } catch (sheetError) {
        // Bài đã lên nền tảng: không được làm cả job retry và đăng trùng chỉ vì Sheet lỗi.
        liveLog(
          `⚠️ Bài đã đăng thành công nhưng chưa cập nhật được lịch sử SKU ${selectedSku.name} trên Google Sheets: ${sheetError.message}`,
          'warning',
          'Google Sheets',
        );
      }

    } catch (e) {
      // Nếu lỗi do lệnh STOP → dừng ngay
      if (globalStopController.signal.aborted) {
        liveLog('⏹️ Tiến trình đã bị dừng hoàn toàn.', 'error', 'System');
        throw e;
      }
      console.log(`⚠️ Lỗi tổng thể (trích xuất thông tin hoặc tạo ảnh): ${e.message}.`);
      throw e;
    }

    // 6. Chỉ lưu ID media sau khi ít nhất một nền tảng đã đăng thành công.
    for (const img of selectedImages) {
      try {
        await addPostedImageId(img.id);
      } catch (historyError) {
        liveLog(
          `⚠️ Bài đã đăng nhưng chưa lưu được media ${img.id} vào lịch sử: ${historyError.message}`,
          'warning',
          'System',
        );
      }
    }

    // 7. Dọn sạch toàn bộ thư mục temp_images để tránh tích tụ file rác (ảnh gốc, rmbg, resize, chatgpt...)
    cleanTempDirectory();

    return {
      success: true,
      publishSucceeded,
      publishedPlatforms: [...successfulPlatforms],
      postId: finalPostId,
      sku: finalSkuName,
    };

  } catch (error) {
    // Dọn rác nếu lỗi
    cleanTempDirectory();

    if (shouldTryNextSkuAfterAiFailure({
      error,
      aborted: globalStopController.signal.aborted,
    })) {
      context.failedAiSkus.add(error.failedSku);
      liveLog(
        `⏭️ Đã loại SKU ${error.failedSku} khỏi lượt hiện tại. Tool sẽ thử SKU hợp lệ kế tiếp (${context.failedAiSkus.size} SKU AI đã lỗi).`,
        'warning',
        'System',
      );
      return await autoPublishRoutine(context);
    }

    console.error('❌ Tiến trình tự động thất bại:', error.response?.data || error.message);
    throw error;
  } finally {
    if (isRootAttempt) {
      isRoutineRunning = false;
    }
  }
}

export async function attachShopeeLinkMobile(postId, shopeeLinkToAttach) {
  liveLog(`🤖 [ADB Emulator] Mở giả lập Android để gắn link cho post: ${postId}...`, 'info', 'Facebook');
  
  try {
    const deviceId = await checkAdbDevice();
    liveLog(`🤖 [ADB Emulator] Đã kết nối giả lập: ${deviceId}`, 'info', 'Facebook');
    
    // Mở ứng dụng Facebook bằng deep link đến bài viết (nếu hỗ trợ) hoặc mở app Facebook thường
    // fb://page/{page_id} hoặc fb://post/{post_id}
    // Tuy nhiên, do cấu trúc ID của Graph API phức tạp (pageId_postId), an toàn nhất là mở ứng dụng
    liveLog(`🤖 [ADB Emulator] Đang mở ứng dụng Facebook...`, 'typing', 'Facebook');
    await runAdbCommand('shell monkey -p com.facebook.katana -c android.intent.category.LAUNCHER 1');
    await sleep(8000); // Chờ App load xong
    
    // Yêu cầu: Giả lập phải ĐANG MỞ SẴN ở màn hình Trang cá nhân (Profile Fanpage) và vừa mới đăng bài.
    // Thực hiện thao tác vuốt để Refresh trang
    liveLog(`🤖 [ADB Emulator] Đang làm mới bảng tin Fanpage...`, 'typing', 'Facebook');
    await runAdbCommand('shell input swipe 500 400 500 1200 600');
    await sleep(5000); 
    
    liveLog(`🤖 [ADB Emulator] Đang tìm dấu 3 chấm của bài viết đầu tiên...`, 'typing', 'Facebook');
    let xml = await dumpUI();
    // Trên App Facebook tiếng Việt, dấu 3 chấm bài viết thường có content-desc là "Tùy chọn khác" hoặc "Tùy chọn bài viết"
    let moreBtn = await findNodeByKeyword(xml, ['Tùy chọn khác', 'Tùy chọn bài viết', 'Hành động đối với bài viết']);
    
    // Nếu không tìm thấy, thử vuốt xuống 1 chút
    if (!moreBtn) {
        await runAdbCommand('shell input swipe 500 1000 500 500 500');
        await sleep(3000);
        xml = await dumpUI();
        moreBtn = await findNodeByKeyword(xml, ['Tùy chọn khác', 'Tùy chọn bài viết', 'Hành động đối với bài viết']);
    }

    if (moreBtn) {
        liveLog(`🤖 [ADB Emulator] Đã tìm thấy nút 3 chấm, đang bấm...`, 'typing', 'Facebook');
        await tap(moreBtn.x, moreBtn.y);
        await sleep(3000); // Chờ menu pop-up hiện lên
        
        liveLog(`🤖 [ADB Emulator] Tìm nút "Quản lý liên kết đến sản phẩm"...`, 'typing', 'Facebook');
        xml = await dumpUI();
        const manageLinkBtn = await findNodeByKeyword(xml, ['Quản lý liên kết đến sản phẩm', 'Thêm liên kết sản phẩm']);
        
        if (manageLinkBtn) {
            await tap(manageLinkBtn.x, manageLinkBtn.y);
            await sleep(3000); // Chờ form chuyển trang
            
            liveLog(`🤖 [ADB Emulator] Đang nhập URL Shopee...`, 'typing', 'Facebook');
            xml = await dumpUI();
            
            // Tìm ô URL
            const urlInput = await findNodeByKeyword(xml, ['URL', 'Nhập URL', 'Liên kết']);
            if (urlInput) {
                await tap(urlInput.x, urlInput.y);
                await sleep(1000);
                await inputText(shopeeLinkToAttach);
                await sleep(1000);
                // Bấm nút Next / Enter trên bàn phím ảo để thoát focus
                await runAdbCommand('shell input keyevent 66');
            }
            
            liveLog(`🤖 [ADB Emulator] Đang nhập Tên liên kết...`, 'typing', 'Facebook');
            xml = await dumpUI();
            const nameInput = await findNodeByKeyword(xml, ['Tên liên kết', 'Mua ở đây']);
            if (nameInput) {
                await tap(nameInput.x, nameInput.y);
                await sleep(1000);
                await inputText('Mua ở đây');
                await sleep(1000);
                await runAdbCommand('shell input keyevent 66'); // Ẩn bàn phím
            }
            
            liveLog(`🤖 [ADB Emulator] Bấm nút Lưu...`, 'typing', 'Facebook');
            xml = await dumpUI();
            const saveBtn = await findNodeByKeyword(xml, ['Lưu']);
            if (saveBtn) {
                await tap(saveBtn.x, saveBtn.y);
                await sleep(3000);
                liveLog(`✅ [ADB Emulator] Đã gắn link Shopee thành công!`, 'success', 'Facebook');
            } else {
                liveLog(`❌ [ADB Emulator] Lỗi: Không tìm thấy nút Lưu.`, 'error', 'Facebook');
            }
        } else {
            liveLog(`❌ [ADB Emulator] Lỗi: Không tìm thấy dòng "Quản lý liên kết đến sản phẩm" trong Menu 3 chấm.`, 'error', 'Facebook');
        }
    } else {
        liveLog(`❌ [ADB Emulator] Lỗi: Không tìm thấy nút 3 chấm nào trên màn hình app.`, 'error', 'Facebook');
    }
  } catch (error) {
    liveLog(`❌ [ADB Emulator] Bị lỗi: ${error.message}`, 'error', 'Facebook');
  }
}
