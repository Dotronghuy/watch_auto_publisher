import { chromium } from 'playwright';
import fs from 'fs';

export async function createWatchScraper() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'vi-VN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
  });

  // Không tải tài nguyên nặng vì tool chỉ cần HTML/text thông số.
  await context.route('**/*', (route) => {
    const resourceType = route.request().resourceType();
    if (['image', 'media', 'font'].includes(resourceType)) return route.abort();
    return route.continue();
  });

  const page = await context.newPage();
  return {
    page,
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
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

export async function scrapeWatchSpecs(sku, brand, sendLog, checkStop, scraper = null) {
  sendLog(`[Scrape] Tìm kiếm thông số kỹ thuật cho SKU: ${sku}...`);
  if (checkStop && checkStop()) throw new Error('STOP_REQUESTED');

  const strapInfo = detectStrapFromSku(sku);
  const skuSuffix = strapInfo ? strapInfo.suffix.toLowerCase() : null;

  const ownedScraper = scraper ? null : await createWatchScraper();
  const activeScraper = scraper || ownedScraper;
  const page = activeScraper.page;
  let specs = '';

  const modelCodeLower = sku.split('-')[0].trim().toLowerCase();
  const matchNumber = modelCodeLower.match(/\d+/);
  const modelNumber = matchNumber ? matchNumber[0] : '';
  const searchCode = modelNumber || modelCodeLower || sku.toLowerCase();
  const brandLower = brand ? brand.toLowerCase() : '';

  try {
    sendLog(`[Scrape] Tìm kiếm mã ${searchCode} trên Zenwatch...`);
    await page.goto(`https://zenwatch.vn/?s=${encodeURIComponent(searchCode)}&post_type=product`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForTimeout(600);
    if (checkStop?.()) throw new Error('STOP_REQUESTED');

    let extractedLinks = [];
    const currentUrl = page.url();
    const directProductUrl = currentUrl.includes('/product/') ? currentUrl : null;

    if (directProductUrl) {
      sendLog(`[Scrape] ⚡ Zenwatch tự redirect thẳng vào trang sản phẩm (1 kết quả).`);
      const title = await page.innerText('h1.product_title').catch(() => '');
      extractedLinks = [{ href: directProductUrl, text: title.toLowerCase() }];
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
      // Search của Zenwatch chỉ redirect thẳng khi có đúng một kết quả; tin cậy
      // kết quả đó ngay cả khi slug hoặc tiêu đề không lặp lại mã tìm kiếm.
      if (directProductUrl && item.href === directProductUrl) return true;
      const isModelMatch = item.href.toLowerCase().includes(searchCode) || item.text.includes(searchCode);
      const isBrandMatch = !brandLower || item.href.includes(brandLower.replace(/\s+/g, '-')) || item.text.includes(brandLower);
      return isModelMatch && isBrandMatch;
    });
    
    const uniqueHrefs = [...new Set(extractedLinks.map(i => i.href))];

    sendLog(`[Scrape] Tìm thấy ${uniqueHrefs.length} link sản phẩm hợp lệ chứa mã ${searchCode} và thương hiệu ${brand || 'không xác định'} trên Zenwatch.`);

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
        if (checkStop?.()) throw new Error('STOP_REQUESTED');
        await page.goto(matchedUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }

      await page.waitForSelector('#tab-description', { state: 'attached', timeout: 5000 }).catch(() => {});
      if (checkStop?.()) throw new Error('STOP_REQUESTED');
      
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
    if (err.message === 'STOP_REQUESTED') throw err;
    sendLog(`[Scrape] ⚠️ Lỗi khi cào web cho ${sku}: ${err.message}`);
  } finally {
    if (ownedScraper) await ownedScraper.close();
  }

  return specs ? specs.slice(0, 6000) : null;
}

export async function generateMarketingContent(
  sku,
  imagePath,
  scrapedSpecs,
  sendLog,
  checkStop,
  sheetSpecs,
  chatGptSession,
  aiTone = 'Thu hút (Engaging)'
) {
  if (!chatGptSession?.generate) {
    throw new Error('Phiên Playwright ChatGPT chưa sẵn sàng.');
  }

  sendLog(`[ChatGPT] Đang sinh nội dung bằng Playwright cho SKU: ${sku} (không dùng API)...`);
  if (checkStop && checkStop()) throw new Error('STOP_REQUESTED');

  let image = null;
  if (imagePath && typeof imagePath === 'string') {
    try {
      if (imagePath.startsWith('http')) {
        sendLog(`[ChatGPT] Đang tải ảnh sản phẩm để đính kèm...`);
        const response = await globalThis.fetch(imagePath, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`Lỗi HTTP: ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const mimeType = response.headers.get('content-type') || 'image/jpeg';
        image = { buffer, mimeType, name: `watch-${sku}.jpg` };
      } else if (fs.existsSync(imagePath)) {
        const buffer = fs.readFileSync(imagePath);
        const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        image = { buffer, mimeType, name: `watch-${sku}${mimeType === 'image/png' ? '.png' : '.jpg'}` };
      }
    } catch (err) {
      sendLog(`[ChatGPT] ⚠️ Không thể tải/đọc ảnh; tiếp tục bằng thông số text: ${err.message}`);
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
  - Giọng điệu người dùng chọn: ${aiTone}
  - premium, modern luxury, masculine

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
    const rawResult = await chatGptSession.generate(promptText, image, checkStop);
    const cleaned = rawResult.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const jsonText = firstBrace >= 0 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;
    return JSON.parse(jsonText);
  } catch (err) {
    if (err.message === 'STOP_REQUESTED') throw err;
    sendLog(`[ChatGPT] ❌ Lỗi khi sinh content: ${err.message}`);
    throw err;
  }
}
