import { chromium } from 'playwright';
import fs from 'fs';
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Utility copy từ shopeeSync để gọi AI xoay vòng (chống rate limit 429)
async function callAIWithRotation(prompt, images = []) {
  const geminiSetting = await prisma.setting.findUnique({ where: { key: "gemini_api_key" } });
  const geminiKeys = (geminiSetting?.value || "").split(",").map((k) => k.trim()).filter((k) => k !== "");
  const openaiSetting = await prisma.setting.findUnique({ where: { key: "openai_api_key" } });
  const openaiKeys = (openaiSetting?.value || "").split(",").map((k) => k.trim()).filter((k) => k !== "");
  
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  
  for (let i = 0; i < geminiKeys.length; i++) {
    const apiKey = geminiKeys[i];
    let retryCount = 1;
    while (true) {
      try {
        const ai = new GoogleGenerativeAI(apiKey);
        const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
        const parts = [prompt, ...images.map((img) => ({ inlineData: { data: img.data, mimeType: img.mimeType } }))];
        const result = await model.generateContent(parts);
        const response = await result.response;
        return response.text().trim();
      } catch (error) {
        if (error.message?.includes("429") || error.message?.includes("503") || error.status === 429 || error.status === 503) {
          console.warn(`[AI] Gemini Key ${i + 1} báo bận (429/503). Đang chờ 5s để thử lại lần ${retryCount}...`);
          await new Promise(res => setTimeout(res, 5000));
          retryCount++;
          if (retryCount > 5) break; // Thử lại 5 lần rồi chuyển key
          continue;
        }
        console.error(`[AI] Lỗi Gemini Key ${i + 1}:`, error.message);
        break; // Lỗi khác (ví dụ: sai key) thì bỏ qua key này luôn
      }
    }
  }
  
  for (let i = 0; i < openaiKeys.length; i++) {
    const apiKey = openaiKeys[i];
    let retryCount = 1;
    while (true) {
      try {
        console.log(`[AI] Đang thử sử dụng OpenAI (GPT-4o) làm dự phòng...`);
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  ...images.map((img) => ({
                    type: "image_url",
                    image_url: { url: `data:${img.mimeType};base64,${img.data}` }
                  }))
                ]
              }
            ],
            max_tokens: 800
          })
        });
        const data = await response.json();
        if (data.choices && data.choices[0]) {
          return data.choices[0].message.content.trim();
        } else if (data.error) {
          throw new Error(data.error.message);
        }
      } catch (error) {
        if (error.message?.includes("429") || error.message?.includes("503") || error.status === 429 || error.status === 503) {
          console.warn(`[AI] OpenAI Key ${i + 1} báo bận (429/503). Đang chờ 5s để thử lại lần ${retryCount}...`);
          await new Promise(res => setTimeout(res, 5000));
          retryCount++;
          if (retryCount > 3) break;
          continue;
        }
        console.error(`[AI] Lỗi OpenAI Key ${i + 1}:`, error.message);
        break;
      }
    }
  }
  throw new Error("Tất cả các API Key Gemini đều không khả dụng hoặc hết hạn mức.");
}

/**
 * Trích xuất loại dây từ SKU suffix
 */
export function detectStrapFromSku(sku) {
  const match = sku.match(/-([A-Za-z]+)\d*$/i);
  if (!match) return null;
  const suffix = match[1].toUpperCase();
  const strapMap = {
    'T': 'Dây Thép Không Gỉ 316L Cao Cấp',
    'D': 'Dây Da Cao Cấp',
    'S': 'Dây Cao Su Cao Cấp',
    'V': 'Dây Vải Cao Cấp',
  };
  return strapMap[suffix] ? { suffix, strapType: strapMap[suffix] } : null;
}

