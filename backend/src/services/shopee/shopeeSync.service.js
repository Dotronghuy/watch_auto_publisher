import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as xlsx from "xlsx";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
const prisma = new PrismaClient();
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
import { getFolderIdByName, getImagesInFolder, getVideosInFolder, downloadFileFromDrive, getFoldersInFolder } from '../drive.service.js';
ffmpeg.setFfprobePath(ffprobeInstaller.path);
async function appendToGoogleSheet(shopeeProductId, sku, productName, onProgress) {
  const log = (msg) => {
    console.log(msg);
    if (onProgress) onProgress(msg);
  };
  try {
    const setting = await prisma.setting.findUnique({ where: { key: "google_sheet_webhook_url" } });
    const webhookUrl = setting?.value?.trim();
    if (!webhookUrl) {
      log("[Sheet] Ch\u01B0a c\u1EA5u h\xECnh Google Sheet Webhook URL. B\u1ECF qua ghi log.");
      return;
    }
    const payload = {
      shopeeProductId,
      sku,
      productName,
      timestamp: (/* @__PURE__ */ new Date()).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    };
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "follow",
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      log(`[Sheet] \u2705 \u0110\xE3 ghi v\xE0o Google Sheet: ${sku} - ID ${shopeeProductId}`);
    } else {
      log(`[Sheet] \u26A0\uFE0F Ghi Sheet th\u1EA5t b\u1EA1i (HTTP ${response.status})`);
    }
  } catch (e) {
    log(`[Sheet] L\u1ED7i ghi Google Sheet: ${e.message}`);
  }
}
function filterAndReportVariants(variants) {
  const validVariants = [];
  const ignoredVariants = [];
  for (const variant of variants) {
    validVariants.push(variant);
  }
  return { validVariants, ignoredVariants };
}
function exportIgnoredReport(ignoredVariants) {
  if (ignoredVariants.length === 0) return null;
  const worksheet = xlsx.utils.json_to_sheet(ignoredVariants);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Bi B\u1ECF Qua");
  const reportDir = path.join(process.cwd(), "Reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const filePath = path.join(reportDir, `Shopee_Sync_Report_${Date.now()}.xlsx`);
  xlsx.writeFile(workbook, filePath);
  return filePath;
}
function findModelFolders(baseDir, modelName, depth = 0) {
  if (depth > 2) return [];
  if (!fs.existsSync(baseDir)) return [];
  let results = [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.toLowerCase().includes(modelName.toLowerCase())) {
      results.push(path.join(baseDir, entry.name));
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      results = results.concat(findModelFolders(path.join(baseDir, entry.name), modelName, depth + 1));
    }
  }
  return results;
}
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
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
            max_tokens: 300
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
          continue;
        }
        console.error(`[AI] Lỗi OpenAI Key ${i + 1}:`, error.message);
        break;
      }
    }
  }
  throw new Error("T\u1EA5t c\u1EA3 c\xE1c API Key (Gemini & OpenAI) \u0111\u1EC1u kh\xF4ng kh\u1EA3 d\u1EE5ng ho\u1EB7c h\u1EBFt h\u1EA1n m\u1EE9c.");
}
async function checkColorMatchWithAI(avatarPath, targetImagePath) {
  try {
    let fileToGenerativePart = function (filePath, mimeType) {
      return {
        data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
        mimeType
      };
    };
    const avatarPart = fileToGenerativePart(avatarPath, "image/jpeg");
    const targetPart = fileToGenerativePart(targetImagePath, "image/jpeg");
    const prompt = "Hãy kiểm tra xem hai chiếc đồng hồ trong 2 bức ảnh này có CÙNG MÀU VỎ (Case Color) hay không (ví dụ: cùng là vỏ thép bạc, hoặc cùng là vỏ mạ vàng/vàng hồng). TUYỆT ĐỐI BỎ QUA sự khác biệt về màu mặt số bên trong và BỎ QUA sự khác biệt về màu dây đeo (dây có thể khác màu). Chỉ trả lời duy nhất bằng chữ YES nếu chúng có CÙNG MÀU VỎ, hoặc NO nếu màu vỏ khác nhau.";
    const text = await callAIWithRotation(prompt, [avatarPart, targetPart]);
    if (!text) return false;
    const resultText = text.toUpperCase();
    console.log(`[Media] AI Color Match k\u1EBFt qu\u1EA3: ${resultText}`);
    return resultText.includes("YES");
  } catch (e) {
    console.error("[Media] AI Color Match lỗi:", e);
    return false;
  }
}

