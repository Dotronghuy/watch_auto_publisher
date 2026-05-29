import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import sharp from 'sharp';
import { getFolderIdByName, getImagesInFolder, getVideosInFolder, downloadFileFromDrive, getFoldersInFolder } from './drive.service.js';
import { getProductInfoBySku, updateProductPostInfo, getAllProductsPostInfo, clearExpiredPostInfo } from './sheet.service.js';
import { getPostedImageIds, addPostedImageId } from '../utils/history.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateBackgroundOnChatGPT, generateTextOnGemini } from './playwright.service.js';
import { publishToInstagram, publishCarouselToInstagram, publishFBReels, publishIGReels } from './meta.service.js';
import { addMusicToVideo } from './video.service.js';
import { addActivity } from '../utils/activity.js';
import { liveLog } from '../utils/liveLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, '../config/settings.json');
const geminiTemplatePath = path.join(__dirname, '../../config/gemini-prompt-template.md');

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://127.0.0.1:5678/webhook-test/test-ai';
const ROOT_DRIVE_FOLDER_ID = process.env.ROOT_DRIVE_FOLDER_ID || '1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl';

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

export const autoPublishRoutine = async () => {
  isRoutineRunning = true;

  const checkAbort = () => {
    if (globalStopController.signal.aborted) {
      const err = new Error('Luồng bị dừng theo yêu cầu của người dùng.');
      err.name = 'AbortError';
      throw err;
    }
  };

  liveLog('🤖 Bắt đầu tiến trình tự động đăng bài...', 'info', 'System');

  const cleanTempDirectory = () => {
    const tempDir = path.join(__dirname, '../../temp_images');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        if (file !== '.gitkeep') {
          try {
            fs.unlinkSync(path.join(tempDir, file));
          } catch (e) { }
        }
      }
    }
  };

  let localFilePaths = [];

  try {
    const skuFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
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
      liveLog('⚠️ Tất cả các mã SKU đang trong thời gian chờ (Cooldown). Không có mã nào hợp lệ!', 'error', 'Google Sheets');
      throw new Error('Tất cả các mã SKU đang trong thời gian chờ (Cooldown). Không có mã nào hợp lệ để đăng!');
    }

    // Trộn ngẫu nhiên danh sách hợp lệ
    const shuffledSkus = eligibleSkus.sort(() => 0.5 - Math.random());

    const folderTypes = ['0_Anh_AVT', '1_Anh_Hang', '2_Anh_Tu_Chup', '3_Video_Doc'];
    let selectedImages = [];
    let selectedSku = null;
    let postMode = 'SINGLE'; // SINGLE (AI), ALBUM, hoặc REELS

    // Tìm ảnh/video chưa đăng
    for (const skuFolder of shuffledSkus) {
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
            selectedImages = freshMedia.sort(() => 0.5 - Math.random()).slice(0, numToPick);
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
    let postContent = '';
    let fbContent = '';
    let igContent = '';
    try {
      const productInfo = await getProductInfoBySku(selectedSku.name);
      const productInfoText = productInfo ? Object.entries(productInfo).map(([k, v]) => `${k}: ${v}`).join('\n') : '';

      // 3.1 NẾU LÀ CHẾ ĐỘ AI -> Gọi ChatGPT vẽ nền (Sinh 4-6 ảnh)
      let aiGeneratedImagePaths = [];
      if (postMode === 'AI' && localFilePaths.length === 1) {
        try {
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
                return `This is a luxury watch with transparent background (background already removed). Composite this exact watch into the following lifestyle scene:\n\n${sceneText}\n\n${genderNote}\n\nCRITICAL RULES:\n- Do NOT redraw, redesign, or modify the watch in any way.\n- Keep the watch dial, hands, case, bracelet, brand text, and colors EXACTLY as in the provided image.\n- Lighting must be consistent between the watch and the environment.\n- Output: photorealistic, 4K commercial product photography quality.`;
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

          aiGeneratedImagePaths = await generateBackgroundOnChatGPT(localFilePaths[0], imgPromptsArray, globalStopController.signal);

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
          console.log(`⚠️ Lỗi Playwright tạo ảnh: ${pwError.message}. Sẽ đăng ảnh gốc.`);
        }
      }

      // 3.2 ĐỌC TEMPLATE VÀ GỌI GEMINI ĐỂ VIẾT CONTENT
      try {
        console.log(`🤖 [Nhánh ${postMode}] Gửi ảnh sang Gemini để viết Content...`);

        // Detect giới tính từ SKU để điền vào template
        const skuUp = (selectedSku?.name || '').toUpperCase();
        let genderLabel = 'Unisex';
        if (/\dG$|G\d|\dG\d/.test(skuUp)) genderLabel = 'Nam (Male)';
        else if (/\dL$|L\d|\dL\d/.test(skuUp)) genderLabel = 'Nữ (Female)';

        // Đọc và parse template từ file .md
        let fbPromptFinal = null;
        let igPromptFinal = null;
        let reelsPromptFinal = null;

        if (fs.existsSync(geminiTemplatePath)) {
          const templateRaw = fs.readFileSync(geminiTemplatePath, 'utf8');

          // Đọc thêm tài liệu hướng dẫn phụ (nếu có upload)
          let additionalContext = '';
          const marketingPath = path.join(__dirname, '../../config/watch-marketing-content.md');
          if (fs.existsSync(marketingPath)) {
            additionalContext += `\n\n--- QUY TẮC MARKETING BỔ SUNG ---\n${fs.readFileSync(marketingPath, 'utf8')}`;
          }
          const personaPath = path.join(__dirname, '../../config/customer-persona.md');
          if (fs.existsSync(personaPath)) {
            additionalContext += `\n\n--- CHÂN DUNG KHÁCH HÀNG BỔ SUNG ---\n${fs.readFileSync(personaPath, 'utf8')}`;
          }

          // Hàm điền placeholder vào template và nhúng tài liệu
          const fillTemplate = (tmpl) => tmpl
            .replace(/\{\{SKU\}\}/g, selectedSku.name)
            .replace(/\{\{PRODUCT_INFO\}\}/g, productInfoText || 'Không có thông tin')
            .replace(/\{\{GENDER\}\}/g, genderLabel) + additionalContext;

          // Parse section FB_AND_IG
          const fbIgMatch = templateRaw.match(/## FB_AND_IG_PROMPT_TEMPLATE\s*\n([\s\S]*?)(?=\n---\n## |\n## REELS_|$)/);
          if (fbIgMatch) fbPromptFinal = fillTemplate(fbIgMatch[1].trim());

          // Parse section REELS
          const reelsMatch = templateRaw.match(/## REELS_PROMPT_TEMPLATE\s*\n([\s\S]*?)(?=\n---\n## |$)/);
          if (reelsMatch) reelsPromptFinal = fillTemplate(reelsMatch[1].trim());

          console.log(`📋 [Gemini] Đã đọc template từ gemini-prompt-template.md (gender: ${genderLabel})`);
        } else {
          console.log(`⚠️ Không tìm thấy gemini-prompt-template.md, dùng prompt dự phòng.`);
        }

        let targetImgPathForGemini = null;
        if (postMode === 'AI') {
          targetImgPathForGemini = localFilePaths[Math.floor(Math.random() * localFilePaths.length)];
        } else {
          targetImgPathForGemini = localFilePaths[0]; // Nhánh thường: lấy ảnh đầu tiên
        }
        let tempImgDownloaded = null;

        if (postMode === 'REELS') {
          // REELS: Dùng REELS template (hoặc fallback)
          const reelsFallback = `Hãy đóng vai TikTok creator. Viết caption ngắn giật tít cho video Reels giới thiệu đồng hồ SKU ${selectedSku.name}. Chỉ trả về caption, dùng hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival và các hashtag trending.`;
          const reelsPrompt = reelsPromptFinal || reelsFallback;

          // Tìm ảnh mẫu để gửi Gemini cho REELS
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

          const reelsContent = await generateTextOnGemini(reelsPrompt, targetImgPathForGemini);
          fbContent = reelsContent;
          igContent = reelsContent; // Reels dùng chung 1 caption

        } else {
          // POST THƯỜNG: Dùng FB_AND_IG template — Gemini trả về 2 section
          const fallbackPrompt = `Hãy viết 2 bài theo đúng format:\n## FACEBOOK:\n[Bài FB 80-150 từ, sang trọng, có hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival]\n## INSTAGRAM:\n[Caption IG 15-35 từ, góc nhìn KHÁC bài FB, có hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival]\nSản phẩm: đồng hồ SKU ${selectedSku.name}. Không kèm giải thích.`;
          const combinedPrompt = fbPromptFinal || fallbackPrompt;

          const combinedOutput = await generateTextOnGemini(combinedPrompt, targetImgPathForGemini);

          // Parse FB và IG từ output của Gemini
          // Hỗ trợ nhiều dạng format: ## FACEBOOK:, **FACEBOOK:**, FACEBOOK:, # FACEBOOK:
          const fbMatch2 = combinedOutput.match(/(?:#{1,3}\s*|\*{0,2})FACEBOOK:?\*{0,2}\s*\n([\s\S]*?)(?=\n(?:#{1,3}\s*|\*{0,2})INSTAGRAM:?|$)/i);
          const igMatch2 = combinedOutput.match(/(?:#{1,3}\s*|\*{0,2})INSTAGRAM:?\*{0,2}\s*\n([\s\S]*?)$/i);

          if (fbMatch2 && igMatch2) {
            fbContent = fbMatch2[1].trim();
            igContent = igMatch2[1].trim();
            console.log(`✅ [Gemini] Parse thành công: FB (${fbContent.length} ký tự) | IG (${igContent.length} ký tự)`);
          } else {
            // Fallback: nếu không parse được, tách thủ công theo từ khóa INSTAGRAM
            console.log(`⚠️ [Gemini] Regex chính không match. Output gốc: ${combinedOutput.substring(0, 200)}...`);
            const splitIdx = combinedOutput.search(/INSTAGRAM/i);
            if (splitIdx !== -1) {
              // Tìm dòng sau chữ INSTAGRAM:
              const afterIG = combinedOutput.slice(splitIdx).replace(/^INSTAGRAM:?\s*/i, '');
              const beforeIG = combinedOutput.slice(0, splitIdx).replace(/^.*?FACEBOOK:?\s*/is, '');
              fbContent = beforeIG.trim() || combinedOutput;
              igContent = afterIG.trim() || combinedOutput;
              console.log(`⚠️ [Gemini] Dùng fallback split: FB (${fbContent.length} ký tự) | IG (${igContent.length} ký tự)`);
            } else {
              fbContent = combinedOutput;
              igContent = combinedOutput;
              console.log(`⚠️ [Gemini] Không tìm thấy INSTAGRAM — dùng chung 1 nội dung.`);
            }
          }
        }

        // Xóa ảnh tạm nếu có dùng cho REELS
        if (tempImgDownloaded && fs.existsSync(tempImgDownloaded)) {
          fs.unlinkSync(tempImgDownloaded);
        }

        postContent = fbContent; // postContent = FB content (dùng cho Facebook)

      } catch (geminiError) {
        // Nếu lỗi do lệnh STOP → dừng ngay, không tiếp tục
        if (globalStopController.signal.aborted) {
          liveLog('⏹️ Đã dừng tiến trình Gemini theo yêu cầu.', 'error', 'System');
          throw geminiError;
        }
        console.log(`⚠️ Lỗi Playwright Gemini: ${geminiError.message}. Dùng nội dung dự phòng.`);
        fbContent = `[Đăng Tự Động] Khám phá ngay siêu phẩm đồng hồ ${selectedSku.name} tuyệt đẹp. #iwcarnivalvietnam #iwcarnival #donghoiwcarnival`;
        igContent = fbContent;
        postContent = fbContent;
      }

    } catch (e) {
      // Nếu lỗi do lệnh STOP → dừng ngay
      if (globalStopController.signal.aborted) {
        liveLog('⏹️ Tiến trình đã bị dừng hoàn toàn.', 'error', 'System');
        throw e;
      }
      console.log(`⚠️ Lỗi trích xuất thông tin: ${e.message}. Dùng nội dung dự phòng.`);
      postContent = `[Đăng Tự Động] Siêu phẩm đồng hồ ${selectedSku.name}.`;
    }

    // 5. Đăng Facebook
    const pageToken = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!pageToken) throw new Error('Thiếu FB_PAGE_ACCESS_TOKEN');

    let postId = null;
    
    // Hàm trợ giúp để tính toán thời gian delay IG
    const getIgDelayMs = () => {
      try {
        if (fs.existsSync(settingsPath)) {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          // Nếu đang ở chế độ test thì KHÔNG áp dụng IG delay
          if (settings.mode === 'test') return 0;
          const min = parseInt(settings.igDelayMin) || 0;
          const max = parseInt(settings.igDelayMax) || min;
          if (min <= 0) return 0;
          const randomMinutes = min + Math.random() * (max - min);
          return Math.round(randomMinutes * 60 * 1000);
        }
      } catch (e) {}
      return 0; // Mặc định 0 nếu lỗi (không chờ)
    };
    
    // Hàm sleep hỗ trợ AbortSignal - có thể bị dừng giữa chừng
    const sleep = (ms, abortSignal) => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          clearTimeout(timer);
          const err = new Error('Sleep bị dừng theo yêu cầu.');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      }
    });

    if (postMode === 'REELS') {
      let finalVideoPath = localFilePaths[0];
      const musicDir = path.join(process.cwd(), 'music_library');

      // CHÈN NHẠC VÀO VIDEO NẾU CÓ
      if (fs.existsSync(musicDir)) {
          const musicFiles = fs.readdirSync(musicDir).filter(f => f.toLowerCase().endsWith('.mp3'));
          if (musicFiles.length > 0) {
              const randomMusic = musicFiles[Math.floor(Math.random() * musicFiles.length)];
              const musicPath = path.join(musicDir, randomMusic);
              const mixedVideoPath = finalVideoPath.replace('.mp4', `_mixed_${Date.now()}.mp4`);
              
              console.log(`🎧 Đã bốc trúng bài nhạc: ${randomMusic}`);
              try {
                  finalVideoPath = await addMusicToVideo(finalVideoPath, musicPath, mixedVideoPath);
              } catch (e) {
                  console.log(`⚠️ Bỏ qua chèn nhạc do lỗi FFmpeg: ${e.message}`);
              }
          } else {
              console.log(`⚠️ Thư mục music_library trống, sẽ đăng video gốc.`);
          }
      }

      // ĐĂNG VIDEO REELS LÊN FACEBOOK
      postId = await publishFBReels(finalVideoPath, postContent);

      // ĐĂNG VIDEO REELS LÊN INSTAGRAM (Bơm thẳng file nội bộ)
      try {
         const delayMs = getIgDelayMs();
         if (delayMs > 0) {
             liveLog(`⏳ Đang chờ ${(delayMs / 60000).toFixed(2)} phút trước khi đẩy video sang IG (Chống spam)...`, 'typing', 'System');
             await sleep(delayMs, globalStopController.signal);
         }
         
         console.log(`🚀 Đang đẩy trực tiếp Video từ ổ cứng sang IG Reels...`);
         
         // Thêm vòng lặp Retry phòng khi IG bị lỗi máy chủ nội bộ
         let igSuccess = false;
         for (let i = 1; i <= 3; i++) {
             try {
                 await publishIGReels(finalVideoPath, igContent);
                 igSuccess = true;
                 break; // Thành công thì thoát vòng lặp
             } catch (igErr) {
                 console.log(`⚠️ IG báo lỗi (Lần thử ${i}/3): ${igErr.message}`);
                 if (i < 3) {
                     console.log(`⏳ Đợi 15 giây rồi thử lại...`);
                     await new Promise(r => setTimeout(r, 15000));
                 }
             }
         }
         
         if (!igSuccess) {
             console.log(`❌ Đã thử 3 lần nhưng IG vẫn từ chối xử lý video này.`);
         }
      } catch (e) {
        console.log(`⚠️ Lỗi không xác định khi đăng IG Reels: ${e.message}`);
      }

      // XÓA FILE VIDEO ĐÃ ĐƯỢC CHÈN NHẠC (ĐỂ TRÁNH RÁC Ổ CỨNG)
      if (finalVideoPath !== localFilePaths[0] && fs.existsSync(finalVideoPath)) {
          fs.unlinkSync(finalVideoPath);
      }

    } else if (localFilePaths.length === 1) {
      // ĐĂNG 1 ẢNH (SINGLE POST)
      const fbFormData = new FormData();
      fbFormData.append('source', fs.createReadStream(localFilePaths[0]));
      fbFormData.append('message', postContent);
      fbFormData.append('access_token', pageToken);

      const fbResponse = await axios.post(`https://graph.facebook.com/v19.0/me/photos`, fbFormData, {
        headers: { ...fbFormData.getHeaders() }
      });
      postId = fbResponse.data.post_id;

      // Lấy Public URL của ảnh vừa đăng để dùng cho Instagram
      try {
        const photoId = fbResponse.data.id;
        const imgMetaRes = await axios.get(`https://graph.facebook.com/v19.0/${photoId}`, {
          params: { fields: 'images', access_token: pageToken }
        });
        const publicUrl = imgMetaRes.data.images[0].source;
        console.log(`✅ Lấy thành công Public URL từ FB để đẩy sang IG: ${publicUrl}`);

        // Đăng lên Instagram với IG content riêng
        const delayMs = getIgDelayMs();
        if (delayMs > 0) {
            liveLog(`⏳ Đang chờ ${(delayMs / 60000).toFixed(2)} phút trước khi đẩy ảnh sang IG...`, 'typing', 'System');
            await sleep(delayMs, globalStopController.signal);
        }
        await publishToInstagram(igContent, publicUrl);
      } catch (igErr) {
        console.log(`⚠️ Lỗi khi đăng 1 ảnh lên Instagram: ${igErr.response?.data?.error?.message || igErr.message}`);
      }

    } else {
      // ĐĂNG ALBUM (MULTI-PHOTO)
      console.log(`Đang tải lên ${localFilePaths.length} ảnh ẩn để tạo Album FB...`);
      const attachedMedia = [];
      const publicUrls = [];

      for (const filePath of localFilePaths) {
        const fbFormData = new FormData();
        fbFormData.append('source', fs.createReadStream(filePath));
        fbFormData.append('published', 'false'); // Ảnh ẩn
        fbFormData.append('access_token', pageToken);

        const uploadRes = await axios.post(`https://graph.facebook.com/v19.0/me/photos`, fbFormData, {
          headers: { ...fbFormData.getHeaders() }
        });
        const photoId = uploadRes.data.id;
        attachedMedia.push({ media_fbid: photoId });

        // Trích xuất Public URL cho Instagram
        try {
          const imgMetaRes = await axios.get(`https://graph.facebook.com/v19.0/${photoId}`, {
            params: { fields: 'images', access_token: pageToken }
          });
          publicUrls.push(imgMetaRes.data.images[0].source);
        } catch (e) {
          console.log(`⚠️ Lỗi trích xuất link ảnh ẩn FB: ${e.message}`);
        }
      }

      console.log(`Đã tạo xong các ID ảnh FB. Bắt đầu đăng bài Feed...`);
      const feedRes = await axios.post(`https://graph.facebook.com/v19.0/me/feed`, {
        message: postContent,
        attached_media: attachedMedia,
        access_token: pageToken
      });
      postId = feedRes.data.id;

      // Đăng lên Instagram Carousel
      if (publicUrls.length >= 2) {
        try {
          const delayMs = getIgDelayMs();
          if (delayMs > 0) {
              liveLog(`⏳ Đang chờ ${(delayMs / 60000).toFixed(2)} phút trước khi đẩy Album sang IG...`, 'typing', 'System');
              await sleep(delayMs, globalStopController.signal);
          }
          console.log(`✅ Đang đẩy ${publicUrls.length} ảnh sang Instagram Carousel (nội dung IG riêng)...`);
          await publishCarouselToInstagram(igContent, publicUrls);
        } catch (igErr) {
          console.log(`⚠️ Lỗi đăng Carousel Instagram: ${igErr.response?.data?.error?.message || igErr.message}`);
        }
      }
    }

    console.log(`✅ Đã đăng thành công lên FB (Post ID: ${postId})`);
    
    // Đẩy lịch sử lên giao diện Dashboard
    addActivity(`Đăng thành công sản phẩm ${selectedSku.name} lên Fanpage!`, 'success');

    // Lưu Post ID và Ngày đăng lên Google Sheets
    await updateProductPostInfo(selectedSku.name, postId);

    // 6. Lưu ID tất cả ảnh vào lịch sử
    for (const img of selectedImages) {
      await addPostedImageId(img.id);
    }

    // 7. Dọn sạch toàn bộ thư mục temp_images để tránh tích tụ file rác (ảnh gốc, rmbg, resize, chatgpt...)
    cleanTempDirectory();

    return { success: true, postId: postId, sku: selectedSku.name };

  } catch (error) {
    // Dọn rác nếu lỗi
    cleanTempDirectory();
    console.error('❌ Tiến trình tự động thất bại:', error.response?.data || error.message);
    throw error;
  } finally {
    isRoutineRunning = false; // Luôn reset trạng thái khi kết thúc (dù thành công, lỗi hay bị abort)
  }
};
