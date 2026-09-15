import { chromium } from 'playwright';
import fs from 'fs';
import sharp from 'sharp';

const DIAL_COLOR_CONFIDENCE_THRESHOLD = 0.76;
const CATALOG_PATH = new URL('../../../data/catalog.json', import.meta.url);
let catalogDialColorIndex = new Map();
let catalogDialColorMtimeMs = -1;

const normalizeTextForColor = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/đ/g, 'd')
  .trim();

export const normalizeDialColor = (value) => {
  const normalized = normalizeTextForColor(value);
  if (!normalized) return '';
  if (/tiffany|tifany|bac ha|ice blue|mint/.test(normalized)) return 'Xanh Tiffany';
  if (/navy|deep blue/.test(normalized)) return 'Xanh navy';
  if (/xanh (la|luc)|emerald|luc bao/.test(normalized)) return 'Xanh lá';
  if (/xanh|blue|lam|dai duong/.test(normalized)) return 'Xanh dương';
  if (/den|black|ngoc trai den/.test(normalized)) return 'Đen';
  if (/trang bac|^bac|silver/.test(normalized)) return 'Trắng bạc';
  if (/xam|gray|grey/.test(normalized)) return 'Xám';
  if (/trang|white|ngoc trai trang/.test(normalized)) return 'Trắng';
  if (/nau|brown|chocolate/.test(normalized)) return 'Nâu';
  if (/champagne/.test(normalized)) return 'Champagne';
  if (/cam|orange/.test(normalized)) return 'Cam';
  if (/vang|gold/.test(normalized)) return 'Vàng';
  if (/(^|\s)do($|\s)|red|ruou vang/.test(normalized)) return 'Đỏ';
  if (/hong|pink/.test(normalized)) return 'Hồng';
  if (/tim|purple|violet/.test(normalized)) return 'Tím';
  return '';
};

const getDialColorFamily = (color) => {
  if (['Xanh dương', 'Xanh navy', 'Xanh Tiffany'].includes(color)) return 'blue';
  if (color === 'Xanh lá') return 'green';
  if (['Trắng', 'Trắng bạc', 'Xám'].includes(color)) return 'neutral';
  if (color === 'Đen') return 'black';
  if (['Nâu', 'Champagne', 'Cam', 'Vàng', 'Đỏ', 'Hồng'].includes(color)) return 'warm';
  if (color === 'Tím') return 'purple';
  return '';
};