async function groupVariantsByDesignAI(targetVariant, potentialVariants, pushLog) {
  pushLog(`[AI] Bắt đầu gom nhóm biến thể cùng vỏ bằng logic và AI cho ${targetVariant.sku}...`);
  // Bước 1: Lọc cứng
  const targetParts = targetVariant.sku.split('-');
  if (targetParts.length < 2) return [targetVariant];
  
  const targetPrefix = targetParts[1].charAt(0); // VD: 'T' trong 'T7', hoặc 'S' trong 'S1'
  
  // Lọc ra các biến thể có ký tự đầu tiên sau dấu '-' giống nhau
  const logicFiltered = potentialVariants.filter(v => {
    const p = v.sku.split('-');
    if (p.length < 2) return false;
    return p[1].charAt(0).toUpperCase() === targetPrefix.toUpperCase();
  });
  
  pushLog(`[AI] Lọc logic (cùng dây ${targetPrefix}): ${logicFiltered.map(v=>v.sku).join(', ')}`);
  
  if (logicFiltered.length <= 1) return logicFiltered;
  
  const allAvatars = potentialVariants.filter(v => v.isAvatar);
  if (allAvatars.length === 1) {
      pushLog(`[AI] Chỉ có 1 Avatar cho model này. Bỏ qua AI soi màu, gộp chung tất cả các biến thể vào 1 sản phẩm!`);
      return logicFiltered;
  }
  
  // Bước 2: Lọc mềm (AI)
  pushLog(`[AI] Chuẩn bị gửi ${logicFiltered.length} ảnh lên AI để soi màu vỏ...`);
  
  try {
    let fileToGenerativePart = function(filePath, mimeType) {
      if (!fs.existsSync(filePath)) return null;
      return {
        data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
        mimeType
      };
    };

    const getBestImage = (v) => (v.avatarImage && fs.existsSync(v.avatarImage)) ? v.avatarImage : ((v.rawImage && fs.existsSync(v.rawImage)) ? v.rawImage : null);

    const targetImg = getBestImage(targetVariant);
    const targetPart = targetImg ? fileToGenerativePart(targetImg, "image/jpeg") : null;
    if (!targetPart) {
      pushLog("[AI] Biến thể gốc không có ảnh hợp lệ, bỏ qua lọc AI.");
      return logicFiltered;
    }

    const finalGroup = [targetVariant];

    for (const v of logicFiltered) {
      if (v.sku === targetVariant.sku) continue; // Đã thêm ở trên
      const vImg = getBestImage(v);
      if (!vImg) {
        pushLog(`[AI] ⚠️ Bỏ qua ${v.sku} vì không có ảnh (cả Avatar lẫn ảnh gốc).`);
        continue;
      }
      
      pushLog(`[AI] Đang soi chéo màu vỏ: ${targetVariant.sku} vs ${v.sku}...`);
      const isMatch = await checkColorMatchWithAI(targetImg, vImg);
      if (isMatch) {
        pushLog(`[AI] 🟢 KHỚP MÀU VỎ! Gộp ${v.sku} vào chung nhóm với ${targetVariant.sku}`);
        finalGroup.push(v);
      } else {
        pushLog(`[AI] 🔴 Lệch màu! Tách ${v.sku} ra nhóm riêng.`);
      }
    }

    // Những mã bị lỗi không có ảnh (bị loại ở vòng duyệt part) thì mặc định loại.
    pushLog(`[AI] Kết quả nhóm AI soi màu vỏ (cùng màu với ${targetVariant.sku}): ${finalGroup.map(v=>v.sku).join(', ')}`);
    return finalGroup;

  } catch (e) {
    pushLog(`[AI] Lỗi quá trình lọc màu bằng AI: ${e.message}`);
    return logicFiltered; // Nếu lỗi AI, trả về kết quả lọc logic
  }
}
async function prepareMediaForShopee(modelName, sku, avatarPath, onProgress) {
  const log = (msg) => {
    console.log(msg);
    if (onProgress) onProgress(msg);
  };
  if (!avatarPath || !fs.existsSync(avatarPath)) {
    throw new Error("Thi\u1EBFu \u1EA3nh Avatar c\u1EE7a bi\u1EBFn th\u1EC3. Vui l\xF2ng t\u1EA1o Avatar tr\u01B0\u1EDBc khi Sync.");
  }
  log(`[Media] \u0110ang t\xECm ki\u1EBFm th\u01B0 m\u1EE5c g\u1ED1c cho m\xE3 ${sku} tr\xEAn Google Drive...`);

  const rootFolderId = process.env.ROOT_DRIVE_FOLDER_ID;
  if (!rootFolderId) throw new Error("Chưa cấu hình ROOT_DRIVE_FOLDER_ID trong file .env");

  const brandFolders = await getFoldersInFolder(rootFolderId);
  let targetFolderId = null;

  for (const brandFolder of brandFolders) {
    const subFolders = await getFoldersInFolder(brandFolder.id);
    const exactFolder = subFolders.find(f => f.name.trim().toUpperCase() === sku.toUpperCase());
    const regex = new RegExp('(^|[^a-zA-Z0-9])' + sku.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '([^a-zA-Z0-9]|$)', 'i');
    const skuFolder = exactFolder || subFolders.find(f => regex.test(f.name));
    if (skuFolder) {
      targetFolderId = skuFolder.id;
      log(`[Media] Đã tìm thấy thư mục SKU: ${skuFolder.name} (trong ${brandFolder.name})`);
      break;
    }
  }

  let images = [];
  let targetFolderIdToUse = targetFolderId;
  if (!targetFolderId) {
    log(`[Media] Cảnh báo: KHÔNG TÌM THẤY thư mục Media nào cho ${sku} trên Drive. Sẽ dùng ảnh dự phòng.`);
  } else {
    log(`[Media] Lấy ảnh từ folder ID: ${targetFolderIdToUse}`);
    images = await getImagesInFolder(targetFolderIdToUse);
    if (images.length < 3) {
      log(`[Media] Cảnh báo: Thư mục Drive có quá ít ảnh (${images.length} ảnh). Bỏ qua ảnh Drive và ưu tiên dùng ảnh Avatar của nhóm SKU!`);
      images = [];
    }
  }

  let finalImages = [avatarPath];
  let selectedFiles = shuffleArray(images).slice(0, 7);

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    log(`[Media] Đang tải ảnh: ${file.name}`);
    let downloadedPath = await downloadFileFromDrive(file.id, file.name);

    log(`[Media] Đang nén ảnh với Sharp để tối ưu dung lượng tải lên...`);
    const compressedPath = path.join(os.tmpdir(), `shopee_img_compressed_${Date.now()}_${i}.jpg`);
    await sharp(downloadedPath).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(compressedPath);
    downloadedPath = compressedPath;

    finalImages.push(downloadedPath);
  }

  if (images.length === 0) {
    try {
      const modelIdentifier = sku.split('-')[0];
      const potentialVariants = await prisma.variant.findMany({
        where: { sku: { startsWith: modelIdentifier } },
        orderBy: { sku: "asc" }
      });
      const targetVariant = potentialVariants.find(v => v.sku === sku);
      if (targetVariant) {
        const groupVariants = await groupVariantsByDesignAI(targetVariant, potentialVariants, log);
        for (const gv of groupVariants) {
          if (gv.sku !== sku && gv.avatarImage && fs.existsSync(gv.avatarImage)) {
            if (finalImages.length >= 9) break;
            if (!finalImages.includes(gv.avatarImage)) {
               finalImages.push(gv.avatarImage);
               log(`[Media] Thêm ảnh avatar của ${gv.sku} vào thư viện do thiếu ảnh Drive.`);
            }
          }
        }
      }
    } catch(e) {
      log(`[Media] Lỗi khi lấy ảnh nhóm dự phòng: ${e.message}`);
    }
  }

  let finalVideo = null;
  const videos = targetFolderIdToUse ? await getVideosInFolder(targetFolderIdToUse) : [];

  if (videos.length > 0) {
    const vid = videos[0];
    log(`[Video] \u0110ang t\u1EA3i video: ${vid.name}`);
    let downloadedVidPath = await downloadFileFromDrive(vid.id, vid.name);

    const stats = fs.statSync(downloadedVidPath);
    const sizeMB = stats.size / (1024 * 1024);
    let hasMusic = false;
    let musicPath = null;
    let targetMusicDir = path.join(process.cwd(), "music_library");
    if (!fs.existsSync(targetMusicDir)) targetMusicDir = path.join(process.cwd(), "backend", "music_library");
    if (fs.existsSync(targetMusicDir)) {
       const mp3Files = fs.readdirSync(targetMusicDir).filter(f => f.endsWith('.mp3'));
       if (mp3Files.length > 0) {
          const randomMp3 = mp3Files[Math.floor(Math.random() * mp3Files.length)];
          musicPath = path.join(targetMusicDir, randomMp3);
          hasMusic = true;
          log(`[Video] Đã chọn nhạc ngẫu nhiên: ${randomMp3}`);
       }
    }

    let duration = 0;
    try {
      duration = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(downloadedVidPath, (err, metadata) => {
          if (err) return reject(err);
          resolve(metadata?.format?.duration || 0);
        });
      });
    } catch (e) {
      log(`[Video] Không lấy được thời lượng video: ${e.message}`);
    }

    if (sizeMB > 30 || hasMusic || (duration > 0 && duration < 10) || duration >= 60) {
      log(`[Video] Xử lý video (Nén/Lồng nhạc/Cắt/Làm chậm)...`);
      const compressedPath = path.join(os.tmpdir(), `processed_${Date.now()}.mp4`);
      await new Promise((resolve, reject) => {
        let command = ffmpeg(downloadedVidPath);
        if (hasMusic) command = command.input(musicPath);

        let outputOpts = ["-preset fast", "-crf 28", "-pix_fmt yuv420p"];

        if (duration > 0 && duration < 10) {
           const factor = (10.1 / duration).toFixed(4);
           outputOpts.push("-filter:v", `setpts=${factor}*PTS`);
           log(`[Video] Video quá ngắn (${duration.toFixed(1)}s), làm chậm x${(1/factor).toFixed(2)} để đạt 10s`);
        }
        
        if (duration >= 60) {
           command = command.duration(59.5);
           log(`[Video] Video quá dài (${duration.toFixed(1)}s), cắt ngắn xuống 59s`);
        }

        if (hasMusic) {
           outputOpts.push("-map 0:v:0", "-map 1:a:0", "-shortest");
        }
        
        command.videoCodec("libx264").audioCodec("aac").outputOptions(outputOpts).save(compressedPath).on("end", () => {
          finalVideo = compressedPath;
          log(`[Video] Đã xử lý xong video thành công.`);
          resolve(true);
        }).on("error", (err) => {
          reject(err);
        });
      });
    } else {
      finalVideo = downloadedVidPath;
    }
  }

  log(`[Ho\xE0n t\u1EA5t Media] T\xECm th\u1EA5y ${finalImages.length} \u1EA3nh v\xE0 ${finalVideo ? "c\xF3" : "kh\xF4ng c\xF3"} video.`);
  return { images: finalImages, video: finalVideo };
}
const zenwatchCache = /* @__PURE__ */ new Map();
async function getProductGender(variant) {
  const skuUpper = (variant.sku || "").toUpperCase();
  const modelUpper = (variant.model?.name || "").toUpperCase();
  const endsWithL = /L\b|L\d*$/i;
  if (endsWithL.test(skuUpper) || endsWithL.test(modelUpper)) {
    return "N\u1EEF";
  }
  try {
    const specs = await scrapeZenwatchData(variant.sku);
    if (specs && specs.gender) {
      if (specs.gender.toLowerCase().includes("n\u1EEF") || specs.gender.toLowerCase().includes("female")) {
        return "N\u1EEF";
      }
      if (specs.gender.toLowerCase().includes("nam") || specs.gender.toLowerCase().includes("male")) {
        return "Nam";
      }
    }
  } catch (e) {
    console.error("[Gender Detect] L\u1ED7i c\xE0o gi\u1EDBi t\xEDnh t\u1EEB Zenwatch:", e);
  }
  return "Nam";
}
async function scrapeZenwatchData(modelCode) {
  const cacheKey = modelCode.split("-")[0].trim().toUpperCase();
  if (zenwatchCache.has(cacheKey)) {
    console.log(`[Scraper Cache] S\u1EED d\u1EE5ng th\xF4ng s\u1ED1 cached cho: ${cacheKey}`);
    return zenwatchCache.get(cacheKey);
  }

  let browser;
  try {
    let searchCode = modelCode.split("-")[0].trim();
    if (modelCode.toUpperCase().includes("-T")) searchCode += " T";
    else if (modelCode.toUpperCase().includes("-D")) searchCode += " D";
    else if (modelCode.toUpperCase().includes("-S")) searchCode += " S";
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Attempt 1: Full search code
    await page.goto(`https://zenwatch.vn/?s=${searchCode}&post_type=product`, { waitUntil: "domcontentloaded", timeout: 15e3 });
    await page.waitForTimeout(2e3);
    let linkHrefs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a")).map((a) => a.href).filter((h) => h.includes("/product/"));
    });

    // Attempt 2: Remove suffix letter
    if (linkHrefs.length === 0 && searchCode.includes(' ')) {
       const baseCode = searchCode.split(' ')[0];
       console.log(`[Scraper] Không tìm thấy ${searchCode}, thử tìm bằng mã không hậu tố: ${baseCode}`);
       await page.goto(`https://zenwatch.vn/?s=${baseCode}&post_type=product`, { waitUntil: "domcontentloaded", timeout: 15e3 });
       await page.waitForTimeout(2e3);
       linkHrefs = await page.evaluate(() => {
         return Array.from(document.querySelectorAll("a")).map((a) => a.href).filter((h) => h.includes("/product/"));
       });
       searchCode = baseCode;
    }

    // Attempt 3: Remove trailing digit
    if (linkHrefs.length === 0) {
       if (/\d$/.test(searchCode)) {
           const fallbackBase = searchCode.slice(0, -1);
           console.log(`[Scraper] Không tìm thấy ${searchCode}, thử tìm bằng mã rút gọn: ${fallbackBase}`);
           await page.goto(`https://zenwatch.vn/?s=${fallbackBase}&post_type=product`, { waitUntil: "domcontentloaded", timeout: 15e3 });
           await page.waitForTimeout(2e3);
           linkHrefs = await page.evaluate(() => {
             return Array.from(document.querySelectorAll("a")).map((a) => a.href).filter((h) => h.includes("/product/"));
           });
           searchCode = fallbackBase;
       }
    }

    if (linkHrefs.length > 0) {
      let targetLink = linkHrefs[0];
      const targetSlugFragment = searchCode.replace(/\\s+/g, '-').toLowerCase();
      const exactMatch = linkHrefs.find(h => h.toLowerCase().includes(targetSlugFragment));
      if (exactMatch) targetLink = exactMatch;

      await page.goto(targetLink, { waitUntil: "domcontentloaded", timeout: 15e3 });
      const specs = await page.evaluate(() => {
        const data = {};
        const rows = Array.from(document.querySelectorAll("tr, .row"));
        rows.forEach((row) => {
          const text = row.textContent || "";
          if (text.toLowerCase().includes("ch\u1ED1ng n\u01B0\u1EDBc") || text.toLowerCase().includes("ch\u1ECBu n\u01B0\u1EDBc")) data.waterproof = text.split(/[:\n]/).pop()?.trim();
          if (text.toLowerCase().includes("\u0111\u01B0\u1EDDng k\xEDnh")) data.diameter = text.split(/[:\n]/).pop()?.trim();
          if (text.toLowerCase().includes("gi\u1EDBi t\xEDnh")) data.gender = text.split(/[:\n]/).pop()?.trim();
          if (text.toLowerCase().includes("ki\u1EC3u m\xE1y")) data.movement = text.split(/[:\n]/).pop()?.trim();
          if (text.toLowerCase().includes("\u0111\u1ED9 d\xE0y")) data.thickness = text.split(/[:\n]/).pop()?.trim();
        });
        if (!data.diameter || !data.waterproof || !data.gender || !data.movement || !data.thickness) {
          const pTags = Array.from(document.querySelectorAll(".tab-panels p, #tab-description p, .product-main p, article p"));
          pTags.forEach((p) => {
            let html = p.innerHTML;
            html = html.replace(/<br\s*[\/]?>/gi, "\n");
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = html;
            const textContent = tempDiv.innerText || tempDiv.textContent || "";
            const lines = textContent.split("\n");
            lines.forEach((line) => {
              const text = line.trim();
              if (text.toLowerCase().includes("ch\u1ED1ng n\u01B0\u1EDBc") || text.toLowerCase().includes("ch\u1ECBu n\u01B0\u1EDBc")) {
                data.waterproof = text.split(/[:\n]/).pop()?.trim();
              }
              if (text.toLowerCase().includes("\u0111\u01B0\u1EDDng k\xEDnh")) {
                data.diameter = text.split(/[:\n]/).pop()?.trim();
              }
              if (text.toLowerCase().includes("gi\u1EDBi t\xEDnh")) {
                data.gender = text.split(/[:\n]/).pop()?.trim();
              }
              if (text.toLowerCase().includes("ki\u1EC3u m\xE1y")) {
                data.movement = text.split(/[:\n]/).pop()?.trim();
              }
              if (text.toLowerCase().includes("\u0111\u1ED9 d\xE0y")) {
                data.thickness = text.split(/[:\n]/).pop()?.trim();
              }
            });
          });
        }
        return data;
      });
      let wp = specs.waterproof || "";
      let dia = specs.diameter?.match(/\d+/)?.[0];
      if (dia) dia = dia + "mm";
      else dia = "";
      const result = {
        waterproof: wp,
        diameter: dia,
        gender: specs.gender || "",
        movement: specs.movement || "",
        thickness: specs.thickness || ""
      };
      zenwatchCache.set(cacheKey, result);
      return result;
    }
  } catch (e) {
    console.error("[Scraper] L\u1ED7i c\xE0o zenwatch:", e);
  } finally {
    if (browser) await browser.close();
  }
  const defaultResult = { waterproof: "", diameter: "", gender: "", movement: "", thickness: "" };
  zenwatchCache.set(cacheKey, defaultResult);
  return defaultResult;
}
async function generateShopeeProductName(variantId, customModelName) {
  try {
    let variant = await prisma.variant.findUnique({ where: { id: variantId }, include: { model: true } });
    if (!variant) throw new Error("Variant not found");
    let targetModelName = customModelName || variant.model.name;
    const gender = await getProductGender(variant);
    const isFemale = gender === "N\u1EEF";
    const watchGenderText = isFemale ? "N\u1EEF" : "Nam";
    const suffixLetter = isFemale ? "L" : "G";
    let images = [];
    if (variant.avatarImage && fs.existsSync(variant.avatarImage)) {
      images.push({
        data: fs.readFileSync(variant.avatarImage).toString("base64"),
        mimeType: "image/jpeg"
      });
    }

    const skuSuffix = variant.sku.split('-')[1] || "";
    let strapPromptText = "[Chất liệu dây]";
    if (skuSuffix.includes('T')) strapPromptText = "Dây Thép";
    else if (skuSuffix.includes('D')) strapPromptText = "Dây Da";
    else if (skuSuffix.includes('S')) strapPromptText = "Dây Cao Su";

    const zenSpecs = await scrapeZenwatchData(variant.sku);
    let movementPromptText = "";
    if (zenSpecs?.movement) {
       const mLower = zenSpecs.movement.toLowerCase();
       if (mLower.includes("cơ") || mLower.includes("automatic")) movementPromptText = ", Máy Cơ";
       else if (mLower.includes("pin") || mLower.includes("quartz")) movementPromptText = ", Máy Pin";
    }

    const prompt = `Từ mã đồng hồ "${targetModelName}", hãy tạo 1 câu đặt tên sản phẩm đồng hồ chuẩn SEO cho Shopee (Tối đa 99 ký tự). 
    Bắt buộc phải tuân theo đúng định dạng sau:
    Đồng Hồ ${watchGenderText} I&W Carnival ${targetModelName} Chính Hãng - [Vàng Hồng/Vàng (nếu có)]${movementPromptText}, [Viền (nếu có)], ${strapPromptText}, Kính Sapphire, BH 5 Năm
    
    QUY TẮC BẮT BUỘC (NẾU LÀM SAI SẼ BỊ PHẠT):
    1. "Vàng Hồng" hoặc "Vàng": Nếu trong ảnh thấy viền/vỏ/dây có màu vàng hồng (rose gold) thì ghi "Vàng Hồng". Nếu vàng thuần thì ghi "Vàng". Nếu thuần thép/bạc thì BỎ QUA hoàn toàn chữ vàng.
    2. QUY ĐỊNH VỀ VIỀN:
       - Nếu mã sản phẩm có chứa "G1" (hoặc L1) -> BẮT BUỘC GHI LÀ "Viền Trơn".
       - Nếu mã sản phẩm có chứa "G2" (hoặc L2) -> BẮT BUỘC GHI LÀ "Viền Đá".
       - Nếu mã sản phẩm chỉ có chữ "G" hoặc "L" (không có số 1,2,3): Hãy tự nhìn ảnh. Nếu có đính đá thì ghi "Viền Đá". NẾU VIỀN TRƠN THÌ BỎ QUA KHÔNG GHI CHỮ GÌ CẢ.
    3. QUY ĐỊNH MÀU MẶT VÀ MÀU DÂY: TUYỆT ĐỐI KHÔNG mô tả màu mặt (vd không ghi Mặt Trắng, Mặt Đen). TUYỆT ĐỐI KHÔNG mô tả màu dây (vd không ghi Dây Đen, Dây Xanh).
    
    Ví dụ đúng (thuần thép, G1 viền trơn):
    Đồng Hồ ${watchGenderText} I&W Carnival ${targetModelName} Chính Hãng - ${movementPromptText ? movementPromptText.replace(', ', '') + ', ' : ""}Viền Trơn, ${strapPromptText}, Kính Sapphire, BH 5 Năm
    
    Ví dụ đúng (vàng hồng, G chỉ có viền trơn nên bị bỏ qua):
    Đồng Hồ ${watchGenderText} I&W Carnival ${targetModelName} Chính Hãng - Vàng Hồng${movementPromptText}, ${strapPromptText}, Kính Sapphire, BH 5 Năm
    
    Tuyệt đối không thêm hashtag, không viết dông dài. Chỉ trả về 1 dòng duy nhất.`;
    let generatedName = await callAIWithRotation(prompt, images);
    if (generatedName) {
      generatedName = generatedName.replace(/Xanh Lam/gi, "Xanh Bi\u1EC3n").replace(/Xanh ngọc/gi, "Xanh Tiffany").replace(/Xanh Mint/gi, "Xanh Tiffany").replace(/xanh lam/gi, "xanh bi\u1EC3n").replace(/xanh ngọc/gi, "xanh Tiffany").replace(/xanh mint/gi, "xanh Tiffany").replace(/Màu bạc/gi, "M\xE0u x\xE1m").replace(/Mặt bạc/gi, "M\u1EB7t x\xE1m").replace(/màu bạc/gi, "m\xE0u x\xE1m").replace(/mặt bạc/gi, "m\u1EB7t x\xE1m").replace(/Màu Trắng Bạc/gi, "M\xE0u Tr\u1EAFng").replace(/Mặt Trắng Bạc/gi, "M\u1EB7t Tr\u1EAFng").replace(/Mặt Màu Trắng Bạc/gi, "M\u1EB7t M\xE0u Tr\u1EAFng").replace(/màu trắng bạc/gi, "m\xE0u tr\u1EAFng").replace(/mặt trắng bạc/gi, "m\u1EB7t tr\u1EAFng").replace(/-\s*Pin/gi, "- M\xE1y Pin").replace(/,\s*Pin/gi, ", M\xE1y Pin").replace(/-\s*Cơ/gi, "- M\xE1y C\u01A1").replace(/,\s*Cơ/gi, ", M\xE1y C\u01A1").replace(/Máy\s+Máy\s+Pin/gi, "M\xE1y Pin").replace(/Máy\s+Máy\s+Cơ/gi, "M\xE1y C\u01A1").replace(/,\s*Sapphire/gi, ", K\xEDnh Sapphire").replace(/Kính\s+Kính\s+Sapphire/gi, "K\xEDnh Sapphire");
      const adjectives = [
        "l\u1EA5p l\xE1nh",
        "c\xE1 t\xEDnh",
        "sang tr\u1ECDng",
        "th\u1EDDi trang",
        "hi\u1EC7n \u0111\u1EA1i",
        "qu\xFD ph\xE1i",
        "quy\u1EBFn r\u0169",
        "\u0111\u1ED9c \u0111\xE1o",
        "\u1EA5n t\u01B0\u1EE3ng",
        "tinh tế",
        "cuốn hút",
        "nổi bật",
        "trẻ trung",
        "đẳng cấp",
        "phong cách"
      ];
      for (const adj of adjectives) {
        const regex = new RegExp(`\\s+${adj}\\b`, "gi");
        generatedName = generatedName.replace(regex, "");
      }
      generatedName = generatedName.replace(/Mặt\s+(?!Màu\s+)(Xanh Biển|Xanh Tiffany|Xám|Đỏ|Đen|Trắng|Hồng|Vàng|Xanh Đen|Xanh Lá|Tím|Nâu|Bạc|Vàng Hồng|Khói|Xanh|Ghi)/gi, "M\u1EB7t M\xE0u $1");
      for (const plating of ["Vàng Hồng", "Vàng"]) {
        const misplacedRegex = new RegExp(`,?\\s*${plating}\\s*,?`, "i");
        if (misplacedRegex.test(generatedName) && generatedName.includes(" - ")) {
          const dashIdx = generatedName.indexOf(" - ");
          const afterDash = generatedName.substring(dashIdx + 3);
          const beforeDash = generatedName.substring(0, dashIdx).replace(misplacedRegex, "").trim();

          if (!afterDash.trim().toLowerCase().startsWith(plating.toLowerCase())) {
            const cleanedAfter = afterDash.replace(misplacedRegex, "").replace(/^,\s*/, "").replace(/,\s*,/g, ",").trim();
            generatedName = `${beforeDash} - ${plating}, ${cleanedAfter}`;
          }
          break;
        }
      }
      if (generatedName && generatedName.length > 99) {
        // Tự động xoá Kính Sapphire hoặc BH 5 Năm nếu quá dài
        const sapphireRegex = /,\s*Kính\s+Sapph?ire/i;
        if (sapphireRegex.test(generatedName)) {
          const temp = generatedName.replace(sapphireRegex, "");
          generatedName = temp;
        }

        if (generatedName.length > 99) {
          const warrantyText = /,\s*BH\s+[\d\s]+Năm/i;
          if (warrantyText.test(generatedName)) {
            generatedName = generatedName.replace(warrantyText, "");
          }
        }

        // Cắt cụt triệt để nếu vẫn quá dài (phòng hờ)
        if (generatedName.length > 99) {
          generatedName = generatedName.substring(0, 99).trim().replace(/,$/, "");
        }
      }
    }
    const fallbackName = `Đồng Hồ ${watchGenderText} I&W Carnival ${targetModelName} Chính Hãng - Kính Sapphire, BH 5 Năm`;
    if (!generatedName) {
      return fallbackName;
    }
    return generatedName;
  } catch (error) {
    console.error("Error generating Shopee name:", error.message);
    const targetModelNameFallback = customModelName || "I&W";
    return `Đồng Hồ I&W Carnival ${targetModelNameFallback} Chính Hãng - Kính Sapphire, BH 5 Năm`;
  }
}