export async function scrapeWatchSpecs(sku, brand, sendLog, checkStop) {
  sendLog(`[Scrape] Tìm kiếm thông số kỹ thuật cho SKU: ${sku}...`);
  if (checkStop && checkStop()) throw new Error('STOP_REQUESTED');

  const strapInfo = detectStrapFromSku(sku);
  const skuSuffix = strapInfo ? strapInfo.suffix.toLowerCase() : null;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let specs = '';

  const modelCodeLower = sku.split('-')[0].trim().toLowerCase();
  const matchNumber = modelCodeLower.match(/\d+/);
  const modelNumber = matchNumber ? matchNumber[0] : ''; 
  const brandLower = brand ? brand.toLowerCase() : '';

  try {
    sendLog(`[Scrape] Tìm kiếm mã ${modelNumber} trên Zenwatch...`);
    await page.goto(`https://zenwatch.vn/?s=${encodeURIComponent(modelNumber)}&post_type=product`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForTimeout(1500);

    let extractedLinks = [];
    const currentUrl = page.url();

    if (currentUrl.includes('/product/')) {
      sendLog(`[Scrape] ⚡ Zenwatch tự redirect thẳng vào trang sản phẩm (1 kết quả).`);
      const title = await page.innerText('h1.product_title').catch(() => '');
      extractedLinks = [{ href: currentUrl, text: title.toLowerCase() }];
    } else {
      const selectors = '.product-item a, .product-card a, .product-name a, .product a, .woocommerce-LoopProduct-link';
      let productLinks = await page.$$(selectors);

      extractedLinks = await Promise.all(productLinks.map(async (l) => {
        const href = await l.getAttribute('href');
        const text = await l.innerText();
        return { href, text: (text || '').trim().toLowerCase() };
      }));
    }

    extractedLinks = extractedLinks.filter(item => {
      if (!item.href || !item.href.startsWith('https://zenwatch.vn') || !item.href.includes('/product/')) return false;
      const isModelMatch = item.href.includes(modelNumber) || item.text.includes(modelNumber);
      const isBrandMatch = !brandLower || item.href.includes(brandLower.replace(/\s+/g, '-')) || item.text.includes(brandLower);
      return isModelMatch && isBrandMatch;
    });
    
    const uniqueHrefs = [...new Set(extractedLinks.map(i => i.href))];

    sendLog(`[Scrape] Tìm thấy ${uniqueHrefs.length} link sản phẩm hợp lệ chứa mã ${modelNumber} và thương hiệu ${brand} trên Zenwatch.`);

    let matchedUrl = null;

    if (uniqueHrefs.length > 0) {
      if (skuSuffix) {
        const suffixPattern = new RegExp(`-${skuSuffix}(?:\\d|[-/]|$)`, 'i');
        matchedUrl = uniqueHrefs.find(href => suffixPattern.test(href));

        if (matchedUrl) {
          sendLog(`[Scrape] ✅ Tìm thấy link khớp suffix -${skuSuffix.toUpperCase()}: ${matchedUrl}`);
        } else {
          const otherSuffixes = ['t', 'd', 's', 'v'].filter(s => s !== skuSuffix.toLowerCase());
          matchedUrl = uniqueHrefs.find(href => {
            const hasOtherSuffix = otherSuffixes.some(s => new RegExp(`-${s}(?:\\d|[-/]|$)`, 'i').test(href));
            return !hasOtherSuffix; 
          });
          
          if (matchedUrl) {
            sendLog(`[Scrape] ⚠️ Không có link đuôi -${skuSuffix.toUpperCase()}, dùng link gốc (không xung đột dây): ${matchedUrl}`);
          } else {
            sendLog(`[Scrape] ⚠️ Các link đều thuộc loại dây khác, bỏ qua SKU: ${sku}`);
            return null; 
          }
        }
      } else {
        matchedUrl = uniqueHrefs[0];
      }

      if (matchedUrl) {
        await page.goto(matchedUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }

      await page.waitForSelector('#tab-description', { state: 'attached', timeout: 5000 }).catch(() => {});
      
      try {
        specs = await page.innerText('#tab-description', { timeout: 2000 });
      } catch (e) {
        specs = await page.innerText('body');
      }
      
      sendLog(`[Scrape] ✅ Đã lấy thông số trên Zenwatch cho ${sku}`);
    } else {
      sendLog(`[Scrape] ⚠️ Không tìm thấy bất kỳ kết quả nào cho ${sku} trên Zenwatch, bỏ qua SKU này.`);
      return null;
    }
  } catch (err) {
    sendLog(`[Scrape] ⚠️ Lỗi khi cào web cho ${sku}: ${err.message}`);
  } finally {
    await browser.close();
  }

  return specs ? specs.slice(0, 6000) : null;
}

export async function generateMarketingContent(sku, imagePath, scrapedSpecs, sendLog, checkStop, sheetSpecs) {
  sendLog(`[AI] Đang kiểm tra trạng thái cấp nguồn API...`);
  const allowAutoFill = await prisma.setting.findUnique({ where: { key: 'gemini_allow_autofill' } });
  if (allowAutoFill && allowAutoFill.value === 'false') {
    sendLog(`[AI] ❌ TÍNH NĂNG CẤP NGUỒN AI CHO "CÀO DỮ LIỆU" ĐANG BỊ TẮT!`);
    throw new Error('AI đã bị tắt, không thể dịch ảnh hoặc xào thông số.');
  }

  sendLog(`[AI] Đang gọi AI (Gemini/OpenAI) sinh nội dung cho SKU: ${sku}...`);
  if (checkStop && checkStop()) throw new Error('STOP_REQUESTED');

  let images = [];
  if (imagePath && typeof imagePath === 'string') {
    try {
      if (imagePath.startsWith('http')) {
        sendLog(`[AI] Đang tải ảnh từ web để phân tích...`);
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        const response = await fetch(imagePath);
        if (!response.ok) throw new Error(`Lỗi HTTP: ${response.status}`);
        const buffer = await response.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString('base64');
        const mimeType = response.headers.get('content-type') || 'image/jpeg';
        images.push({ data: base64Data, mimeType });
      } else if (fs.existsSync(imagePath)) {
        const base64Data = fs.readFileSync(imagePath, { encoding: 'base64' });
        const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        images.push({ data: base64Data, mimeType });
      }
    } catch (err) {
      sendLog(`[AI] ⚠️ Không thể tải/đọc ảnh để phân tích: ${err.message}`);
    }
  }

  const formattedSheetSpecs = sheetSpecs 
    ? Object.entries(sheetSpecs)
        .filter(([_, v]) => v && v.toString().trim() !== '')
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : 'Không có thông số từ file.';

  const promptText = `Bạn là chuyên gia content ecommerce ngành đồng hồ cao cấp.
Viết:
1. mô tả ngắn
2. mô tả dài
cho sản phẩm:
Đồng hồ đeo tay nam mã SKU: ${sku}

Thông số sản phẩm (ƯU TIÊN DÙNG THÔNG SỐ NÀY ĐỂ VIẾT):
${formattedSheetSpecs}

(Thông số phụ thêm cào từ web nếu cần: ${scrapedSpecs || 'Không có'})

Yêu cầu:
- Chuẩn SEO ecommerce
- Dễ đọc
- Sang trọng
- Tăng chuyển đổi

Bắt buộc:
- Nhấn mạnh USP (nếu có trong thông số):
+ automatic
+ sapphire
+ thép 316L
+ chống nước
- Mô tả:
+ thiết kế
+ trải nghiệm đeo
+ đối tượng phù hợp
+ phong cách thời trang
- Có CTA cuối bài

Tone:
- premium
- modern luxury
- masculine

Output:
- mô tả ngắn 60–100 từ
- mô tả dài 300–600 từ
- chia đoạn rõ ràng
- Yêu cầu viết giữ đồng nhất theo từng thiết kế sản phẩm, không viết lặp nội dung.

- YÊU CẦU ĐẶC BIỆT VỀ ĐỊNH DẠNG (BẮT BUỘC TUÂN THỦ 100%):
  + phong_cach: BẮT BUỘC VIẾT BẰNG TIẾNG ANH. Chỉ được chọn 1 cụm từ duy nhất. Tuyệt đối không dùng dấu gạch chéo (/).
  + lay_cam_hung_tu: Bắt buộc bắt đầu bằng "BST" + tên dòng đồng hồ CỤ THỂ NHẤT (VD: Rolex Daytona, AP Royal Oak, Patek Nautilus...). Không giải thích.
  + phoi_do: Bắt buộc phải liệt kê các món đồ, không được bỏ trống.

Hãy tạo ra JSON sau (KHÔNG MARKDOWN, CHỈ JSON THUẦN):
{
  "mo_ta_ngan": "Mô tả ngắn 60–100 từ, giới thiệu hấp dẫn, tập trung điểm nổi bật nhất",
  "mo_ta_day_du": "Mô tả dài 300–600 từ, chia đoạn rõ ràng, bao gồm thiết kế, chất liệu, tính năng, trải nghiệm đeo, và CTA cuối bài",
  "phong_cach": "Đưa ra 1 cụm từ phong cách BẰNG TIẾNG ANH (tối đa 3 từ). TUYỆT ĐỐI KHÔNG dùng dấu /. Ví dụ: Luxury Dress, Minimalist",
  "muc_do_luxury": "Bắt buộc chọn 1 trong: [Low Luxury, Mid Luxury, High Luxury]",
  "lay_cam_hung_tu": "Luôn ưu tiên tên dòng đồng hồ biểu tượng cụ thể nhất (VD: BST Rolex Daytona, BST AP Royal Oak). KHÔNG viết thành câu.",
  "phu_hop_voi_ai": "ví dụ: Doanh nhân, nhân viên văn phòng trẻ năng động",
  "dip_su_dung": "ví dụ: Đi làm, họp đối tác, tiệc tối",
  "tinh_cach_phu_hop": "ví dụ: Lịch lãm, tự tin, chú trọng hình ảnh",
  "phoi_do": "Bắt buộc điền, ví dụ: Suit vest, sơ mi trắng cài khuy măng sét",
  "phan_khuc_gia": "ví dụ: 3-5 triệu / 5-10 triệu / 10-20 triệu",
  "mau_mat_so": "ví dụ: Xanh Navy / Đen / Trắng bạc / Champagne"
}

Trả về ĐÚNG JSON THUẦN, không có backtick hay markdown. Nếu thiếu thông tin, hãy dự đoán chuyên nghiệp dựa trên ảnh.`;

  try {
    const rawResult = await callAIWithRotation(promptText, images);
    const jsonStr = rawResult.replace(/```json/gi, '').replace(/```/gi, '').trim();
    return JSON.parse(jsonStr);
  } catch (err) {
    if (err.message === 'STOP_REQUESTED') throw err;
    sendLog(`[AI] ❌ Lỗi khi sinh content: ${err.message}`);
    throw err;
  }
}