const normalizeImageUrl = (value) => String(value || '').trim().split(/[?#]/, 1)[0].toLowerCase();

const loadCatalogDialColorIndex = () => {
  try {
    const stats = fs.statSync(CATALOG_PATH);
    if (stats.mtimeMs === catalogDialColorMtimeMs) return catalogDialColorIndex;

    const rows = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    const nextIndex = new Map();
    for (const row of rows) {
      const sku = String(row['Mã sản phẩm'] || '').trim().toUpperCase();
      const imageUrl = normalizeImageUrl(row.imageUrl || row['Link ảnh sản phẩm']);
      const color = normalizeDialColor(row['Màu mặt số']);
      if (sku && imageUrl && color) nextIndex.set(`${sku}|${imageUrl}`, color);
    }

    catalogDialColorIndex = nextIndex;
    catalogDialColorMtimeMs = stats.mtimeMs;
  } catch {
    catalogDialColorIndex = new Map();
    catalogDialColorMtimeMs = -1;
  }
  return catalogDialColorIndex;
};

export const findCatalogDialColor = (sku, imagePath) => {
  const normalizedSku = String(sku || '').trim().toUpperCase();
  const normalizedUrl = normalizeImageUrl(imagePath);
  if (!normalizedSku || !normalizedUrl) return '';
  return loadCatalogDialColorIndex().get(`${normalizedSku}|${normalizedUrl}`) || '';
};

const rgbToHsv = (red, green, blue) => {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;

  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * (((b - r) / delta) + 2);
    else hue = 60 * (((r - g) / delta) + 4);
  }
  if (hue < 0) hue += 360;

  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
};

/**
 * Nhận diện màu mặt số bằng pixel trong vùng trung tâm ảnh sản phẩm.
 * Chỉ trả màu khi độ tin cậy đủ cao; ảnh lệch tâm/lifestyle/mờ sẽ trả null
 * để Auto-Fill giữ ô trống thay vì đoán từ màu vỏ, dây hoặc hậu cảnh.
 */
export async function detectDialColor(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    return { color: null, confidence: 0, reason: 'missing_image' };
  }

  try {
    const normalizedImage = await sharp(imageBuffer, { failOn: 'none' })
      .rotate()
      .resize(320, 320, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .removeAlpha()
      .jpeg({ quality: 95 })
      .toBuffer();

    const { data, info } = await sharp(normalizedImage)
      .extract({ left: 112, top: 112, width: 96, height: 96 })
      .resize(96, 96)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const totalPixels = info.width * info.height;
    let chromaticPixels = 0;
    let darkPixels = 0;
    let lightNeutralPixels = 0;
    let midNeutralPixels = 0;
    let hueVectorX = 0;
    let hueVectorY = 0;
    let hueWeightTotal = 0;
    let chromaticSaturationTotal = 0;
    let chromaticValueTotal = 0;
    let luminanceTotal = 0;
    let luminanceSquaredTotal = 0;
    let detailEdges = 0;
    let detailComparisons = 0;
    const luminanceValues = new Float32Array(totalPixels);

    for (let offset = 0; offset < data.length; offset += info.channels) {
      const pixelIndex = offset / info.channels;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const { hue, saturation, value } = rgbToHsv(
        red,
        green,
        blue
      );
      const luminance = (
        (0.2126 * red)
        + (0.7152 * green)
        + (0.0722 * blue)
      ) / 255;
      luminanceValues[pixelIndex] = luminance;
      luminanceTotal += luminance;
      luminanceSquaredTotal += luminance ** 2;

      const x = pixelIndex % info.width;
      const y = Math.floor(pixelIndex / info.width);
      if (x > 0) {
        if (Math.abs(luminance - luminanceValues[pixelIndex - 1]) >= 0.06) detailEdges++;
        detailComparisons++;
      }
      if (y > 0) {
        if (Math.abs(luminance - luminanceValues[pixelIndex - info.width]) >= 0.06) detailEdges++;
        detailComparisons++;
      }

      if (value <= 0.24) darkPixels++;
      if (value >= 0.72 && saturation <= 0.18) lightNeutralPixels++;
      if (value > 0.24 && value < 0.72 && saturation <= 0.18) midNeutralPixels++;

      if (saturation >= 0.2 && value >= 0.14 && value <= 0.95) {
        const hueRadians = hue * Math.PI / 180;
        const weight = saturation * (0.5 + value);
        hueVectorX += Math.cos(hueRadians) * weight;
        hueVectorY += Math.sin(hueRadians) * weight;
        hueWeightTotal += weight;
        chromaticSaturationTotal += saturation;
        chromaticValueTotal += value;
        chromaticPixels++;
      }
    }

    const chromaticRatio = chromaticPixels / totalPixels;
    const darkRatio = darkPixels / totalPixels;
    const lightNeutralRatio = lightNeutralPixels / totalPixels;
    const midNeutralRatio = midNeutralPixels / totalPixels;
    const averageLuminance = luminanceTotal / totalPixels;
    const luminanceStdDev = Math.sqrt(Math.max(
      0,
      (luminanceSquaredTotal / totalPixels) - (averageLuminance ** 2)
    ));
    const detailRatio = detailComparisons > 0 ? detailEdges / detailComparisons : 0;
    const hueConcentration = hueWeightTotal > 0
      ? Math.sqrt((hueVectorX ** 2) + (hueVectorY ** 2)) / hueWeightTotal
      : 0;
    let dominantHue = hueWeightTotal > 0
      ? Math.atan2(hueVectorY, hueVectorX) * 180 / Math.PI
      : 0;
    if (dominantHue < 0) dominantHue += 360;

    const averageSaturation = chromaticPixels > 0
      ? chromaticSaturationTotal / chromaticPixels
      : 0;
    const averageValue = chromaticPixels > 0
      ? chromaticValueTotal / chromaticPixels
      : 0;

    let color = null;
    let confidence = 0;

    if (luminanceStdDev < 0.04 || detailRatio < 0.012) {
      return {
        color: null,
        candidate: null,
        confidence: Math.min(0.35, luminanceStdDev + detailRatio),
        reason: 'insufficient_visual_detail',
        metrics: {
          chromaticRatio,
          darkRatio,
          lightNeutralRatio,
          midNeutralRatio,
          dominantHue,
          hueConcentration,
          averageSaturation,
          averageValue,
          luminanceStdDev,
          detailRatio,
        },
      };
    }

    if (chromaticRatio >= 0.22 && hueConcentration >= 0.45) {
      if (dominantHue < 15 || dominantHue >= 345) {
        color = averageValue < 0.52 ? 'Nâu' : 'Đỏ';
      } else if (dominantHue < 35) {
        if (averageValue < 0.53) color = 'Nâu';
        else color = averageSaturation < 0.5 ? 'Champagne' : 'Cam';
      } else if (dominantHue < 75) {
        color = averageSaturation < 0.45 ? 'Champagne' : 'Vàng';
      } else if (dominantHue < 165) {
        color = 'Xanh lá';
      } else if (dominantHue < 198) {
        color = averageValue >= 0.66 && averageSaturation <= 0.65
          ? 'Xanh Tiffany'
          : 'Xanh dương';
      } else if (dominantHue < 255) {
        color = averageValue < 0.4 ? 'Xanh navy' : 'Xanh dương';
      } else if (dominantHue < 305) {
        color = 'Tím';
      } else if (dominantHue < 345) {
        color = averageValue >= 0.55 ? 'Hồng' : 'Đỏ';
      }

      confidence = Math.min(
        0.98,
        0.52 + Math.min(0.26, chromaticRatio * 0.38) + Math.min(0.2, hueConcentration * 0.22)
      );
    } else if (darkRatio >= 0.32) {
      color = 'Đen';
      confidence = Math.min(0.97, 0.58 + darkRatio * 0.72);
    } else if (lightNeutralRatio >= 0.58) {
      color = 'Trắng';
      confidence = Math.min(0.97, 0.58 + lightNeutralRatio * 0.48);
    } else if (
      lightNeutralRatio >= 0.22
      && (lightNeutralRatio + midNeutralRatio) >= 0.55
    ) {
      color = 'Trắng bạc';
      confidence = Math.min(
        0.92,
        0.55 + (lightNeutralRatio + midNeutralRatio * 0.8) * 0.4
      );
    } else if (midNeutralRatio >= 0.42) {
      color = 'Xám';
      confidence = Math.min(0.88, 0.55 + midNeutralRatio * 0.38);
    }

    return {
      color: confidence >= DIAL_COLOR_CONFIDENCE_THRESHOLD ? color : null,
      candidate: color,
      confidence,
      metrics: {
        chromaticRatio,
        darkRatio,
        lightNeutralRatio,
        midNeutralRatio,
        dominantHue,
        hueConcentration,
        averageSaturation,
        averageValue,
        luminanceStdDev,
        detailRatio,
      },
    };
  } catch (error) {
    return {
      color: null,
      confidence: 0,
      reason: 'analysis_failed',
      error: error.message,
    };
  }
}

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
  aiSession,
  aiTone = 'Thu hút (Engaging)'
) {
  if (!aiSession?.generate) {
    throw new Error('Phiên Playwright AI chưa sẵn sàng.');
  }

  const engineName = aiSession.provider === 'gemini' ? 'Gemini' : 'ChatGPT';
  sendLog(`[${engineName}] Đang sinh nội dung bằng Playwright cho SKU: ${sku} (không dùng API)...`);
  if (checkStop && checkStop()) throw new Error('STOP_REQUESTED');

  let image = null;
  if (imagePath && typeof imagePath === 'string') {
    try {
      if (imagePath.startsWith('http')) {
        sendLog(`[${engineName}] Đang tải ảnh sản phẩm để đính kèm...`);
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
      sendLog(`[${engineName}] ⚠️ Không thể tải/đọc ảnh; tiếp tục bằng thông số text: ${err.message}`);
    }
  }

  const dialColorDetection = image?.buffer
    ? await detectDialColor(image.buffer)
    : { color: null, confidence: 0, reason: 'missing_image' };
  const catalogDialColor = findCatalogDialColor(sku, imagePath);
  const pixelDialColor = dialColorDetection.color || '';
  let detectedDialColor = pixelDialColor;
  let colorConfidence = dialColorDetection.confidence || 0;
  let colorSource = pixelDialColor ? 'pixel' : '';

  if (catalogDialColor) {
    const catalogFamily = getDialColorFamily(catalogDialColor);
    const pixelFamily = getDialColorFamily(pixelDialColor);
    if (!pixelDialColor || catalogFamily === pixelFamily) {
      detectedDialColor = catalogDialColor;
      colorConfidence = Math.max(colorConfidence, pixelDialColor ? 0.94 : 0.9);
      colorSource = pixelDialColor ? 'pixel+catalog' : 'catalog';
    } else {
      sendLog(
        `[Color] ⚠️ Màu pixel "${pixelDialColor}" xung đột dữ liệu cũ "${catalogDialColor}" `
        + `cho đúng SKU/ảnh. Tool sẽ để trống để kiểm tra thủ công, không chọn bừa.`
      );
      detectedDialColor = '';
      colorConfidence = 0;
      colorSource = 'conflict';
    }
  }

  const colorConfidencePercent = Math.round(colorConfidence * 100);

  if (detectedDialColor) {
    const sourceDescription = colorSource === 'pixel+catalog'
      ? 'pixel + dữ liệu SKU/ảnh đã đồng bộ'
      : colorSource === 'catalog'
        ? 'dữ liệu SKU/ảnh đã đồng bộ'
        : 'pixel vùng trung tâm mặt số';
    sendLog(
      `[Color] ✅ Nhận diện vùng mặt số: ${detectedDialColor} `
      + `(độ tin cậy ${colorConfidencePercent}%, nguồn: ${sourceDescription}). `
      + `Bỏ qua màu vỏ, dây và nền ảnh.`
    );
  } else if (colorSource !== 'conflict') {
    sendLog(
      `[Color] ⚠️ Ảnh không đủ rõ/không đúng bố cục để xác minh màu mặt số `
      + `(độ tin cậy ${colorConfidencePercent}%). Tool sẽ để trống, không đoán.`
    );
  }

  const dialColorInstruction = detectedDialColor
    ? `MÀU MẶT SỐ ĐÃ XÁC MINH: "${detectedDialColor}".
- Đây là màu của phần mặt số nằm BÊN TRONG viền bezel.
- BẮT BUỘC dùng đúng giá trị này cho mau_mat_so và khi nhắc màu trong mô tả.
- Không được đổi theo màu vỏ, dây, kim, cọc số, ánh phản chiếu hoặc nền ảnh.`
    : `KHÔNG XÁC MINH ĐƯỢC MÀU MẶT SỐ TỪ ẢNH.
- BẮT BUỘC trả mau_mat_so là chuỗi rỗng "".
- Không được đoán màu từ mã SKU, màu vỏ, màu dây, thông số web hoặc hậu cảnh.
- Không nhắc một màu mặt số cụ thể trong phần mô tả.`;

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

QUY TẮC NHẬN DIỆN MÀU MẶT SỐ (BẮT BUỘC):
${dialColorInstruction}

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
  "mau_mat_so": "Chỉ một giá trị đã xác minh: Đen, Trắng, Trắng bạc, Xám, Xanh navy, Xanh dương, Xanh Tiffany, Xanh lá, Nâu, Champagne, Cam, Vàng, Đỏ, Hồng hoặc Tím; nếu không chắc chắn phải để trống"
}

Trả về ĐÚNG JSON THUẦN, không có backtick hay markdown.
Có thể suy luận chuyên nghiệp cho nội dung marketing khi thiếu thông tin, nhưng TUYỆT ĐỐI KHÔNG ĐƯỢC SUY LUẬN HOẶC ĐIỀN BỪA trường mau_mat_so.`;

  try {
    const rawResult = await aiSession.generate(promptText, image, checkStop);
    const cleaned = rawResult.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const jsonText = firstBrace >= 0 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;
    const parsedResult = JSON.parse(jsonText);
    const aiDialColor = String(parsedResult.mau_mat_so || '').trim();
    parsedResult.mau_mat_so = detectedDialColor;

    if (
      aiDialColor
      && aiDialColor.toLocaleLowerCase('vi-VN') !== detectedDialColor.toLocaleLowerCase('vi-VN')
    ) {
      sendLog(
        detectedDialColor
          ? `[Color] 🛡️ Đã chặn màu AI đoán "${aiDialColor}" và dùng màu đã xác minh "${detectedDialColor}".`
          : `[Color] 🛡️ Đã loại màu AI đoán "${aiDialColor}" vì ảnh không đủ độ tin cậy.`
      );
    }

    return parsedResult;
  } catch (err) {
    if (err.message === 'STOP_REQUESTED') throw err;
    sendLog(`[${engineName}] ❌ Lỗi khi sinh content: ${err.message}`);
    throw err;
  }
}