async function generateShopeeProductDescription(sku, productName, zenSpecs, avatarImagePath) {
  try {
    const aiIntro = await _generateDescriptionAI(sku, productName, zenSpecs, avatarImagePath);

    let displayGender = "Đang cập nhật";
    let isFemale = false;
    if (zenSpecs?.gender) {
      displayGender = zenSpecs.gender;
      isFemale = displayGender.toLowerCase().includes('nữ');
    } else {
      if (sku.toUpperCase().includes('L')) {
        displayGender = "Nữ";
        isFemale = true;
      } else if (sku.toUpperCase().includes('G')) {
        displayGender = "Nam";
      }
    }

    // Fallback if AI fails
    const introText = aiIntro || (isFemale
      ? `${productName} – Chiếc đồng hồ mang đậm phong thái thanh lịch dành cho quý cô yêu thích sự tinh tế và duyên dáng. Thiết kế nữ tính và sang trọng, phù hợp từ công sở đến những buổi tiệc trang trọng. Thanh lịch – Duyên dáng – Chuẩn phong thái.`
      : `${productName} – Chiếc đồng hồ mang đậm phong thái lịch lãm dành cho quý ông yêu thích sự tinh tế và chỉn chu. Thiết kế nam tính và sang trọng, phù hợp từ công sở đến những buổi tiệc trang trọng. Lịch lãm – Tinh tế – Chuẩn phong thái.`);

    let dayText = "Đang cập nhật";
    let voText = "Thép không gỉ 316L (Mạ PVD cao cấp với phiên bản màu vàng)"; // Vỏ luôn fix cứng như vầy theo ý user
    const skuSuffix = sku.split('-')[1] || "";
    if (skuSuffix.includes('T')) {
       dayText = "Thép không gỉ 316L (Mạ PVD cao cấp với phiên bản màu vàng)";
    } else if (skuSuffix.includes('D')) {
       dayText = "Dây da cao cấp";
    } else if (skuSuffix.includes('S')) {
       dayText = "Dây cao su cao cấp";
    }

    let displayMovement = "Đang cập nhật";
    if (zenSpecs?.movement) {
        const mLower = zenSpecs.movement.toLowerCase();
        if (mLower.includes("cơ") || mLower.includes("automatic")) displayMovement = "Máy cơ Automatic";
        else if (mLower.includes("pin") || mLower.includes("quartz") || mLower.includes("quarzt")) displayMovement = "Máy Pin / Quartz";
        else displayMovement = zenSpecs.movement;
    }

    let displayWaterproof = "30M - 50M";
    if (zenSpecs?.waterproof) {
        displayWaterproof = zenSpecs.waterproof;
    }

    const modelCode = sku.split('-')[0];

    const specsText = `THÔNG TIN CHI TIẾT:
Thương hiệu: I&W Carnival
Mã sản phẩm: ${modelCode}
Giới tính: ${displayGender}
Kiểu máy: ${displayMovement}
Đường kính mặt: ${zenSpecs?.diameter || "Đang cập nhật"}
Độ dày: ${zenSpecs?.thickness || "Đang cập nhật"}
Chất liệu vỏ: ${voText}
Chất liệu dây: ${dayText}
Mặt kính: Sapphire Crystal
Độ chịu nước: ${displayWaterproof}
Bảo hành: 5 năm`;

    const policyText = `CHÍNH SÁCH BẢO HÀNH:
Thời gian bảo hành: 5 năm
Miễn phí thay pin trọn đời với đồng hồ pin
Miễn phí điều chỉnh nhanh chậm đối với đồng hồ cơ
Miễn phí xử lý khi đồng hồ bị vào nước

CAM KẾT:
✔ Hàng chính hãng 100%
✔ Kiểm tra kỹ trước khi giao
✔ Đóng gói cẩn thận, hỗ trợ đổi trả theo quy định Shopee
✔ Hỗ trợ tư vấn nhanh chóng trước và sau mua hàng`;

    let genderFallback = "nam";
    if (sku.toUpperCase().includes('L')) genderFallback = "nu";
    if (zenSpecs?.gender && zenSpecs.gender.toLowerCase().includes('nữ')) genderFallback = "nu";

    let hashtagText = `#donghonam #donghonamchinhhang #donghochinhhangnam #donghonamdayda #donghonamdaythep #donghonamdaycaosu #donghonamco #donghonamchongnuoc #iwcarnival #donghocarnival #donghoiw #donghoiwcarnival #donghocarnivalnam #donghocarnival1986`;
    if (genderFallback === "nu") {
        hashtagText = hashtagText.replace(/nam/g, 'nu');
    }

    return `${introText}\n\n${specsText}\n\n${policyText}\n\n${hashtagText}`;
  } catch (error) {
    console.error("Error generating description:", error.message);
    return null;
  }
}

async function _generateDescriptionAI(sku, productName, zenSpecs, avatarImagePath) {
  if (!avatarImagePath || !fs.existsSync(avatarImagePath)) {
    return null;
  }

  const prompt = `Bạn là một chuyên gia viết mô tả sản phẩm đồng hồ chuẩn SEO cho Shopee.
Dựa vào hình ảnh đồng hồ (ảnh Avatar) và các thông tin sau:
- Tên sản phẩm: ${productName}
- Mã sản phẩm (SKU): ${sku}
- Thông số kỹ thuật (Tham khảo): ${JSON.stringify(zenSpecs || {})}

Hãy phân tích hình ảnh và viết một đoạn văn (khoảng 2 đoạn ngắn) giới thiệu sản phẩm thật hấp dẫn, tương tự phong cách của đoạn mẫu dưới đây:

--- BẢN MẪU THAM KHẢO ---
I&W Carnival 525G – Chiếc đồng hồ nam chính hãng mang đậm phong thái lịch lãm dành cho quý ông yêu thích sự tinh tế và chỉn chu. Thiết kế mặt trắng thanh thoát kết hợp vỏ vàng hồng sang trọng, cọc số La Mã cổ điển và dây da đen cao cấp tạo nên vẻ ngoài nổi bật nhưng vẫn rất dễ phối đồ.

Điểm nhấn open-heart ở vị trí 6 giờ để lộ chuyển động cơ khí đầy cuốn hút, thể hiện vẻ đẹp tinh xảo của bộ máy Automatic bền bỉ từ Seiko – Miyota Nhật Bản. Từng đường nét được hoàn thiện cân đối, nam tính và sang trọng, phù hợp từ công sở, gặp gỡ đối tác đến những buổi tiệc trang trọng. Lịch lãm – Tinh tế – Chuẩn phong thái quý ông.
------------------------

CHÚ Ý QUAN TRỌNG:
1. CHỈ TRẢ VỀ phần đoạn văn giới thiệu (viết liền hoặc chia tối đa 2 đoạn). Tuyệt đối KHÔNG sinh ra các phần như "THÔNG TIN CHI TIẾT", "CHÍNH SÁCH", hay hashtag (tôi sẽ tự ghép vào sau).
2. Tên đồng hồ bắt đầu nên dùng tên từ "${productName}" hoặc một phần của nó.
3. Chỉ miêu tả những chi tiết thực sự thấy trong ảnh (Màu mặt, màu viền, loại dây, kim, cọc số...). Đừng tự bịa ra tính năng (ví dụ: open-heart) nếu trong ảnh không có!
4. Giữ giọng văn sang trọng, tinh tế.`;

  try {
    const avatarData = fs.readFileSync(avatarImagePath);
    const mimeType = avatarImagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const imagePart = {
      data: avatarData.toString("base64"),
      mimeType: mimeType
    };

    const result = await callAIWithRotation(prompt, [imagePart]);
    if (result) {
      // Dọn dẹp nếu AI lỡ sinh ra THÔNG TIN CHI TIẾT
      let cleanResult = result.replace(/THÔNG TIN CHI TIẾT.*|CHÍNH SÁCH BẢO HÀNH.*|CAM KẾT.*/is, "").trim();
      return cleanResult;
    }
  } catch (error) {
    console.error("AI Description Error:", error.message);
  }
  return null;
}

async function runShopeeAutomationDemo(cookiesString, productName, shopeeProductId, media, variantId, onProgress) {
  const log = (msg) => {
    console.log(msg);
    try {
      fs.appendFileSync(path.join(process.cwd(), "shopee_debug.txt"), msg + "");
    } catch (e) {
    }
    if (onProgress) onProgress(msg);
  };
  const currentVariant = await prisma.variant.findUnique({
    where: { id: variantId },
    include: { model: true }
  });
  if (!currentVariant) throw new Error("Kh\xF4ng t\xECm th\u1EA5y bi\u1EBFn th\u1EC3 trong DB");
  const sku = currentVariant.sku;
  const cookies = JSON.parse(cookiesString);
  let allVariants = [];
  log(`[Browser] \u0110ang kh\u1EDFi \u0111\u1ED9ng Playwright (Chrome)...`);
  let browser = null;
  browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"]
  });
  const context = await browser.newContext({ viewport: null });
  const playwrightCookies = cookies.map((c) => {
    let sameSite = "Lax";
    const s = (c.sameSite || "").toLowerCase();
    if (s === "strict") sameSite = "Strict";
    else if (s === "none") sameSite = "None";
    else sameSite = "Lax";
    return {
      name: c.name,
      value: c.value,
      domain: c.domain.startsWith(".") ? c.domain : `.${c.domain}`,
      path: c.path || "/",
      expires: c.expires || -1,
      httpOnly: c.httpOnly || false,
      secure: c.secure || false,
      sameSite
    };
  });
  await context.addCookies(playwrightCookies);
  let page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.text().includes("[Browser]")) {
      log(msg.text());
    }
  });
  log("[Browser] Pre-fetch d\u1EEF li\u1EC7u Zenwatch tr\u01B0\u1EDBc khi m\u1EDF Shopee...");
  let preZenSpecs = null;
  try {
    preZenSpecs = await scrapeZenwatchData(currentVariant.sku);
  } catch (e) {
    log("[Zenwatch] Lỗi pre-fetch: " + e.message);
  }

  log("[Browser] Đang tạo Mô tả sản phẩm bằng AI...");
  const avatarPath = media?.images && media.images.length > 0 ? media.images[0] : null;
  const productDescription = await generateShopeeProductDescription(sku, productName, preZenSpecs, avatarPath);
  log("[Browser] Đã tạo xong Mô tả sản phẩm!");
  log(`[Browser] \u0110ang chu\u1EA9n b\u1ECB tr\xECnh duy\u1EC7t cho ID: ${shopeeProductId || "T\u1EA0O M\u1EDAI"}`);
  try {
    let isNewProduct = false;
    const cleanId = (shopeeProductId || "").trim();
    if (!cleanId || cleanId === "" || cleanId.toLowerCase() === "id" || !/^\d+$/.test(cleanId)) {
      isNewProduct = true;
      log(`[Browser] Shopee ID kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c tr\u1ED1ng (ID hi\u1EC7n t\u1EA1i: "${shopeeProductId}"), b\u1EAFt \u0111\u1EA7u quy tr\xECnh t\u1EA1o s\u1EA3n ph\u1EA9m m\u1EDBi...`);
      await page.goto("https://banhang.shopee.vn/portal/product/list/all", { waitUntil: "load", timeout: 9e4 });
      await page.waitForTimeout(3e3);
      log(`[Browser] URL Hi\u1EC7n T\u1EA1i: ${page.url()} | Ti\xEAu \u0110\u1EC1: ${await page.title()}`);
      log(`[Browser] \u0110ang ki\u1EC3m tra v\xE0 \u0111\xF3ng c\xE1c popup h\u01B0\u1EDBng d\u1EABn c\u1EE7a Shopee...`);
      try {
        const checkNowBtn = page.locator("button").filter({ hasText: /Check Now|Kiểm tra ngay/i }).first();
        if (await checkNowBtn.isVisible({ timeout: 2e3 }).catch(() => false)) {
          await checkNowBtn.click();
          await page.waitForTimeout(1e3);
        }
        for (let i = 0; i < 3; i++) {
          const skipBtn = page.locator("button").filter({ hasText: /^Bỏ qua$|^Skip$/i }).first();
          if (await skipBtn.isVisible({ timeout: 1e3 }).catch(() => false)) {
            await skipBtn.click();
            await page.waitForTimeout(500);
          }
        }
      } catch (e) {
      }
      log(`[Browser] \u0110ang click n\xFAt Th\xEAm 1 s\u1EA3n ph\u1EA9m m\u1EDBi...`);
      const addBtn = page.locator('#top-add-new-product-btn, button:has-text("Th\xEAm 1 s\u1EA3n ph\u1EA9m m\u1EDBi")').first();
      await addBtn.waitFor({ state: "visible", timeout: 15e3 });
      const [newPage] = await Promise.all([
        context.waitForEvent("page"),
        addBtn.click()
      ]);
      page = newPage;
      page.on("console", (msg) => {
        if (msg.text().includes("[Browser]")) {
          log(msg.text());
        }
      });
      try {
        await page.waitForURL("**/portal/product/new**", { timeout: 2e4 });
      } catch (_) {
        await page.waitForLoadState("domcontentloaded", { timeout: 15e3 });
      }
      await page.waitForTimeout(3e3);
      log(`[Browser] \u0110\xE3 v\xE0o trang Th\xEAm s\u1EA3n ph\u1EA9m m\u1EDBi. URL: ${page.url()} | Ti\xEAu \u0110\u1EC1: ${await page.title()}`);
    } else {
      await page.goto(`https://banhang.shopee.vn/portal/product/${shopeeProductId}`, { waitUntil: "load", timeout: 9e4 });
      await page.waitForTimeout(8e3);
      log(`[Browser] \u0110\xE3 v\xE0o trang S\u1EEDa s\u1EA3n ph\u1EA9m. URL: ${page.url()} | Ti\xEAu \u0110\u1EC1: ${await page.title()}`);
    }
    if (!isNewProduct) {
      log("[Browser] \u0110ang d\xF2 t\xECm v\xE0 x\xF3a to\xE0n b\u1ED9 \u1EA3nh/video c\u0169...");
      try {
        let basicInfoPanel = page.locator('input[type="file"]').first().locator('xpath=./ancestor::*[contains(@class, "panel-container") or contains(@class, "section") or contains(@class, "product-edit")][1]');
        if (await basicInfoPanel.count() === 0) {
          basicInfoPanel = page.locator(':text("H\xECnh \u1EA3nh s\u1EA3n ph\u1EA9m")').locator('xpath=./ancestor::*[contains(@class, "panel-container") or contains(@class, "section") or contains(@class, "basic-info")][1]');
        }
        let deletedAny = true;
        for (let i = 0; i < 20 && deletedAny; i++) {
          deletedAny = false;
          const imgs = await basicInfoPanel.locator('.shopee-image-manager__item, [class*="image-manager__item"], .eds-upload__item, [class*="ratio-box"], [class*="upload-wrapper"], [class*="image-item"]').all();
          for (const img of imgs.reverse()) {
            if (await img.isVisible()) {
              try {
                await img.hover();
                await page.waitForTimeout(800);
                const deleteIcons = await img.locator('svg, i, button, [class*="delete"], [class*="remove"], [class*="trash"], [class*="close"]').all();
                let clicked = false;
                for (const icon of deleteIcons) {
                  const className = await icon.getAttribute("class") || "";
                  const title = await icon.getAttribute("title") || "";
                  if (className.toLowerCase().includes("delete") || className.toLowerCase().includes("remove") || className.toLowerCase().includes("trash") || className.toLowerCase().includes("close") || title.toLowerCase().includes("x\xF3a")) {
                    if (await icon.isVisible()) {
                      await icon.click({ force: true });
                      clicked = true;
                      break;
                    }
                  }
                }
                if (clicked) {
                  await page.waitForTimeout(1e3);
                  deletedAny = true;
                  break;
                }
              } catch (e) {
              }
            }
          }
        }
        const videoLabel = basicInfoPanel.locator("label, div, span").filter({ hasText: /video sản phẩm|product video/i }).first();
        if (await videoLabel.isVisible()) {
          let videoSection = videoLabel.locator("..");
          for (let i = 0; i < 3; i++) {
            if (await videoSection.locator("..").isVisible()) {
              videoSection = videoSection.locator("..");
            }
          }
          const hasVideoMedia = await videoSection.locator("video, img").count() > 0;
          const vStyle = await videoSection.getAttribute("style") || "";
          const hasVideoBg = vStyle.toLowerCase().includes("url(") || vStyle.toLowerCase().includes("background-image");
          if (hasVideoMedia || hasVideoBg) {
            await videoSection.hover();
            await page.waitForTimeout(500);
            const svgs = await videoSection.locator('svg, i, [class*="delete"]').all();
            if (svgs.length > 0) {
              try {
                await svgs[svgs.length - 1].click({ force: true });
                await page.waitForTimeout(500);
              } catch (e) {
              }
            }
          }
        }
      } catch (e) {
        log("[Browser] L\u1ED7i khi x\xF3a \u1EA3nh c\u0169: " + e.message);
      }
      await new Promise((r) => setTimeout(r, 2e3));
    }
    try {
      log("[Browser] Đang upload ảnh và video mới lên Thông tin cơ bản...");
      
      // Lấy tất cả các thẻ input file trên trang
      // Thông thường:
      // index 0: Ảnh sản phẩm (cho phép multiple)
      // index 1: Video sản phẩm
      const fileInputs = await page.locator('input[type="file"]').all();

      if (fileInputs.length > 0 && media.images.length > 0) {
        log(`[Browser] Upload ${media.images.length} ảnh chính...`);
        await fileInputs[0].setInputFiles(media.images);
        await page.waitForTimeout(5000);
      } else {
        log("[Browser] Cảnh báo: Không tìm thấy ô upload ảnh chính (hoặc không có ảnh).");
      }

      log("[Browser] Đang tìm ô Upload Video...");
      const videoInput = page.locator('input[type="file"][accept*="video"]').first();
      await videoInput.waitFor({ state: "attached", timeout: 8000 }).catch(() => {});
      
      if (await videoInput.count() > 0 && media.video) {
        log("[Browser] Upload Video sản phẩm...");
        try {
          // Thử ưu tiên dùng fileChooser vì Shopee React đôi khi chặn setInputFiles trực tiếp
          const videoArea = page.locator('.eds-upload-wrapper, .video-upload, :text("Thêm video")').filter({ hasText: /Thêm video/i }).first();
          if (await videoArea.isVisible().catch(() => false)) {
            log("[Browser] Tìm thấy nút Thêm video, dùng FileChooser...");
            const [fileChooser] = await Promise.all([
              page.waitForEvent("filechooser", { timeout: 5000 }),
              videoArea.click({ force: true })
            ]);
            await fileChooser.setFiles(media.video);
          } else {
            log("[Browser] Không thấy nút click, fallback setInputFiles...");
            await videoInput.setInputFiles(media.video);
          }
          await page.waitForTimeout(5000);
          
          const confirmBtns = await page.locator("button").filter({ hasText: /Xác nhận|Confirm|Đồng ý/i }).all();
          for (const btn of confirmBtns) {
            if (await btn.isVisible()) {
              await btn.click({ force: true });
              await page.waitForTimeout(1000);
            }
          }
        } catch (e) {
          log("[Browser] Lỗi upload video: " + e.message);
          // Fallback cuối cùng
          try {
             await videoInput.setInputFiles(media.video);
             await page.waitForTimeout(5000);
          } catch(err) {
             log("[Browser] Lỗi fallback upload video: " + err.message);
          }
        }
      } else if (media.video) {
        log("[Browser] Cảnh báo: Có video nhưng không tìm thấy ô upload video (thiếu input accept='video/mp4').");
      }
    } catch (e) {
      log("[Browser] Lỗi quá trình upload media: " + e.message);
    }
    await page.waitForTimeout(2000);
    log("[Browser] \u0110ang \u0111i\u1EC1n T\xEAn s\u1EA3n ph\u1EA9m...");
    const nameInputLocator = page.locator('input[placeholder*="t\xEAn s\u1EA3n ph\u1EA9m"], input[placeholder*="T\xEAn s\u1EA3n ph\u1EA9m"], input[maxlength="120"], .product-edit-form-item input').first();
    await nameInputLocator.waitFor({ state: "visible", timeout: 1e4 }).catch(() => {
    });
    if (await nameInputLocator.isVisible({ timeout: 5e3 }).catch(() => false)) {
      await nameInputLocator.fill("");
      await nameInputLocator.fill(productName);
      await nameInputLocator.pressSequentially(" ", { delay: 50 });
      await page.waitForTimeout(500);
      await nameInputLocator.press("Backspace");
      await page.waitForTimeout(2e3);
      log("[Browser] \u0110\xE3 \u0111i\u1EC1n xong t\xEAn s\u1EA3n ph\u1EA9m b\u1EB1ng Playwright!");
    } else {
      await page.evaluate((name) => {
        const inputs = Array.from(document.querySelectorAll("input, textarea"));
        const nameInput = inputs.find((i) => i.maxLength >= 100 || i.placeholder && i.placeholder.toLowerCase().includes("t\xEAn s\u1EA3n ph\u1EA9m"));
        if (nameInput) {
          nameInput.value = "";
          nameInput.value = name;
          nameInput.dispatchEvent(new Event("input", { bubbles: true }));
          nameInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, productName);
      log("[Browser] Đã điền xong tên sản phẩm (Fallback)!");
    }

    if (isNewProduct) {
      log("[Browser] \u0110ang ch\u1ECDn Ng\xE0nh h\xE0ng...");
      const isNu = productName.toLowerCase().includes("n\u1EEF");
      const targetCategoryText = isNu ? "\u0110\u1ED3ng h\u1ED3 n\u1EEF" : "\u0110\u1ED3ng h\u1ED3 nam";
      log(`[Browser] M\u1EE5c ti\xEAu Ng\xE0nh h\xE0ng: ${targetCategoryText}`);
      let recommendedClicked = false;
      try {
        log("[Browser] \u0110ang \u0111\u1EE3i 5 gi\xE2y \u0111\u1EC3 Shopee ph\xE2n t\xEDch t\xEAn v\xE0 \u0111\u01B0a ra G\u1EE3i \xFD ng\xE0nh h\xE0ng...");
        await page.waitForTimeout(5e3);
        const candidateLocators = page.locator('div, span, button, a, [class*="recommend"], [class*="item"]').filter({ hasText: /Đồng hồ/i });
        const count = await candidateLocators.count();
        log(`[Browser] T\xECm th\u1EA5y ${count} ph\u1EA7n t\u1EED ch\u1EE9a ch\u1EEF "\u0110\u1ED3ng h\u1ED3" trong danh s\xE1ch \u0111\u1EC1 xu\u1EA5t.`);
        for (let i = 0; i < count; i++) {
          const item = candidateLocators.nth(i);
          const text = (await item.textContent() || "").trim();
          const cleanText = text.replace(/\s+/g, " ").toLowerCase();
          if (cleanText.includes("\u0111\u1ED3ng h\u1ED3") && cleanText.includes(">") && cleanText.includes(targetCategoryText.toLowerCase())) {
            log(`[Browser] T\xECm th\u1EA5y g\u1EE3i \xFD kh\u1EDBp ho\xE0n h\u1EA3o: "${text}"! \u0110ang click ch\u1ECDn...`);
            await item.scrollIntoViewIfNeeded();
            await item.click({ force: true });
            recommendedClicked = true;
            log(`[Browser] \u0110\xE3 ch\u1ECDn th\xE0nh c\xF4ng Ng\xE0nh h\xE0ng g\u1EE3i \xFD: "${text}"`);
            await page.waitForTimeout(4e3);
            break;
          }
        }
      } catch (e) {
        log(`[Browser] L\u1ED7i khi qu\xE9t Ng\xE0nh h\xE0ng g\u1EE3i \xFD: ${e.message}`);
      }
      if (!recommendedClicked) {
        log("[Browser] Kh\xF4ng ch\u1ECDn \u0111\u01B0\u1EE3c t\u1EEB g\u1EE3i \xFD tr\u1EF1c ti\u1EBFp. Chuy\u1EC3n sang m\u1EDF modal ch\u1ECDn th\u1EE7 c\xF4ng...");
        try {
          const categoryBox = page.locator(".product-category-box-inner").first();
          await categoryBox.waitFor({ state: "visible", timeout: 15e3 });
          await categoryBox.click();
          await page.waitForSelector('.eds-modal__box, .category-selector-wrap, [role="dialog"]', { state: "visible", timeout: 1e4 });
          await page.waitForTimeout(1e3);
          log("[Browser] \u0110\xE3 m\u1EDF popup Ng\xE0nh h\xE0ng.");
          const searchBox = page.locator([
            ".category-search input",
            ".category-selector-wrap input",
            ".eds-modal__box input",
            'input[placeholder*="ng\xE0nh"]',
            'input[placeholder*="Ng\xE0nh"]',
            'input[placeholder*="t\xECm ki\u1EBFm"]',
            'input[placeholder*="T\xECm ki\u1EBFm"]'
          ].join(", ")).first();
          if (await searchBox.isVisible({ timeout: 5e3 }).catch(() => false)) {
            await searchBox.click();
            await searchBox.fill("\u0111\u1ED3ng h\u1ED3");
            await page.waitForTimeout(2e3);
            log('[Browser] \u0110\xE3 g\xF5 "\u0111\u1ED3ng h\u1ED3" v\xE0o \xF4 t\xECm ki\u1EBFm.');
          } else {
            log("[Browser] C\u1EA3nh b\xE1o: Kh\xF4ng t\xECm th\u1EA5y \xF4 t\xECm ki\u1EBFm trong modal.");
          }
          const dongHoItem = page.locator([
            "li.category-item p.text-overflow",
            ".category-item",
            '[class*="category-item"]'
          ].join(", ")).filter({ hasText: /^\s*Đồng\s*Hồ\s*$/i }).first();
          if (await dongHoItem.isVisible({ timeout: 5e3 }).catch(() => false)) {
            await dongHoItem.click();
            await page.waitForTimeout(1500);
            log('[Browser] \u0110\xE3 click "\u0110\u1ED3ng H\u1ED3" \u1EDF c\u1ED9t 1.');
          } else {
            log('[Browser] C\u1EA3nh b\xE1o: Kh\xF4ng t\xECm th\u1EA5y "\u0110\u1ED3ng H\u1ED3" trong danh s\xE1ch.');
          }
          const col2Item = page.locator([
            "li.category-item p.text-overflow",
            ".category-item",
            '[class*="category-item"]'
          ].join(", ")).filter({ hasText: new RegExp("^\\s*" + targetCategoryText + "\\s*$", "i") }).first();
          if (await col2Item.isVisible({ timeout: 5e3 }).catch(() => false)) {
            await col2Item.click();
            await page.waitForTimeout(1e3);
            log(`[Browser] \u0110\xE3 ch\u1ECDn "${targetCategoryText}" \u1EDF c\u1ED9t 2.`);
          } else {
            log(`[Browser] C\u1EA3nh b\xE1o: Kh\xF4ng t\xECm th\u1EA5y "${targetCategoryText}" \u1EDF c\u1ED9t 2.`);
          }
          const confirmBtn = page.locator("button.eds-button--primary, button").filter({ hasText: /Confirm|Xác nhận|Xác Nhận/i }).first();
          try {
            await confirmBtn.waitFor({ state: "visible", timeout: 5e3 });
            await page.waitForFunction(() => {
              const btn = Array.from(document.querySelectorAll("button")).find((b) => {
                const text = b.textContent || "";
                return text.includes("Confirm") || text.includes("X\xE1c nh\u1EADn") || text.includes("X\xE1c Nh\u1EADn");
              });
              return btn && !btn.disabled;
            }, { timeout: 5e3 }).catch(() => {
            });
            await confirmBtn.click({ force: true });
            log("[Browser] \u0110\xE3 Confirm Ng\xE0nh h\xE0ng!");
          } catch (e) {
            log("[Browser] L\u1ED7i: Kh\xF4ng t\xECm th\u1EA5y ho\u1EB7c kh\xF4ng click \u0111\u01B0\u1EE3c n\xFAt Confirm/X\xE1c nh\u1EADn.");
          }
          log("[Browser] \u0110ang \u0111\u1EE3i Shopee load thu\u1ED9c t\xEDnh chi ti\u1EBFt...");
          await page.waitForTimeout(4e3);
        } catch (e) {
          log(`[Browser] L\u1ED7i ch\u1ECDn Ng\xE0nh h\xE0ng th\u1EE7 c\xF4ng: ${e.message}`);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1e3));
    log("[Browser] \u0110ang t\u1EF1 \u0111\u1ED9ng \u0111i\u1EC1n thu\u1ED9c t\xEDnh chi ti\u1EBFt...");
    const zenSpecs = preZenSpecs || { waterproof: "", diameter: "", gender: "Nam", movement: "", thickness: "" };
    log(`[Zenwatch] S\u1EED d\u1EE5ng d\u1EEF li\u1EC7u: ${JSON.stringify(zenSpecs)}`);
    let strapMaterial = ["Kh\xE1c"];
    if (productName.toLowerCase().includes("d\xE2y da")) strapMaterial = ["Da"];
    else if (productName.toLowerCase().includes("d\xE2y cao su")) strapMaterial = ["Silicone", "Cao su"];
    else if (productName.toLowerCase().includes("d\xE2y th\xE9p")) strapMaterial = ["Th\xE9p kh\xF4ng g\u1EC9"];
    try {
      log("[Browser] \u0110ang t\xECm n\xFAt Hi\u1EC3n th\u1ECB \u0111\u1EA7y \u0111\u1EE7...");
      const showMoreLocator = page.locator('.attribute-select-showmore, button:has-text("Hi\u1EC3n th\u1ECB \u0111\u1EA7y \u0111\u1EE7 danh s\xE1ch")').first();
      if (await showMoreLocator.isVisible({ timeout: 3e3 })) {
        await showMoreLocator.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await showMoreLocator.click();
        log("[Browser] \u0110\xE3 click m\u1EDF r\u1ED9ng danh s\xE1ch thu\u1ED9c t\xEDnh!");
        await page.waitForTimeout(1500);
      } else {
        log("[Browser] Kh\xF4ng c\u1EA7n b\u1EA5m m\u1EDF r\u1ED9ng ho\u1EB7c kh\xF4ng t\xECm th\u1EA5y n\xFAt.");
      }
    } catch (e) {
      log("[Browser] B\u1ECF qua b\u01B0\u1EDBc b\u1EA5m n\xFAt m\u1EDF r\u1ED9ng.");
    }
    let parsedWaterproof = (zenSpecs.waterproof || "").toLowerCase();
    let waterproofArr = ["30m - 50m"];
    if (parsedWaterproof.includes("200")) {
      waterproofArr = [">200m", "200m", "> 200m"];
    } else if (parsedWaterproof.includes("100")) {
      waterproofArr = ["50m-100m", "50m - 100m", "100m"];
    } else if (parsedWaterproof.includes("50") || parsedWaterproof.includes("5 atm") || parsedWaterproof.includes("5atm")) {
      waterproofArr = ["30m - 50m", "30m-50m", "50m", "5 ATM"];
    } else if (parsedWaterproof.includes("30") || parsedWaterproof.includes("3 atm") || parsedWaterproof.includes("3atm")) {
      waterproofArr = ["30m", "3 ATM", "<30m"];
    }
    const isAuto = productName.toLowerCase().includes("m\xE1y c\u01A1") || productName.toLowerCase().includes("automatic") || productName.toLowerCase().includes("m\xE1y t\u1EF1 \u0111\u1ED9ng");
    const attributes = [
      { l: "Th\u01B0\u01A1ng hi\u1EC7u", v: "I&W Carnival", multi: false },
      { l: "M\u1EB7t \u0111\u1ED3ng h\u1ED3", v: "Kim", multi: false },
      { l: "Lo\u1EA1i b\u1EA3o h\xE0nh", v: "B\u1EA3o h\xE0nh nh\xE0 cung c\u1EA5p", multi: false },
      { l: "H\u1EA1n b\u1EA3o h\xE0nh", v: "5 n\u0103m", multi: false },
      { l: "Ch\u1ED1ng n\u01B0\u1EDBc", v: "C\xF3", multi: false },
      { l: "\u0110\u1ED3ng h\u1ED3 \u0111eo tay", v: isAuto ? "T\u1EF1 \u0111\u1ED9ng" : "Th\u1EA1ch anh", multi: false },
      { l: "Ki\u1EC3u \u0111\u1ED3ng h\u1ED3", v: ["Th\u1EDDi trang"], multi: true },
      { l: "Ki\u1EC3u v\u1ECF \u0111\u1ED3ng h\u1ED3", v: "Tr\xF2n", multi: false },
      { l: "Ch\u1EA5t li\u1EC7u v\u1ECF \u0111\u1ED3ng h\u1ED3", v: "Th\xE9p kh\xF4ng g\u1EC9", multi: false },
      { l: "Ki\u1EC3u kh\xF3a \u0111\u1ED3ng h\u1ED3", v: ["Kh\xF3a g\xE0i/m\xF3c", "Kho\xE1 g\xE0i/m\xF3c", "Kh\xF3a g\xE0i", "Kho\xE1 g\xE0i", "C\xE0i kh\xF3a", "C\xE0i kho\xE1", "M\xF3c"], multi: false },
      { l: "Ch\u1EA5t li\u1EC7u d\xE2y \u0111eo", v: strapMaterial, multi: false },
      { l: ["K\xEDnh \u0111\u1ED3ng h\u1ED3", "Kinh \u0111\u1ED3ng h\u1ED3"], v: ["K\xEDnh Sapphire", "Sapphire", "Sapphire crystal"], multi: false },
      { l: ["Ch\u1EA5t li\u1EC7u"], v: ["Kim lo\u1EA1i"], multi: true },
      { l: "T\xEDnh n\u0103ng", v: ["Ng\xE0y", "Ph\u1EA3n quang", "Ch\u1ED1ng s\u1ED1c"], multi: true },
      { l: "\u0110\u1ED9 s\xE2u ch\u1ED1ng n\u01B0\u1EDBc", v: waterproofArr, multi: false },
      { l: "\u0110\u01B0\u1EDDng k\xEDnh v\u1ECF \u0111\u1ED3ng h\u1ED3", v: zenSpecs.diameter ? zenSpecs.diameter.replace(/mm/gi, "").trim() : "", multi: false }
    ];
    for (const attr of attributes) {
      const targetLabels = Array.isArray(attr.l) ? attr.l.map((x) => x.normalize("NFC").toLowerCase()) : [attr.l.normalize("NFC").toLowerCase()];
      log(`[Browser] \u0110ang x\u1EED l\xFD: ${targetLabels.join(" / ")}`);
      try {
        let label = null;
        const labels = await page.locator('label, .edit-label, .attribute-item-title, .title, [class*="title"]').all();
        for (const l of labels) {
          if (await l.isVisible()) {
            let text = await l.innerText();
            let textLower = text.normalize("NFC").toLowerCase();
            let matched = false;
            for (const t of targetLabels) {
              if (t === "ch\u1EA5t li\u1EC7u") {
                if (textLower.includes("ch\u1EA5t li\u1EC7u") && !textLower.includes("d\xE2y") && !textLower.includes("v\u1ECF")) {
                  matched = true;
                  break;
                }
              } else if (t === "ch\u1ED1ng n\u01B0\u1EDBc") {
                if (textLower.includes("ch\u1ED1ng n\u01B0\u1EDBc") && !textLower.includes("\u0111\u1ED9 s\xE2u")) {
                  matched = true;
                  break;
                }
              } else if (t === "k\xEDnh \u0111\u1ED3ng h\u1ED3" || t === "kinh \u0111\u1ED3ng h\u1ED3") {
                if (textLower.includes("kinh \u0111\u1ED3ng h\u1ED3") || textLower.includes("k\xEDnh \u0111\u1ED3ng h\u1ED3")) {
                  matched = true;
                  break;
                }
              } else {
                if (textLower.includes(t)) {
                  matched = true;
                  break;
                }
              }
            }
            if (matched) {
              label = l;
              break;
            }
          }
        }
        if (!label) {
          log(`[Browser] B\u1ECF qua: Kh\xF4ng t\xECm th\u1EA5y nh\xE3n ${attr.l}`);
          continue;
        }
        await label.scrollIntoViewIfNeeded();
        let row = label.locator('xpath=ancestor::*[contains(@class, "edit-row") or contains(@class, "shopee-form-item") or contains(@class, "attribute-item")][1]');
        if (!await row.isVisible()) {
          row = label.locator("..").locator("..");
        }
        const clearBtns = await row.locator('.eds-tag__close, .shopee-tag__close, .eds-icon-close, .shopee-select__clear, svg[class*="close"], i[class*="close"], svg[class*="clear"]').all();
        for (const btn of clearBtns) {
          try {
            if (await btn.isVisible()) {
              await btn.click({ force: true });
              await page.waitForTimeout(300);
            }
          } catch (e) {
          }
        }
        const dropdownTrigger = row.locator(".eds-select__wrap, .eds-select, .shopee-select, .attribute-select-list-column, .eds-input__inner, input, button").first();
        try {
          if (await dropdownTrigger.isVisible({ timeout: 2e3 })) {
            await dropdownTrigger.click();
          } else {
            const rowBox = await row.boundingBox();
            if (rowBox && rowBox.width > 200) {
              await page.mouse.click(rowBox.x + rowBox.width * 0.7, rowBox.y + rowBox.height / 2);
            } else {
              const labelBox = await label.boundingBox();
              if (labelBox) {
                await page.mouse.click(labelBox.x + labelBox.width + 100, labelBox.y + labelBox.height / 2);
              }
            }
          }
        } catch (e) {
          log(`[Browser] L\u1ED7i m\u1EDF dropdown ${attr.l}: B\u1ECF qua \u0111\u1EC3 th\u1EED ti\u1EBFp t\u1EE5c`);
        }
        await page.waitForTimeout(1e3);
        const targetValues = Array.isArray(attr.v) ? attr.v : [attr.v];
        if (targetValues.length === 1 && !targetValues[0]) continue;
        for (const val of targetValues) {
          let hasTyped = false;
          // Dùng page.evaluateHandle để lấy element của ô input, sau đó dùng Playwright fill để tương thích 100% với React
          const searchHandle = await page.evaluateHandle(() => {
             const poppers = Array.from(document.querySelectorAll('.eds-popper, .shopee-popover, .eds-select-dropdown, .shopee-popper'));
             // Tìm popper đang hiển thị
             const activePopper = poppers.reverse().find(p => p.getBoundingClientRect().width > 0 && p.getBoundingClientRect().height > 0 && window.getComputedStyle(p).display !== 'none');
             
             let inputEl = null;
             if (activePopper) {
                inputEl = activePopper.querySelector('input[type="text"]');
             }
             if (!inputEl) {
                // Fallback tìm input bên ngoài
                const allInputs = Array.from(document.querySelectorAll('input[placeholder*="tối thiểu 1 ký tự"], .eds-select__filter input'));
                inputEl = allInputs.find(i => i.getBoundingClientRect().width > 0);
             }
             return inputEl;
          });

          const isElement = await searchHandle.evaluate(el => el !== null);
          if (isElement) {
            await searchHandle.click({ force: true }).catch(() => {});
            await searchHandle.fill("");
            await searchHandle.fill(val);
            await page.waitForTimeout(1500);
            hasTyped = true;
          } else {
            const inputInsideRow = row.locator('input[type="text"]').first();
            if (await inputInsideRow.isVisible().catch(() => false)) {
              await inputInsideRow.click({ force: true });
              await inputInsideRow.fill("");
              await inputInsideRow.fill(val);
              await page.waitForTimeout(1500);
              hasTyped = true;
            }
          }
          let optionHandle = await page.evaluateHandle((searchValue) => {
            const searchLower = searchValue.normalize("NFC").toLowerCase().trim();
            const opts = Array.from(document.querySelectorAll('.eds-option, .shopee-option, [role="option"], li.eds-select-dropdown__item, .shopee-checkbox'));
            let bestMatch = null;
            for (const opt of opts) {
              const rect = opt.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0) {
                const text = (opt.textContent || opt.innerText || "").normalize("NFC").trim().toLowerCase();
                if (text === searchLower) {
                  return opt;
                }
                if (text.includes(searchLower) && !bestMatch) {
                  bestMatch = opt;
                }
              }
            }
            return bestMatch;
          }, val);
          let clicked = false;
          const el = optionHandle.asElement();
          if (el) {
            const isSelected = await el.evaluate((opt) => {
              if (opt.classList.contains("selected") || opt.classList.contains("shopee-option-selected")) return true;
              if (opt.getAttribute("aria-selected") === "true" || opt.getAttribute("aria-checked") === "true") return true;
              if (opt.className.includes("checked")) return true;
              if (opt.querySelector('.selected, .shopee-option-selected, input:checked, [class*="checked"]')) return true;
              return false;
            });
            if (isSelected) {
              clicked = true;
            } else {
              try {
                await el.click();
                clicked = true;
              } catch (e) {
                await el.click({ force: true });
                clicked = true;
              }
            }
          }
          if (clicked) {
            await page.waitForTimeout(600);
            if (!attr.multi) break;
          } else {
            let addedCustom = false;
            try {
              log(`[Browser] Thuộc tính "${val}" không có sẵn, thử thêm thuộc tính mới...`);
              await page.mouse.wheel(0, 300);
              await page.waitForTimeout(500);

              const addBtnLocator = page.locator('text="Thêm thuộc tính mới", text="Thêm", .eds-option-add, .eds-select-dropdown__item-add').filter({ state: 'visible' }).last();
              if (await addBtnLocator.isVisible().catch(() => false)) {
                try {
                   await addBtnLocator.click({ force: true });
                   await page.waitForTimeout(500);
                } catch(e) {}
              }
              const addInput = page.locator('.eds-option-add__input input[type="text"]:visible, input[placeholder*="Nhập vào"]:visible, input[placeholder*="thuộc tính"]:visible').last();
              if (await addInput.isVisible().catch(() => false)) {
                await addInput.click();
                await page.waitForTimeout(200);
                await addInput.fill("");
                await addInput.type(val, { delay: 100 });
                await page.waitForTimeout(800);
                const confirmBtn = page.locator('.eds-option-add__add-confirm-icon:visible, .icon-check:visible, button:has(svg):visible, i[class*="check"]:visible').last();
                if (await confirmBtn.isVisible()) {
                  await confirmBtn.click({ force: true });
                  await page.waitForTimeout(1000);
                  clicked = true;
                  addedCustom = true;
                  log(`[Browser] Đã thêm thuộc tính mới: ${val}`);
                } else {
                  log(`[Browser] Cảnh báo: Không tìm thấy nút Xác nhận (Check) để thêm thuộc tính mới.`);
                  // Fallback: Try pressing Enter
                  await addInput.press('Enter');
                  clicked = true;
                  addedCustom = true;
                  log(`[Browser] Đã thử nhấn Enter để thêm thuộc tính mới: ${val}`);
                }
              } else {
                log(`[Browser] Cảnh báo: Không tìm thấy ô nhập liệu để thêm thuộc tính mới.`);
              }
            } catch (e) {
              log(`[Browser] Lỗi khi thêm thuộc tính mới: ${e.message}`);
            }

            if (!clicked) {
              log(`[Browser] Không tìm thấy tùy chọn: ${val}`);
              if (hasTyped) {
                await page.keyboard.down("Control");
                await page.keyboard.press("a");
                await page.keyboard.up("Control");
                await page.keyboard.press("Backspace");
                await page.waitForTimeout(500);
              }
            } else if (!attr.multi) {
              break;
            }
          }
        }
        try {
          await label.click({ force: true });
          await page.waitForTimeout(400);
        } catch (e) {
        }
      } catch (e) {
        log(`[Browser] L\u1ED7i x\u1EED l\xFD thu\u1ED9c t\xEDnh ${attr.l}: ${e.message}`);
      }
    }
    log("[Browser] Đang điền Mô tả sản phẩm...");
    if (productDescription) {
      try {
        const descInputLocator = page.locator('textarea[placeholder*="mô tả"], textarea[placeholder*="Mô tả"], .product-edit-form-item textarea').first();
        if (await descInputLocator.isVisible({ timeout: 2000 }).catch(() => false)) {
          await descInputLocator.fill("");
          await descInputLocator.fill(productDescription);
          await page.waitForTimeout(1000);
          log("[Browser] Đã điền xong mô tả sản phẩm bằng Playwright (textarea)!");
        } else {
          await page.evaluate((desc) => {
            const textareas = Array.from(document.querySelectorAll("textarea"));
            const descInput = textareas.find((i) => i.placeholder && i.placeholder.toLowerCase().includes("mô tả"));
            if (descInput) {
              descInput.value = "";
              descInput.value = desc;
              descInput.dispatchEvent(new Event("input", { bubbles: true }));
              descInput.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }, productDescription);
        }
      } catch (e) {
        log("[Browser] Lỗi điền mô tả fallback: " + e.message);
      }
    }

    try {
      log("[Browser] Đang kiểm tra và điền mô tả sản phẩm vào trình soạn thảo (ql-editor)...");
      const descEditor = page.locator('.ql-editor[contenteditable="true"]').last();
      if (await descEditor.isVisible({ timeout: 5e3 })) {
        await descEditor.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await descEditor.click();
        await page.keyboard.down("Control");
        await page.keyboard.press("a");
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace");
        await page.waitForTimeout(500);
        await page.keyboard.insertText(productDescription || "");
        log("[Browser] \u0110\xE3 x\xF3a s\u1EA1ch m\xF4 t\u1EA3 c\u0169 v\xE0 \u0111i\u1EC1n m\xF4 t\u1EA3 m\u1EDBi v\xE0o Quill Editor!");
      } else {
        log("[Browser] Kh\xF4ng t\xECm th\u1EA5y \xF4 nh\u1EADp M\xF4 t\u1EA3 (ql-editor).");
      }
    } catch (e) {
      log(`[Browser] L\u1ED7i \u0111i\u1EC1n m\xF4 t\u1EA3: ${e.message}`);
    }
    try {
      log("[Browser] \u0110ang c\u1EA5u h\xECnh Th\xF4ng tin b\xE1n h\xE0ng & Bi\u1EBFn th\u1EC3...");
      const potentialVariants = await prisma.variant.findMany({
        where: { modelId: currentVariant.modelId },
        orderBy: { sku: "asc" }
      });
      allVariants = await groupVariantsByDesignAI(currentVariant, potentialVariants, log);
      if (allVariants.length > 0) {
        const salesTab = page.locator(".shopee-tabs__nav-item", { hasText: "Th\xF4ng tin b\xE1n h\xE0ng" });
        if (await salesTab.isVisible()) {
          await salesTab.click();
          await page.waitForTimeout(1e3);
        }
        const existingGroupNameInput = page.locator('.variation-selector-custom-len-calc-input input, input[placeholder*="Type or Select"], input[placeholder*="m\xE0u s\u1EAFc"], input[placeholder*="M\xE0u s\u1EAFc"]').first();
        const hasExistingGroup = await existingGroupNameInput.isVisible().catch(() => false);
        if (!hasExistingGroup) {
          const addGroupBtn = page.locator(".primary-dash-button, button").filter({ hasText: /Thêm nhóm phân loại/i }).first();
          try {
            await addGroupBtn.waitFor({ state: "visible", timeout: 5e3 });
            await addGroupBtn.scrollIntoViewIfNeeded();
            log('[Browser] Ch\u01B0a c\xF3 nh\xF3m ph\xE2n lo\u1EA1i n\xE0o. Ti\u1EBFn h\xE0nh click "+ Th\xEAm nh\xF3m ph\xE2n lo\u1EA1i"...');
            await addGroupBtn.click({ force: true });
            await page.waitForTimeout(2e3);
          } catch (e) {
            log('[Browser] Kh\xF4ng t\xECm th\u1EA5y ho\u1EB7c kh\xF4ng c\u1EA7n click n\xFAt "+ Th\xEAm nh\xF3m ph\xE2n lo\u1EA1i".');
          }
        } else {
          log("[Browser] \u0110\xE3 ph\xE1t hi\u1EC7n nh\xF3m ph\xE2n lo\u1EA1i c\xF3 s\u1EB5n. Kh\xF4ng click th\xEAm nh\xF3m ph\xE2n lo\u1EA1i m\u1EDBi.");
        }
        log("[Browser] \u0110ang x\xF3a to\xE0n b\u1ED9 c\xE1c t\xF9y ch\u1ECDn c\u0169...");
        let deleteBtn = page.locator(".variation-selector-item-delete-btn").first();
        while (await deleteBtn.isVisible()) {
          await deleteBtn.click();
          await page.waitForTimeout(600);
          deleteBtn = page.locator(".variation-selector-item-delete-btn").first();
          if (await page.locator(".variation-selector-item").count() <= 1) break;
        }
        const variationGroupNameInput = page.locator('.variation-selector-custom-len-calc-input input, input[placeholder*="Type or Select"], input[placeholder*="m\xE0u s\u1EAFc"], input[placeholder*="M\xE0u s\u1EAFc"]').first();
        if (await variationGroupNameInput.isVisible()) {
          await variationGroupNameInput.scrollIntoViewIfNeeded();
          await variationGroupNameInput.focus();
          await variationGroupNameInput.fill("M\xE0u s\u1EAFc");
          await page.waitForTimeout(500);
          await page.keyboard.press("Escape").catch(() => {
          });
          await page.waitForTimeout(500);
        }
        log("[Browser] Đang thiết lập tên phân loại màu sắc bằng mã SKU...");
        for (let i = 0; i < allVariants.length; i++) {
          const v = allVariants[i];
          v.variationName = v.sku;
        }

        log("[Browser] Đang điền các phân loại màu sắc mới...");
        for (let i = 0; i < allVariants.length; i++) {
          const v = allVariants[i];
          const inputs = await page.locator('.variation-selector-custom-len-calc-input input, input[placeholder*="Type or Select"], input[placeholder*="e.g. Red"], input[placeholder*="v\xED d\u1EE5: \u0111\u1ECF"]').all();
          const targetInput = inputs[i + 1];
          if (targetInput) {
            await targetInput.scrollIntoViewIfNeeded();
            await targetInput.focus();
            await targetInput.click({ force: true });
            await page.waitForTimeout(200);
            await targetInput.fill(v.variationName || v.sku);
            await page.waitForTimeout(300);
            await targetInput.press("Enter");
            await page.waitForTimeout(800);
          }
        }
        log("[Browser] \u0110ang upload \u1EA3nh Avatar cho t\u1EEBng bi\u1EBFn th\u1EC3...");
        for (let i = 0; i < allVariants.length; i++) {
          const v = allVariants[i];
          let cell = page.locator(".variation-model-table-main, .shopee-table__body").locator("div, td").filter({ has: page.locator(`:text-is("${v.sku}")`) }).filter({ has: page.locator('[class*="image-manager"], [class*="upload"]') }).last();
          let imageCell = cell.locator('[class*="image-manager"], [class*="upload-wrapper"], .eds-upload__item').first();
          if (await imageCell.count() === 0) {
            imageCell = page.locator('.variation-model-table-main [class*="image-manager"], .variation-model-table-main .eds-upload__item, .variation-model-table-main [class*="upload-wrapper"], .shopee-table__body [class*="image-manager"], .shopee-table__body [class*="upload-wrapper"]').nth(i);
          }
          if (await imageCell.isVisible().catch(() => false)) {
            await imageCell.hover();
            await page.waitForTimeout(800);
            const deleteIcons = await imageCell.locator('svg, i, button, [class*="delete"], [class*="remove"], [class*="trash"], [class*="close"]').all();
            for (const icon of deleteIcons) {
              const className = await icon.getAttribute("class") || "";
              const title = await icon.getAttribute("title") || "";
              if (className.toLowerCase().includes("delete") || className.toLowerCase().includes("remove") || className.toLowerCase().includes("trash") || className.toLowerCase().includes("close") || title.toLowerCase().includes("x\xF3a")) {
                if (await icon.isVisible()) {
                  await icon.click({ force: true });
                  await page.waitForTimeout(1200);
                  break;
                }
              }
            }
            if (v.avatarImage && fs.existsSync(v.avatarImage)) {
              log(`[Browser] Upload Avatar: ${v.sku}`);
              const uploadBtn = imageCell.locator('input[type="file"]');
              if (await uploadBtn.count() > 0) {
                await uploadBtn.first().setInputFiles(v.avatarImage);
              } else {
                const [fileChooser] = await Promise.all([
                  page.waitForEvent("filechooser"),
                  imageCell.click({ force: true })
                ]);
                await fileChooser.setFiles(v.avatarImage);
              }
              await imageCell.locator("img").first().waitFor({ state: "visible", timeout: 15e3 }).catch(() => {
              });
              await page.waitForTimeout(1500);
            }
          }
        }
        log("[Browser] Đang điền bảng Giá (Excel), Kho hàng (10) và SKU phân loại...");
        const tableLoc = page.locator(".variation-model-table-main, .shopee-table__body, table").first();
        await tableLoc.locator('input:not([type="file"]):not([type="hidden"])').first().waitFor({ state: "visible", timeout: 2e4 }).catch(() => log("[Browser] Bỏ qua chờ tableLoc vì timeout"));
        await page.waitForTimeout(2e3);
        for (let i = 0; i < allVariants.length; i++) {
          const v = allVariants[i];
          const atomicFill = async (sku2, fieldIndex, val, fieldName) => {
            await page.evaluate(({ sku: sku3, fieldIndex: fieldIndex2 }) => {
              const table = document.querySelector(".variation-model-table-main") || document.querySelector(".shopee-table__body") || document.body;
              document.querySelectorAll("[data-bot-target]").forEach((el) => el.removeAttribute("data-bot-target"));
              const inputs = Array.from(table.querySelectorAll('input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([disabled]), textarea:not([disabled])'));
              const visibleInputs = inputs.filter((i2) => {
                const rect = i2.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
              const cells = Array.from(table.querySelectorAll(".table-cell, td, tr, .edit-row, div"));
              const labelCell = cells.find((e) => {
                const directText = Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
                return directText === sku3;
              });
              if (!labelCell) return;
              const labelRect = labelCell.getBoundingClientRect();
              const labelCenterY = labelRect.top + labelRect.height / 2;
              const rowInputs = visibleInputs.filter((input) => {
                const inputCell = input.closest(".table-cell, td, tr, .edit-row") || input;
                const inputRect = inputCell.getBoundingClientRect();
                const inputCenterY = inputRect.top + inputRect.height / 2;
                return Math.abs(inputCenterY - labelCenterY) < 50;
              });
              rowInputs.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
              if (rowInputs[fieldIndex2]) {
                rowInputs[fieldIndex2].setAttribute("data-bot-target", "active-target");
              }
            }, { sku: sku2, fieldIndex });
            const targetLoc = page.locator('[data-bot-target="active-target"]');
            try {
              await targetLoc.waitFor({ state: "visible", timeout: 5e3 });
              await targetLoc.scrollIntoViewIfNeeded();
              await targetLoc.click({ force: true });
              await page.waitForTimeout(150);
              await page.keyboard.down("Control");
              await page.keyboard.press("a");
              await page.keyboard.up("Control");
              await page.keyboard.press("Backspace");
              await page.waitForTimeout(150);
              await targetLoc.fill(val);
              await page.waitForTimeout(300);
              await page.keyboard.press("Tab");
              await page.waitForTimeout(300);
              return true;
            } catch (err) {
              log(`[Browser] C\u1EA2NH B\xC1O: L\u1ED7i \u0111i\u1EC1n ${fieldName} cho ${sku2} - Kh\xF4ng t\xECm th\u1EA5y ho\u1EB7c \u0111i\u1EC1n th\u1EA5t b\u1EA1i.`);
              return false;
            }
          };
          let successCount = 0;
          if (await atomicFill(v.sku, 0, String(v.price), "Gi\xE1")) successCount++;
          if (await atomicFill(v.sku, 1, "10", "Kho")) successCount++;
          if (await atomicFill(v.sku, 2, v.sku, "SKU")) successCount++;
          if (successCount === 3) {
            log(`[Browser] \u0110\xE3 \u0111i\u1EC1n th\xE0nh c\xF4ng d\xF2ng ${i + 1}: Gi\xE1=${v.price}, Kho=10, SKU=${v.sku}`);
          } else {
            log(`[Browser] D\xF2ng ${i + 1} (${v.sku}) \u0111i\u1EC1n ch\u01B0a ho\xE0n ch\u1EC9nh (${successCount}/3 \xF4).`);
          }
        }
      }
    } catch (e) {
      log(`[Browser] L\u1ED7i x\u1EED l\xFD Th\xF4ng tin b\xE1n h\xE0ng: ${e.message}`);
    }
      try {
        log("[Browser] \u0110ang c\u1EA5u h\xECnh V\u1EADn chuy\u1EC3n & Th\xF4ng tin kh\xE1c...");
        const shippingTab = page.locator(".shopee-tabs__nav-item", { hasText: "V\u1EADn chuy\u1EC3n" });
        if (await shippingTab.isVisible()) {
          await shippingTab.click();
          await page.waitForTimeout(1e3);
        }
        log("[Browser] \u0110ang \u0111i\u1EC1n c\xE2n n\u1EB7ng \u0111\xF3ng g\xF3i: 500g...");
        const weightInput = page.locator(".eds-input__inner, .eds-input").filter({ has: page.locator(".eds-input__suffix, span").filter({ hasText: /^gr$/i }) }).locator("input").first();
        if (await weightInput.isVisible({ timeout: 5e3 }).catch(() => false)) {
          await weightInput.scrollIntoViewIfNeeded();
          await weightInput.focus();
          await weightInput.fill("500");
          await page.waitForTimeout(200);
          log("[Browser] \u0110\xE3 \u0111i\u1EC1n c\xE2n n\u1EB7ng: 500g");
        } else {
          log("[Browser] C\u1EA3nh b\xE1o: Kh\xF4ng t\xECm th\u1EA5y \xF4 nh\u1EADp c\xE2n n\u1EB7ng.");
        }
        log("[Browser] \u0110ang \u0111i\u1EC1n k\xEDch th\u01B0\u1EDBc \u0111\xF3ng g\xF3i: D x R x C = 20x20x10...");
        const rInput = page.locator('input[placeholder="R"], input[placeholder*="R\u1ED9ng"], input[placeholder*="Width"]').first();
        if (await rInput.isVisible()) {
          await rInput.fill("20");
          await page.waitForTimeout(200);
        }
        const dInput = page.locator('input[placeholder="D"], input[placeholder*="D\xE0i"], input[placeholder*="Length"]').first();
        if (await dInput.isVisible()) {
          await dInput.fill("20");
          await page.waitForTimeout(200);
        }
        const cInput = page.locator('input[placeholder="C"], input[placeholder*="Cao"], input[placeholder*="Height"]').first();
        if (await cInput.isVisible()) {
          await cInput.fill("10");
          await page.waitForTimeout(200);
        }
        log("[Browser] \u0110ang \u0111\u1EE3i 2 gi\xE2y \u0111\u1EC3 Shopee t\u1EF1 \u0111\u1ED9ng load c\xE1c k\xEAnh v\u1EADn chuy\u1EC3n...");
        await page.waitForTimeout(2e3);
        log("[Browser] Đang cấu hình các kênh vận chuyển...");
        try {
          const switches = await page.locator('.eds-switch, .shopee-switch, input[type="checkbox"]').all();
          for (const sw of switches) {
            if (!(await sw.isVisible().catch(()=>false))) continue;
            
            const rowText = await sw.evaluate(el => {
               let parent = el.parentElement;
               // Trèo lên các thẻ cha để tìm dòng text chứa tên kênh vận chuyển
               for(let i=0; i<6; i++) {
                 if(parent) {
                   const text = parent.innerText || "";
                   if (text.match(/Nhanh|Hỏa Tốc|Trong Ngày|Tủ nhận hàng|Điểm nhận hàng/i)) {
                     return text.split('\n')[0].trim(); // Lấy dòng đầu tiên
                   }
                   parent = parent.parentElement;
                 }
               }
               return "";
            });

            if (!rowText) continue;
            
            let targetState = null;
            if (rowText.match(/^Nhanh/i)) targetState = true;
            else if (rowText.match(/^Hỏa Tốc/i)) targetState = true;
            else if (rowText.match(/^Trong Ngày/i)) targetState = true;
            else if (rowText.match(/^Tủ nhận hàng/i) || rowText.match(/^Điểm nhận hàng/i)) targetState = false;

            if (targetState !== null) {
               const isOpen = await sw.evaluate(el => el.classList.contains('eds-switch--open') || el.classList.contains('checked') || el.classList.contains('active') || el.checked === true);
               
               if (isOpen !== targetState) {
                  await sw.scrollIntoViewIfNeeded();
                  await sw.click({ force: true });
                  await page.waitForTimeout(800);
                  log(`[Browser] Đã ${targetState ? "BẬT" : "TẮT"} kênh vận chuyển: ${rowText}`);
               }
            }
          }
        } catch (e) {
          log(`[Browser] Cảnh báo: Lỗi khi cấu hình các kênh vận chuyển: ${e.message}`);
        }
        const otherInfoTab = page.locator(".shopee-tabs__nav-item", { hasText: "Th\xF4ng tin kh\xE1c" });
        if (await otherInfoTab.isVisible()) {
          await otherInfoTab.click();
          await page.waitForTimeout(1e3);
        }
        const globalSku = sku.replace(/\d+$/, "");
        log(`[Browser] Đang điền SKU sản phẩm: ${globalSku}`);
        const parentSkuInput = page.locator('[data-product-edit-field-unique-id="parentSku"] input, .parent-sku input, input[placeholder="SKU"]').first();
        if (await parentSkuInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await parentSkuInput.fill("");
          await parentSkuInput.fill(globalSku);
          await page.waitForTimeout(500);
        }
        log("[Browser] \u0110ang b\u1EA5m n\xFAt L\u01B0u / Hi\u1EC3n th\u1ECB...");
        let clickedSave = false;
        const publishBtns = await page.locator("button").filter({ hasText: /Lưu và Hiển thị|Lưu & Hiển thị|^Hiển thị$/i }).all();
        for (const btn of publishBtns.reverse()) {
          if (await btn.isVisible() && !await btn.isDisabled()) {
            await btn.click();
            clickedSave = true;
            log("[Browser] \u0110\xE3 click n\xFAt Hi\u1EC3n th\u1ECB/L\u01B0u.");
            break;
          }
        }
        if (!clickedSave) {
          const updateBtns = await page.locator("button").filter({ hasText: /^Cập nhật$/i }).all();
          for (const btn of updateBtns.reverse()) {
            if (await btn.isVisible() && !await btn.isDisabled()) {
              await btn.click();
              clickedSave = true;
              log("[Browser] \u0110\xE3 click n\xFAt C\u1EADp nh\u1EADt.");
              break;
            }
          }
        }
        if (clickedSave) {
          await page.waitForTimeout(1500);
          try {
            const dialogConfirmBtn = page.locator('.eds-modal button, .shopee-dialog button, [role="dialog"] button, .modal button, .eds-modal__box button').filter({ hasText: /Lưu & Hiển thị|^Hiển thị$|Lưu và Hiển thị/i }).last();
            if (await dialogConfirmBtn.isVisible({ timeout: 5e3 }).catch(() => false)) {
              await dialogConfirmBtn.click({ force: true });
              log("[Browser] \u0110\xE3 click n\xFAt L\u01B0u & Hi\u1EC3n th\u1ECB trong h\u1ED9p tho\u1EA1i x\xE1c nh\u1EADn.");
              await page.waitForTimeout(2e3);
            }
          } catch (e) {
          }
          log("[Browser] \u0110\xE3 click n\xFAt X\xE1c nh\u1EADn, \u0111ang ch\u1EDD Shopee x\u1EED l\xFD...");
          let submitSuccess = false;
          try {
            await Promise.race([
              page.waitForSelector('.shopee-message-wrapper:has-text("th\xE0nh c\xF4ng"), .shopee-toast:has-text("th\xE0nh c\xF4ng"), .shopee-message:has-text("th\xE0nh c\xF4ng")', { state: "visible", timeout: 25e3 }),
              page.waitForURL("**/portal/product/list/**", { timeout: 25e3 }),
              page.waitForNavigation({ waitUntil: "networkidle", timeout: 25e3 })
            ]);
            submitSuccess = true;
          } catch (e) {
            const currentUrl = page.url();
            if (currentUrl.includes("/product/list") || !currentUrl.includes("/product/new") && !currentUrl.includes(`/product/${shopeeProductId}`)) {
              submitSuccess = true;
            }
          }
          if (submitSuccess) {
            log(`[Browser] \u0110\xE3 \u0111\u0103ng/c\u1EADp nh\u1EADt th\xE0nh c\xF4ng s\u1EA3n ph\u1EA9m model ${sku}`);
            let finalShopeeId = shopeeProductId;
            const isCleanNew = !shopeeProductId || shopeeProductId.trim() === "" || shopeeProductId.toLowerCase() === "id";
            if (isCleanNew) {
              log(`[Browser] \u23F3 Ph\xE1t hi\u1EC7n s\u1EA3n ph\u1EA9m m\u1EDBi. \u0110ang b\u1EAFt \u0111\u1EA7u quy tr\xECnh d\xF2 l\u1EA5y Shopee Product ID t\u1EEB s\xE0n...`);
              let newShopeeId = "";
              for (let attempt = 1; attempt <= 6; attempt++) {
                log(`[Browser] D\xF2 Shopee Product ID (L\u1EA7n th\u1EED ${attempt}/6)...`);
                try {
                  const searchUrl = `https://banhang.shopee.vn/portal/product/list/live/all?keyword=${encodeURIComponent(currentVariant.model.name)}`;
                  if (attempt > 1) {
                    log(`[Browser] \u23F3 \u0110ang \u0111\u1EE3i 5 gi\xE2y \u0111\u1EC3 Shopee \u0111\u1ED3ng b\u1ED9 d\u1EEF li\u1EC7u s\u1EA3n ph\u1EA9m m\u1EDBi...`);
                    await page.waitForTimeout(5e3);
                  }
                  log(`[Browser] \u{1F504} \u0110ang t\u1EA3i/l\xE0m m\u1EDBi trang danh s\xE1ch s\u1EA3n ph\u1EA9m \u0111\u1EC3 qu\xE9t ID m\u1EDBi nh\u1EA5t...`);
                  await page.goto(searchUrl, { waitUntil: "load", timeout: 35e3 });
                  await page.waitForTimeout(5e3);
                  try {
                    const popupSkipBtn = page.locator('button, [role="button"], span, div').filter({ hasText: /^Bỏ qua$/i }).first();
                    if (await popupSkipBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
                      await popupSkipBtn.click({ force: true }).catch(() => {
                      });
                      log("[Browser] \u0110\xE3 t\u1EF1 \u0111\u1ED9ng \u0111\xF3ng popup qu\u1EA3ng c\xE1o/h\u01B0\u1EDBng d\u1EABn c\u1EA3n tr\u1EDF.");
                      await page.waitForTimeout(1500);
                    }
                  } catch (popupErr) {
                  }
                  const foundId = await page.evaluate(({ targetSku, attemptIndex }) => {
                    const skuElements = Array.from(document.querySelectorAll('.product-sku, [class*="product-sku"], .product-sku-text'));
                    for (const el of skuElements) {
                      const text = el.textContent || "";
                      const hasParentLabel = text.toLowerCase().includes("sku s\u1EA3n ph\u1EA9m") || text.toLowerCase().includes("product sku");
                      const hasVariationLabel = text.toLowerCase().includes("sku ph\xE2n lo\u1EA1i") || text.toLowerCase().includes("variation sku");
                      if (!hasParentLabel || hasVariationLabel) continue;
                      const cleanSku = text.replace(/sku sản phẩm:?/i, "").replace(/product sku:?/i, "").trim().toLowerCase();
                      if (cleanSku === targetSku.toLowerCase()) {
                        let parent = el.parentElement;
                        for (let depth = 0; depth < 10 && parent; depth++) {
                          const link = parent.querySelector('a[href*="/portal/product/"]');
                          if (link) {
                            const href = link.getAttribute("href") || "";
                            const match = href.match(/\/portal\/product\/(\d+)/);
                            if (match && match[1]) return match[1];
                          }
                          const itemIdEl = parent.querySelector('.item-id, [class*="item-id"], [class*="product-id"]');
                          if (itemIdEl) {
                            const itemIdText = itemIdEl.textContent || "";
                            const match = itemIdText.match(/ID Sản phẩm:\s*(\d+)/i) || itemIdText.match(/ID:\s*(\d+)/i) || itemIdText.match(/(\d+)/);
                            if (match && match[1]) return match[1];
                          }
                          parent = parent.parentElement;
                        }
                      }
                    }
                    if (attemptIndex >= 4) {
                      const link = document.querySelector('a[href*="/portal/product/"]');
                      if (link) {
                        const href = link.getAttribute("href") || "";
                        const match = href.match(/\/portal\/product\/(\d+)/);
                        if (match && match[1]) return match[1];
                      }
                      const itemIdEl = document.querySelector('.item-id, [class*="item-id"], [class*="product-id"]');
                      if (itemIdEl) {
                        const itemIdText = itemIdEl.textContent || "";
                        const match = itemIdText.match(/ID Sản phẩm:\s*(\d+)/i) || itemIdText.match(/ID:\s*(\d+)/i) || itemIdText.match(/(\d+)/);
                        if (match && match[1]) return match[1];
                      }
                    }
                    return null;
                  }, { targetSku: currentVariant.sku, attemptIndex: attempt });
                  if (foundId) {
                    newShopeeId = foundId;
                    log(`[Browser] \u{1F389} \u0110\xE3 t\xECm th\u1EA5y Shopee Product ID m\u1EDBi: ${newShopeeId}`);
                    break;
                  }
                } catch (e) {
                  log(`[Browser] L\u1ED7i khi t\u1EA3i trang danh s\xE1ch \u0111\u1EC3 d\xF2 ID: ${e.message}`);
                }
                log(`[Browser] Ch\u01B0a t\xECm th\u1EA5y s\u1EA3n ph\u1EA9m ${currentVariant.sku} tr\xEAn Shopee. \u0110\u1EE3i 5 gi\xE2y r\u1ED3i th\u1EED l\u1EA1i...`);
                await page.waitForTimeout(5e3);
              }
              if (newShopeeId) {
                finalShopeeId = newShopeeId;
                const variantIds = allVariants.map(v => v.id);
                await prisma.variant.updateMany({
                  where: { id: { in: variantIds } },
                  data: { shopeeProductId: newShopeeId }
                });
                log(`[Browser] ✅ Đã cập nhật Shopee Product ID (${newShopeeId}) vào DB cho ${allVariants.length} SKU thuộc nhóm: ${allVariants.map(v=>v.sku).join(', ')}`);
              } else {
                log(`[Browser] \u26A0\uFE0F Kh\xF4ng th\u1EC3 t\u1EF1 \u0111\u1ED9ng t\xECm th\u1EA5y Shopee Product ID m\u1EDBi sau 6 l\u1EA7n th\u1EED. B\u1EA1n c\xF3 th\u1EC3 c\u1EA7n \u0111i\u1EC1n th\u1EE7 c\xF4ng.`);
              }
            }
            await appendToGoogleSheet(finalShopeeId, currentVariant.sku, productName, onProgress);
            await sendTelegramNotification(
              currentVariant.sku,
              currentVariant.model.name,
              productName,
              finalShopeeId,
              isCleanNew,
              onProgress
            );
          } else {
            throw new Error("N\xFAt L\u01B0u/C\u1EADp nh\u1EADt \u0111\xE3 \u0111\u01B0\u1EE3c b\u1EA5m nh\u01B0ng Shopee kh\xF4ng l\u01B0u th\xE0nh c\xF4ng (v\u1EABn \u0111ang b\u1ECB gi\u1EEF l\u1EA1i \u1EDF trang ch\u1EC9nh s\u1EEDa s\u1EA3n ph\u1EA9m). Vui l\xF2ng ki\u1EC3m tra xem b\u1EA1n c\xF3 b\u1ECF s\xF3t tr\u01B0\u1EDDng th\xF4ng tin b\u1EAFt bu\u1ED9c n\xE0o ho\u1EB7c m\xF4 t\u1EA3 s\u1EA3n ph\u1EA9m b\u1ECB tr\u1ED1ng hay kh\xF4ng.");
          }
        } else {
          log("[Browser] L\u1ED7i: Kh\xF4ng t\xECm th\u1EA5y n\xFAt Hi\u1EC3n th\u1ECB/C\u1EADp nh\u1EADt \u0111\u1EC3 b\u1EA5m!");
        }
      } catch (e) {
        log(`[Browser] L\u1ED7i x\u1EED l\xFD V\u1EADn chuy\u1EC3n & Ho\xE0n t\u1EA5t: ${e.message}`);
      }
      log(`[Ho\xE0n t\u1EA5t] Qu\xE1 tr\xECnh Sync Shopee \u0111\xE3 ch\u1EA1y xong! B\u1EA1n h\xE3y ki\u1EC3m tra l\u1EA1i tr\xEAn tr\xECnh duy\u1EC7t.`);

  } catch (e) {
    log(`[L\u1ED7i Browser] ${e.message}`);
    try {
      if (page) {
        const screenshotPath = path.join(process.cwd(), "shopee_error_screenshot.png");
        await page.screenshot({ path: screenshotPath });
        log(`[Browser] \u0110\xE3 ch\u1EE5p \u1EA3nh m\xE0n h\xECnh l\u1ED7i l\u01B0u t\u1EA1i: ${screenshotPath}`);
      }
    } catch (err) {
      log(`[Browser] Kh\xF4ng th\u1EC3 ch\u1EE5p \u1EA3nh m\xE0n h\xECnh l\u1ED7i: ${err.message}`);
    }
  } finally {
    if (browser) {
      log("[Browser] \u0110ang t\u1EF1 \u0111\u1ED9ng \u0111\xF3ng tr\xECnh duy\u1EC7t...");
      await browser.close();
    }
  }
}
async function sendTelegramNotification(sku, modelName, productName, shopeeProductId, isNew, onProgress) {
  const log = (msg) => {
    console.log(msg);
    if (onProgress) onProgress(msg);
  };
  try {
    const enabledSetting = await prisma.setting.findUnique({ where: { key: "telegram_notify_enabled" } });
    const isEnabled = enabledSetting?.value === "true";
    if (!isEnabled) {
      return;
    }
    const tokenSetting = await prisma.setting.findUnique({ where: { key: "telegram_bot_token" } });
    const chatIdSetting = await prisma.setting.findUnique({ where: { key: "telegram_chat_id" } });
    const botToken = tokenSetting?.value?.trim();
    const chatId = chatIdSetting?.value?.trim();
    if (!botToken || !chatId) {
      log("[Telegram] Thi\u1EBFu c\u1EA5u h\xECnh Telegram Bot Token ho\u1EB7c Chat ID. B\u1ECF qua th\xF4ng b\xE1o.");
      return;
    }
    const statusText = isNew ? "\u0110\u0102NG M\u1EDAI S\u1EA2N PH\u1EA8M \u{1F195}" : "C\u1EACP NH\u1EACT BI\u1EBEN TH\u1EC2 \u270F\uFE0F";
    const linkProduct = `https://shopee.vn/product/${shopeeProductId}`;
    const timeStr = (/* @__PURE__ */ new Date()).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    const message = `\u{1F514} <b>[HOROLOGIST] \u0110\u1ED2NG B\u1ED8 TH\xC0NH C\xD4NG!</b>
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F3F7}\uFE0F <b>Tr\u1EA1ng th\xE1i:</b> ${statusText}
\u231A <b>SKU K\xEDch ho\u1EA1t:</b> <code>${sku}</code>
\u{1F4C1} <b>D\xF2ng m\xE1y:</b> <code>${modelName}</code>
\u{1F4DD} <b>T\xEAn SEO:</b> ${productName}
\u{1F6D2} <b>Shopee Product ID:</b> <code>${shopeeProductId}</code>
\u{1F517} <a href="${linkProduct}">Link s\u1EA3n ph\u1EA9m tr\xEAn Shopee</a>
\u23F0 <b>Th\u1EDDi gian:</b> ${timeStr}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: false
      })
    });
    if (response.ok) {
      log(`[Telegram] \u2705 \u0110\xE3 g\u1EEDi th\xF4ng b\xE1o Telegram cho SKU: ${sku}`);
    } else {
      const errText = await response.text();
      log(`[Telegram] \u26A0\uFE0F G\u1EEDi th\xF4ng b\xE1o th\u1EA5t b\u1EA1i (HTTP ${response.status}): ${errText}`);
    }
  } catch (e) {
    log(`[Telegram] L\u1ED7i g\u1EEDi th\xF4ng b\xE1o Telegram: ${e.message}`);
  }
}
async function testTelegramNotification(botToken, chatId) {
  try {
    const timeStr = (/* @__PURE__ */ new Date()).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    const message = `\u{1F514} <b>[HOROLOGIST] K\u1EBET N\u1ED0I TH\xC0NH C\xD4NG!</b>
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4F1} \u0110\xE2y l\xE0 tin nh\u1EAFn th\u1EED nghi\u1EC7m t\u1EEB c\xF4ng c\u1EE5 <b>Horologist Shopee Manager</b>.
\u2705 Telegram Bot c\u1EE7a b\u1EA1n \u0111\xE3 \u0111\u01B0\u1EE3c c\u1EA5u h\xECnh ch\xEDnh x\xE1c v\xE0 s\u1EB5n s\xE0ng nh\u1EADn th\xF4ng b\xE1o t\u1EF1 \u0111\u1ED9ng.
\u23F0 <b>Th\u1EDDi gian:</b> ${timeStr}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML"
      })
    });
    if (response.ok) {
      return { success: true, message: "\u0110\xE3 g\u1EEDi tin nh\u1EAFn test th\xE0nh c\xF4ng! H\xE3y ki\u1EC3m tra \u0111i\u1EC7n tho\u1EA1i c\u1EE7a b\u1EA1n." };
    } else {
      const errText = await response.text();
      return { success: false, message: `L\u1ED7i t\u1EEB Telegram (HTTP ${response.status}): ${errText}` };
    }
  } catch (e) {
    return { success: false, message: `L\u1ED7i k\u1EBFt n\u1ED1i: ${e.message}` };
  }
}
async function startFullAutoSyncBackground(prioritySku = null) {
  const pushLog = (msg) => {
    global.autoSyncLogs = global.autoSyncLogs || [];
    global.autoSyncLogs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  };

  try {
    pushLog("🚀 Bắt đầu tiến trình Full Auto Sync Background...");
    global.shouldStopAutoSync = false;

    const cookiesSetting = await prisma.setting.findUnique({ where: { key: 'shopee_cookies' } });
    pushLog("DEBUG: Đã lấy xong cookies");
    if (!cookiesSetting || !cookiesSetting.value) {
      pushLog("❌ LỖI: Chưa cấu hình Cookies Shopee!");
      return;
    }

    const whereClause = { isAvatar: true };
    if (prioritySku) whereClause.sku = { startsWith: prioritySku };

    pushLog(`DEBUG: Đang query variants với where: ${JSON.stringify(whereClause)}`);
    const avtVariants = await prisma.variant.findMany({
      where: whereClause,
      include: { model: true }
    });
    pushLog(`DEBUG: Đã lấy xong variants`);

    pushLog(`🔍 Tìm thấy ${avtVariants.length} nhóm biến thể (AVT) cần xử lý.`);

    let processedAvts = 0;
    for (let i = 0; i < avtVariants.length; i++) {
      if (global.shouldStopAutoSync) {
        pushLog("🛑 Tiến trình đã bị DỪNG theo yêu cầu của user.");
        break;
      }
      const avt = avtVariants[i];
      const model = avt.model;

      pushLog(`--------------------------------------------------`);
      pushLog(`⏳ Bắt đầu xử lý Nhóm AVT ${i + 1}/${avtVariants.length}: ${avt.sku}...`);

      if (avt.shopeeProductId) {
        pushLog(`⏭️ Đã có Shopee ID (${avt.shopeeProductId}). Bỏ qua cập nhật cho nhóm ${avt.sku}!`);
        processedAvts++;
        continue;
      }

      let retries = 0;
      let success = false;
      while (!success && retries < 10) {
        try {
          let avatarPath = "";
          if (avt.avatarImage && fs.existsSync(avt.avatarImage)) {
            avatarPath = avt.avatarImage;
          } else {
            pushLog(`❌ LỖI: Chưa generate Avatar cho biến thể AVT ${avt.sku}! Hãy chạy Tạo logo.`);
            break;
          }

          pushLog(`⏳ Đang tải/kiểm tra dữ liệu Media từ Google Drive cho ${avt.sku} (Lần thử ${retries + 1})...`);
          const media = await prepareMediaForShopee(model.name, avt.sku, avatarPath, pushLog);

          pushLog(`⏳ Đang mở trình duyệt đăng bài Shopee cho nhóm ${avt.sku}...`);
          const productName = await generateShopeeProductName(avt.id, model.name);

          await runShopeeAutomationDemo(cookiesSetting.value, productName, avt.shopeeProductId || "", media, avt.id, pushLog);

          pushLog(`✅ Nhóm AVT ${avt.sku} đã đồng bộ xong!`);
          processedAvts++;
          success = true;
        } catch (err) {
          retries++;
          pushLog(`❌ Lỗi khi xử lý AVT ${avt.sku} (Lần ${retries}/10): ${err.message}`);
          if (retries < 10) {
            pushLog(`🔄 Hệ thống sẽ tự động refresh và thử lại sau 5 giây...`);
            await new Promise(res => setTimeout(res, 5000));
          } else {
            pushLog(`⚠️ Đã thử 10 lần vẫn lỗi. Bỏ qua AVT ${avt.sku}.`);
          }
        }
      }
    }
    pushLog(`🎉 HOÀN TẤT Full Auto Sync. Đã xử lý thành công ${processedAvts}/${avtVariants.length} nhóm AVT.`);
  } catch (err) {
    pushLog(`❌ LỖI NGHIÊM TRỌNG: ${err.message}`);
  }
}


export {
  startFullAutoSyncBackground,
  exportIgnoredReport,
  filterAndReportVariants,
  generateShopeeProductName,
  prepareMediaForShopee,
  runShopeeAutomationDemo,
  sendTelegramNotification,
  testTelegramNotification
};
