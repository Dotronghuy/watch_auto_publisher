import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { liveLog } from '../utils/liveLog.js';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

chromium.use(stealth());

// ─── ANTI-BOT: Hành vi giả lập người thật ───
const humanBehavior = {
  // Mô phỏng đường cong Bezier cho di chuột người thật
  async bezierMouseMove(page, startX, startY, endX, endY) {
    try {
      const steps = Math.floor(Math.random() * 15) + 15; // 15-30 steps
      const controlX = startX + (endX - startX) / 2 + (Math.random() * 200 - 100);
      const controlY = startY + (endY - startY) / 2 + (Math.random() * 200 - 100);
      
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // Ease-out (giảm tốc khi đến đích)
        const easeT = 1 - Math.pow(1 - t, 3);
        const x = Math.pow(1 - easeT, 2) * startX + 2 * (1 - easeT) * easeT * controlX + Math.pow(easeT, 2) * endX;
        const y = Math.pow(1 - easeT, 2) * startY + 2 * (1 - easeT) * easeT * controlY + Math.pow(easeT, 2) * endY;
        await page.mouse.move(x, y);
        await page.waitForTimeout(Math.floor(Math.random() * 10) + 5);
      }
      // Khựng lại/overshoot một chút
      if (Math.random() > 0.7) {
        await page.mouse.move(endX + (Math.random() * 10 - 5), endY + (Math.random() * 10 - 5));
        await page.waitForTimeout(Math.floor(Math.random() * 50) + 50);
        await page.mouse.move(endX, endY);
      }
    } catch (e) {}
  },
  // Di chuột ngẫu nhiên trên trang (giống người đọc nội dung)
  async randomMouseMove(page) {
    try {
      const startX = Math.floor(Math.random() * 800) + 100;
      const startY = Math.floor(Math.random() * 400) + 100;
      const endX = Math.floor(Math.random() * 900) + 100;
      const endY = Math.floor(Math.random() * 500) + 100;
      await this.bezierMouseMove(page, startX, startY, endX, endY);
    } catch (e) {}
  },
  // Cuộn trang ngẫu nhiên lên/xuống
  async randomScroll(page) {
    try {
      const direction = Math.random() > 0.3 ? 1 : -1; // 70% cuộn xuống
      const distance = Math.floor(Math.random() * 300) + 50;
      await page.mouse.wheel(0, direction * distance);
      await page.waitForTimeout(Math.floor(Math.random() * 500) + 200);
    } catch (e) {}
  },
  // Nghỉ ngơi giữa các ảnh (giả lập người xem kết quả)
  async thinkingPause(page) {
    const pauseMs = Math.floor(Math.random() * 5000) + 3000; // 3-8 giây
    console.log(`🧠 [Anti-Bot] Nghỉ ${Math.round(pauseMs/1000)}s giữa các ảnh (giả lập xem kết quả)...`);
    await page.waitForTimeout(pauseMs);
    await humanBehavior.randomMouseMove(page);
    await page.waitForTimeout(Math.floor(Math.random() * 1000) + 500);
    await humanBehavior.randomScroll(page);
  },
  // Combo hành vi ngẫu nhiên trong lúc chờ ChatGPT vẽ
  async idleBehavior(page) {
    const roll = Math.random();
    if (roll < 0.3) await humanBehavior.randomMouseMove(page);
    else if (roll < 0.5) await humanBehavior.randomScroll(page);
    // 50% không làm gì (như người thật ngồi chờ)
  }
};

export class Mutex {
    constructor() {
        this.queue = [];
        this.locked = false;
    }
    lock() {
        return new Promise(resolve => {
            if (this.locked) {
                this.queue.push(resolve);
            } else {
                this.locked = true;
                resolve();
            }
        });
    }
    unlock() {
        if (this.queue.length > 0) {
            const nextResolve = this.queue.shift();
            nextResolve();
        } else {
            this.locked = false;
        }
    }
    isLocked() {
        return this.locked;
    }
}
export const aiMutex = new Mutex();
export const isAiIdle = () => !aiMutex.isLocked();
// ─── GEMINI API FALLBACK (Dùng khi toggle BẬT, thay thế Playwright) ───
async function callGeminiAPIDirectly(prompt, images = []) {
  const geminiSetting = await prisma.setting.findUnique({ where: { key: 'gemini_api_key' } });
  const geminiKeys = (geminiSetting?.value || '').split(',').map(k => k.trim()).filter(k => k !== '');
  if (geminiKeys.length === 0) throw new Error('Không có Gemini API Key nào được cấu hình!');
  
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  
  for (let i = 0; i < geminiKeys.length; i++) {
    let retryCount = 1;
    while (true) {
      try {
        const ai = new GoogleGenerativeAI(geminiKeys[i]);
        const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const parts = [prompt, ...images.map(img => ({ inlineData: { data: img.data, mimeType: img.mimeType } }))];
        const result = await model.generateContent(parts);
        return result.response.text().trim();
      } catch (error) {
        if (error.message?.includes('429') || error.message?.includes('503')) {
          console.warn(`[API Fallback] Gemini Key ${i + 1} bận. Retry ${retryCount}/3...`);
          await new Promise(r => setTimeout(r, 5000));
          retryCount++;
          if (retryCount > 3) break;
          continue;
        }
        console.error(`[API Fallback] Lỗi Gemini Key ${i + 1}:`, error.message);
        break;
      }
    }
  }
  throw new Error('Tất cả Gemini API Key đều không khả dụng.');
}

const getRandomSampleImageLocal = () => {
    try {
        const sampleDir = path.join(__dirname, '../../config/sample_images');
        if (!fs.existsSync(sampleDir)) return null;
        const validExt = ['.jpg', '.jpeg', '.png', '.webp'];
        const files = fs.readdirSync(sampleDir).filter(f => validExt.includes(path.extname(f).toLowerCase()));
        if (files.length === 0) return null;
        return path.join(sampleDir, files[Math.floor(Math.random() * files.length)]);
    } catch (e) {
        return null;
    }
};

const settingsPath = path.join(__dirname, '../../config/settings.json');
const getSettingValue = (key) => {
    try {
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            return settings[key] || null;
        }
    } catch(e) {}
    return null;
};
const getAiTaskUrl = (type) => {
    try {
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            return settings.aiTasks?.[type] || null;
        }
    } catch(e) {}
    return null;
};
const updateAiTaskUrl = (type, url) => {
    try {
        let settings = { aiTasks: {} };
        if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
        if (!settings.aiTasks) settings.aiTasks = {};
        
        let chatId = url;
        if (url && url.includes('/c/')) {
            chatId = url.split('/c/')[1];
        }
        settings.aiTasks[type] = chatId;
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('Error saving URL', e);
    }
};
const buildProjectChatUrl = (projectUrl, chatId) => {
    if (!chatId) return projectUrl;
    if (chatId.startsWith('http')) return chatId;
    const projectBase = String(projectUrl || '').replace(/\/project\/?$/, '');
    if (projectBase.includes('/g/')) return `${projectBase}/c/${chatId}`;
    return `https://chatgpt.com/c/${chatId}`;
};

const isBrowserClosedError = (error) => {
    return /Target page, context or browser has been closed|Browser has been closed|Page closed|Context closed/i.test(error?.message || '');
};

const WATCH_STRAP_INTEGRITY_GUARD = `[MANDATORY WATCH STRAP INTEGRITY RULE]
- First identify the exact bracelet/strap material, shape, width, stitching, texture, and color from Image 1. Preserve Image 1's bracelet/strap even if the scene/sample image shows a different steel bracelet, leather strap, rubber strap, or silicone strap.
- If Image 1 has a leather, rubber, or silicone strap, render it as one continuous full-length strap from both lugs. Do not let the strap stop abruptly near the case, fade into the background, merge into fabric/skin, become a short stump, or get cropped by the frame.
- For flat lay, table, fabric, product-only, or any non-wrist scene, show both strap halves naturally extended/resting on the surface with visible length beyond the case. If needed, zoom out or adjust placement so the strap ends remain inside the image.
- For wrist scenes, both strap halves must attach cleanly, wrap naturally, and continue around the wrist without broken, cut, or missing sections.
- Never copy the sample image's bracelet material over Image 1. Product accuracy from Image 1 has priority over matching the sample watch.`;

const withWatchStrapIntegrityGuard = (prompt = '') => {
    const text = String(prompt || '');
    if (text.includes('[MANDATORY WATCH STRAP INTEGRITY RULE]')) return text;
    return `${text}\n\n${WATCH_STRAP_INTEGRITY_GUARD}`;
};

export const generateBackgroundOnChatGPT = async (imagePath, promptsArray, abortSignal = null, sampleImagePath = null, isNewSession = true, extraWatchImages = []) => {
    // ── Toggle Check: Tạo Ảnh AI ──
    // BẬT (true) = Bỏ qua Playwright, dùng ảnh gốc (vì Gemini API không sinh ảnh được)
    // TẮT (false/default) = Giữ Playwright ChatGPT Plus như cũ
    try {
      const allowImage = await prisma.setting.findUnique({ where: { key: 'gemini_allow_image' } });
      if (allowImage && allowImage.value === 'true') {
        console.log('[Toggle] ✅ Tạo Ảnh AI chuyển sang chế độ API → Bỏ qua Playwright, trả về ảnh gốc.');
        return imagePath ? [imagePath] : [];
      }
    } catch (e) { /* ignore, proceed with Playwright */ }

    console.log('\n--- BẮT ĐẦU TIẾN TRÌNH PLAYWRIGHT ---');
    await aiMutex.lock();
    const userDataDir = path.join(__dirname, '../../chrome_data_chatgpt');
    
    console.log('🚀 Khởi động trình duyệt ảo (Sử dụng Persistent Profile)...');
    let context = null;
    let page = null;
    let isClosingContext = false;
    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            args: [
                '--window-position=-999,-999',
                '--window-size=1280,720',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-sandbox'
            ],
            viewport: { width: 1280, height: 720 }
        });
        context.on('close', () => {
            if (!isClosingContext) {
                console.error('⚠️ ChatGPT Chromium context đã đóng bất ngờ khi automation vẫn đang chạy.');
                liveLog('⚠️ Cửa sổ ChatGPT/Chromium đã đóng bất ngờ khi automation vẫn đang chạy.', 'error', 'ChatGPT');
            }
        });
        page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
        
        // Anti-fingerprint nâng cao (Xóa Webdriver)
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.navigator.chrome = { runtime: {} };
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        });
        
        let targetUrl = getSettingValue('chatGptProjectUrl') || 'https://chatgpt.com/g/g-p-6a472fac29a08191bc9914d5a8c451ac/project';
        let savedChatId = null;
        if (!isNewSession) {
            savedChatId = getAiTaskUrl('imageChatUrl');
            if (savedChatId) {
                targetUrl = buildProjectChatUrl(targetUrl, savedChatId);
            }
        }
        console.log(`🌐 Đang truy cập ${targetUrl}...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        
        // Kiểm tra xem đã đăng nhập chưa
        await page.waitForTimeout(3000); // Chờ trang tải các nút bấm
        const isLoggedOut = await page.isVisible('text="Log in"');
        if (isLoggedOut) {
            console.log('⚠️ BẠN CHƯA ĐĂNG NHẬP CHATGPT! Trình duyệt sẽ dừng lại để bạn thao tác.');
            console.log('⏳ Vui lòng đăng nhập vào tài khoản Plus trên trình duyệt đang mở (Bạn có 3 phút)...');
            
            for (let i = 0; i < 36; i++) {
                if (abortSignal && abortSignal.aborted) throw new Error('Abort requested');
                await page.waitForTimeout(5000);
                const loggedIn = await page.isVisible('#prompt-textarea') || await page.isVisible('div[contenteditable="true"]');
                if (loggedIn) {
                    console.log('✅ Đã phát hiện đăng nhập thành công!');
                    break;
                }
                if (i === 35) throw new Error('Hết thời gian chờ đăng nhập!');
            }
        }
        
        // Đảm bảo ô nhập prompt đã sẵn sàng
        const PROMPT_SELECTORS = [
            '#prompt-textarea',
            'div[contenteditable="true"][data-lexical-editor]',
            'div[contenteditable="true"]',
            'p[data-placeholder]',
        ];

        let promptLocator = null;
        console.log('🔍 Đang tìm ô nhập liệu ChatGPT (timeout 10 phút)...');
        
        // Thử tìm tối đa 10 phút (20 lần x 30 giây mỗi lần)
        for (let retry = 0; retry < 20; retry++) {
            for (const sel of PROMPT_SELECTORS) {
                try {
                    await page.waitForSelector(sel, { state: 'visible', timeout: 8000 });
                    promptLocator = page.locator(sel).first();
                    console.log(`✅ Tìm thấy ô nhập liệu bằng selector: ${sel}`);
                    break;
                } catch (e) {
                    // Selector không tìm thấy, thử cái tiếp theo
                }
            }
            
            if (promptLocator) break;
            
            if (retry < 19) {
                console.log(`⚠️ Lần thử ${retry + 1}/20: Không tìm thấy ô nhập liệu. Đang reload trang...`);
                try {
                    await page.reload({ waitUntil: 'domcontentloaded' });
                    await page.waitForTimeout(10000);
                } catch (e) {
                    console.log('⚠️ Reload thất bại, thử lại...');
                    await page.waitForTimeout(5000);
                }
            }
        }

        if (!promptLocator) {
            throw new Error('Không tìm thấy ô nhập liệu ChatGPT sau 10 phút! Giao diện có thể đã thay đổi hoặc tài khoản chưa đăng nhập.');
        }

        const outputPaths = [];
        // Biến maxY được khai báo ngoài vòng lặp và cập nhật sau mỗi ảnh thành công
        let globalMaxY = 0;
        
        const count = promptsArray.length;
        let fullRetryCountForImage = 0;
        for (let i = 0; i < count; i++) {
            console.log(`\n--- VẼ ẢNH ${i + 1}/${count} ---`);
            if (abortSignal?.aborted) throw new Error('aborted');

            // Nghỉ lâu hơn giữa các ảnh để giảm lỗi nghẽn/rate limit của ChatGPT image tool.
            if (i > 0) {
                const delayMs = Math.floor(Math.random() * (110000 - 70000 + 1)) + 70000; // Random 70s - 110s
                console.log(`⏳ Đang nghỉ ngẫu nhiên ${Math.round(delayMs / 1000)} giây để tránh bị ChatGPT chặn vì gửi liên tục...`);
                await page.waitForTimeout(delayMs);

                // Làm mới promptLocator ở mỗi vòng để tránh stale reference sau thời gian chờ
                promptLocator = null;
                for (const sel of PROMPT_SELECTORS) {
                    try {
                        await page.waitForSelector(sel, { state: 'visible', timeout: 5000 });
                        promptLocator = page.locator(sel).first();
                        console.log(`✅ [Ảnh ${i + 1}] Đã làm mới promptLocator với selector: ${sel}`);
                        break;
                    } catch (e) {}
                }
                if (!promptLocator) {
                    console.log(`⚠️ [Ảnh ${i + 1}] Không tìm thấy ô nhập liệu. Dừng mẻ ảnh.`);
                    liveLog(`⚠️ Ảnh ${i + 1}: Không tìm thấy ô nhập liệu ChatGPT. Đã dừng mẻ ảnh.`, 'error', 'ChatGPT');
                    throw new Error(`Không tìm thấy ô nhập liệu ChatGPT cho ảnh ${i + 1}. Dừng mẻ ảnh để tránh nhảy sang prompt tiếp theo.`);
                }
            }

            const currentPromptObj = promptsArray[i];
            const isString = typeof currentPromptObj === 'string';
            const currentPrompt = isString ? currentPromptObj : currentPromptObj.prompt;
            const promptSampleImage = isString ? null : currentPromptObj.sampleImage;
            const promptMode = isString ? null : currentPromptObj.mode;

            let currentSampleImage = null;
            if (promptSampleImage && fs.existsSync(promptSampleImage)) {
                currentSampleImage = promptSampleImage;
            } else if (i === 0 && sampleImagePath && fs.existsSync(sampleImagePath)) {
                currentSampleImage = sampleImagePath;
            } else if (i > 0) {
                currentSampleImage = getRandomSampleImageLocal();
            }

            console.log('📤 Bắt đầu tải ảnh lên bằng cách mô phỏng click như người thật...');
            const filesToUpload = [];
            const copyToUniqueTemp = (srcPath) => {
                const ext = path.extname(srcPath);
                const newPath = path.join(__dirname, `../../temp_images/upload_${Date.now()}_${Math.floor(Math.random()*1000000)}${ext}`);
                fs.copyFileSync(srcPath, newPath);
                return newPath;
            };

            // Ảnh 1: Ảnh AVT sản phẩm (nền trắng/trong suốt)
            if (imagePath && fs.existsSync(imagePath)) filesToUpload.push(copyToUniqueTemp(imagePath));
            
            // Ảnh 2-5: Ảnh tham khảo thực tế từ Drive (đủ 4 góc độ)
            if (extraWatchImages && extraWatchImages.length > 0) {
                for (const extraImg of extraWatchImages) {
                    if (fs.existsSync(extraImg)) {
                        filesToUpload.push(copyToUniqueTemp(extraImg));
                        console.log(`✅ Đã chọn kèm ảnh tham khảo Drive: ${path.basename(extraImg)}`);
                    }
                }
            }
            
            // Ảnh 6: Ảnh bố cục mẫu (scene/background mẫu muốn tạo ra)
            if (currentSampleImage && fs.existsSync(currentSampleImage)) {
                filesToUpload.push(copyToUniqueTemp(currentSampleImage));
                console.log(`✅ Đã chọn kèm ảnh bố cục mẫu (${path.basename(currentSampleImage)})`);
            }
            
            if (filesToUpload.length > 0) {
                try {
                    console.log('👆 Đang click nút (+) để chọn "Đính kèm ảnh & tệp"...');
                    
                    // Kích hoạt lắng nghe sự kiện mở File Chooser của hệ điều hành (thêm catch để tránh unhandled rejection)
                    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null);
                    
                    // Lắc chuột một chút để mô phỏng người
                    try { await page.mouse.move(500, 500); await page.waitForTimeout(200); } catch (e) {}

                    // Tìm và click nút (+)
                    const attachBtn = page.locator('button[aria-label*="Attach"], button[aria-label*="Đính kèm"]').last();
                    await attachBtn.waitFor({ state: 'visible', timeout: 5000 });
                    await attachBtn.click();
                    await page.waitForTimeout(800);
                    
                    // Tìm và click menu "Đính kèm ảnh & tệp" / "Upload from computer"
                    const uploadMenu = page.locator('div[role="menuitem"]:has-text("Đính kèm ảnh & tệp"), div[role="menuitem"]:has-text("Upload from computer")').first();
                    if (await uploadMenu.isVisible({ timeout: 5000 })) {
                        await uploadMenu.click();
                    } else {
                        console.log('⚠️ Không thấy menu "Đính kèm ảnh", thử rà qua các menu con...');
                        const fallbackMenu = page.locator('div[role="menuitem"]').first();
                        if (await fallbackMenu.isVisible()) await fallbackMenu.click();
                    }
                    
                    // Cung cấp file cho hộp thoại File Chooser bật lên
                    const fileChooser = await fileChooserPromise;
                    if (fileChooser) {
                        await fileChooser.setFiles(filesToUpload);
                        console.log(`✅ Đã đính kèm ${filesToUpload.length} file ảnh bằng cách click menu như người thật.`);
                    } else {
                        throw new Error('Không bắt được sự kiện chọn file.');
                    }
                    
                } catch (err) {
                    console.log(`⚠️ Lỗi click menu upload: ${err.message}. Đang chuyển về cách backup (nhét file ẩn)...`);
                    const inputs = await page.$$('input[type="file"]');
                    if (inputs.length > 0) {
                        const activeInput = inputs[inputs.length - 1];
                        await activeInput.setInputFiles(filesToUpload);
                        console.log(`✅ Đã chọn ${filesToUpload.length} file ảnh bằng cách ẩn.`);
                    }
                }
            }
            
            // Chờ ảnh tải lên hiện thành thumbnail (5 giây cho ổn định)
            await page.waitForTimeout(5000);

            // Xử lý popup Duplicate File nếu có (tránh lỗi intercept pointer events)
            // Dùng nhiều selector vì UI ChatGPT có thể thay đổi, timeout 3 giây thay vì 1 giây
            try {
                const duplicateSelectors = [
                    '#modal-duplicate-file',
                    '[data-testid="duplicate-file-modal"]',
                    '[role="dialog"]:has-text("duplicate")',
                    '[role="dialog"]:has-text("already")',
                    '[role="alertdialog"]',
                ];
                for (const modalSel of duplicateSelectors) {
                    try {
                        const duplicateModal = page.locator(modalSel).first();
                        if (await duplicateModal.isVisible({ timeout: 500 })) {
                            console.log(`⚠️ Phát hiện popup chặn (${modalSel}), đang xử lý...`);
                            const confirmBtn = duplicateModal.locator('button.btn-primary, button:has-text("Replace"), button:has-text("OK"), button:has-text("Confirm")').first();
                            if (await confirmBtn.isVisible({ timeout: 1000 })) {
                                await confirmBtn.click();
                            } else {
                                await page.keyboard.press('Escape');
                            }
                            await page.waitForTimeout(1500);
                            break;
                        }
                    } catch (e) {}
                }
            } catch (e) {}

            console.log(`✍️ Đang gõ prompt số ${i + 1}...`);
            await promptLocator.click();
            await page.waitForTimeout(300);
            
            let finalPrompt;
            const isDirectTwoImageEditPrompt = promptMode === 'direct_two_image_edit';
            if (isDirectTwoImageEditPrompt) {
                finalPrompt = currentPrompt;
            } else {
                const hasExtraRefs = (extraWatchImages && extraWatchImages.length > 0);
                if (currentSampleImage && hasExtraRefs) {
                finalPrompt = `I am sending you ${1 + extraWatchImages.length + 1} images in this EXACT order:
- IMAGE 1: The luxury watch with transparent/white background — this is the MAIN PRODUCT.
- IMAGE 2 to ${1 + extraWatchImages.length}: REAL PRODUCT PHOTOS from different angles. Use these as REFERENCE to understand the watch's TRUE colors, textures, bracelet style, dial details, and proportions.
- LAST IMAGE (IMAGE ${1 + extraWatchImages.length + 1}): A lifestyle/scene reference photo — this is the DESIRED SCENE/BACKGROUND COMPOSITION you must recreate.

YOUR TASK: Place the watch from Image 1 into the scene shown in the LAST IMAGE. Use Image 2-${1 + extraWatchImages.length} as visual reference to ensure the watch looks exactly like the real product.

STRICT RULES:
1. IGNORE ALL PREVIOUS IMAGES IN THIS CHAT. Only use the images attached to THIS message.
2. KEEP the watch design from Image 1 100% identical — do NOT change the dial, bezel, hands, brand text, bracelet, or colors.
3. KEEP the background, lighting, atmosphere from the LAST IMAGE exactly as shown. DO NOT invent a new background.
4. The watch must be naturally integrated — correct lighting angle, realistic shadow, proper scale.
5. Output: photorealistic, high-end commercial photography quality, 4K.

Scene constraint:
${currentPrompt}`;
            } else if (currentSampleImage) {
                finalPrompt = `I am sending you TWO images:
- IMAGE 1 (first image): The luxury watch with a transparent/white background — this is the PRODUCT to feature.
- IMAGE 2 (second image): A real lifestyle reference photo — this is the SCENE/BACKGROUND to use.

YOUR TASK: Place the watch from Image 1 onto the wrist or surface in Image 2's scene. The final result must look like a real professional product photo.

STRICT RULES:
1. IGNORE ALL PREVIOUS IMAGES IN THIS CHAT. YOU MUST ONLY USE IMAGE 1 AS THE PRODUCT.
2. KEEP the watch design from Image 1 100% identical — do NOT change the dial, bezel, hands, brand text, bracelet, or colors in any way.
3. KEEP the background, lighting, atmosphere, and composition from Image 2 exactly as the original. DO NOT invent a new background.
4. The watch must be naturally integrated — correct lighting angle, realistic shadow, proper scale.
5. Output: photorealistic, high-end commercial photography quality, 4K.

Scene constraint for this specific image:
${currentPrompt}`;
            } else {
                finalPrompt = `I am sending you ONE image (the watch).
CRITICAL RULES:
1. IGNORE ALL PREVIOUS IMAGES IN THIS CHAT. Use ONLY the attached image.
2. KEEP the watch design 100% identical.
3. Place it in this exact scene: ${currentPrompt}`;
            }
            }

            finalPrompt = withWatchStrapIntegrityGuard(finalPrompt);

            if (!isDirectTwoImageEditPrompt) {
                finalPrompt += `\n\n[ANTI-DUPLICATE INSTRUCTION]: This is image request #${i + 1}. You MUST generate a completely NEW, UNIQUE image. Do NOT output the exact same image as previous generations. Vary the precise camera angle, lighting, or background element placement slightly to ensure uniqueness. Unique Seed: ${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
            }
            
            // XÓA BỎ KÝ TỰ \r (Carriage Return) ĐỂ TRÁNH LỖI ẤN ENTER SỚM TRÊN WINDOWS
            finalPrompt = finalPrompt.replace(/\r/g, '');
            
            await promptLocator.fill(''); // Xóa text cũ nếu có
            await page.waitForTimeout(200);
            
            // Xử lý xuống dòng: Gõ từng dòng và dùng Shift+Enter để xuống dòng (tránh bị gửi nhầm do gõ Enter)
            // NÂNG CẤP ANTI-BOT: Thêm di chuột ngẫu nhiên và tốc độ gõ chậm, ngẫu nhiên y hệt người thật
            try {
                const box = await promptLocator.boundingBox();
                if (box) {
                    const startX = Math.floor(Math.random() * 500) + 100;
                    const startY = Math.floor(Math.random() * 300) + 100;
                    const targetX = box.x + box.width / 2 + (Math.random() * 20 - 10);
                    const targetY = box.y + box.height / 2 + (Math.random() * 10 - 5);
                    await humanBehavior.bezierMouseMove(page, startX, startY, targetX, targetY);
                    await page.waitForTimeout(300);
                    await page.mouse.click(targetX, targetY);
                    await page.waitForTimeout(500);
                }
            } catch (e) {}

            // TỐI ƯU GÕ PHÍM: Sử dụng lệnh paste nhanh để tiết kiệm thời gian
            const typingPortion = finalPrompt;
            
            console.log(`⏩ Đang dán (paste) toàn bộ prompt vào ô nhập liệu...`);
            await promptLocator.fill(typingPortion);
            await page.waitForTimeout(500);
            
            // Gõ thêm 1 dấu cách để kích hoạt event listener của React (phòng hờ fill không nhận dạng sự kiện)
            await page.keyboard.type(' ');
            await page.waitForTimeout(500);
            
            // Chờ 3-7s cho ổn định sau khi dán xong (random, không cố định)
            await page.waitForTimeout(Math.floor(Math.random() * 4000) + 3000);
            // Di chuột ngẫu nhiên trước khi gửi
            await humanBehavior.randomMouseMove(page);
            
            console.log('🚀 Nhấn phím Enter để gửi yêu cầu...');
            
            try {
                if (!isNewSession && i === 0) {
                    await page.waitForTimeout(3000);
                    const currentUrl = page.url();
                    if (currentUrl.includes('/c/')) {
                        console.log(`🔗 Đã lưu URL cuộc trò chuyện TẠO ẢNH: ${currentUrl}`);
                        updateAiTaskUrl('imageChatUrl', currentUrl);
                    }
                }
            } catch (e) {}

            // Chỉ dùng phím Enter theo yêu cầu
            await page.keyboard.press('Enter');
            
            console.log(`⏳ Đang chờ ChatGPT vẽ ảnh ${i + 1} (có thể mất 60-100 giây)...`);
            
            let targetImgSrc = null;
            const GENERATED_IMAGE_MIN_AREA = 30000;
            const MAX_IMAGE_WAIT_ATTEMPTS = 96; // 8 phút, tránh false timeout khi ChatGPT vẽ chậm.
            
            // Scroll xuống cuối trang chat trước khi quét để đảm bảo tìm đúng ảnh cũ
            try {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(500);
            } catch (e) {}
            
            // Lấy src của ảnh cũ cuối cùng trong DOM để so sánh
            let lastOldImageSrc = null;
            try {
                const existingImages = await page.evaluate((minArea) => {
                    const valid = Array.from(document.images).filter(img => {
                        const isUi = !img.src || img.src.includes('avatar') || img.src.includes('favicon') || img.src.startsWith('data:image/svg');
                        const rect = img.getBoundingClientRect();
                        return !isUi && (rect.width * rect.height) >= minArea;
                    });
                    return valid.map(img => img.currentSrc || img.src);
                }, GENERATED_IMAGE_MIN_AREA);
                if (existingImages.length > 0) {
                    lastOldImageSrc = existingImages[existingImages.length - 1];
                }
            } catch (e) {}
            console.log(`📍 Src ảnh cũ cuối cùng: ${lastOldImageSrc ? lastOldImageSrc.substring(0, 40) + '...' : 'Không có'}`);

            let imageRetryCount = 0;
            let lastTryAgainMs = 0;
            let chatgptFailureDetected = false;
            let firstGeneratingMs = 0; // Timestamp lần đầu phát hiện "One last tweak" / "Đang tạo ảnh"
            for (let attempt = 0; attempt < MAX_IMAGE_WAIT_ATTEMPTS; attempt++) {
                if (abortSignal && abortSignal.aborted) throw new Error('Abort requested');
                await page.waitForTimeout(5000);
                // Anti-bot: Thỉnh thoảng di chuột/cuộn trang trong lúc chờ
                if (attempt > 0 && attempt % 3 === 0) await humanBehavior.idleBehavior(page);

                // ── Detect "Image generation failed" từ ChatGPT ──
                // Chỉ kiểm tra sau 20 giây kể từ lần click "Try again" cuối cùng.
                if (Date.now() - lastTryAgainMs > 20000) {
                    try {
                        const errorLocator = page.getByText(/Image generation failed|Something went wrong|Tạo ảnh không thành công|Đã ngừng suy nghĩ|unable to generate the image|encountered an error|we experienced an error|stopped thinking/i).last();
                        const retryButtonCandidates = [
                            page.getByRole('button', { name: /try again|regenerate|thử lại|tạo lại/i }).last(),
                            page.locator('button:has-text("Try again"), button:has-text("Regenerate"), button:has-text("Thử lại"), button[aria-label*="Try again"], button[aria-label*="Regenerate"], button[aria-label*="Thử lại"], button[data-testid*="regenerate"], button[data-testid*="retry"]').last(),
                            // Nhắm chính xác vào biểu tượng mũi tên xoay tròn (Reload/Regenerate) bằng hình dạng SVG hoặc nút cuối cùng trong tin nhắn
                            page.locator('button:has(svg path[d*="17.65"]), button:has(svg.icon-md-refresh), button:has(svg path[d^="M12 4V1L7.5 5.5"])').last(),
                            page.locator('[data-message-author-role="assistant"]').last().locator('button').last()
                        ];
                        let tryAgainBtn = null;
                        for (const candidate of retryButtonCandidates) {
                            if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
                                tryAgainBtn = candidate;
                                break;
                            }
                        }

                        const hasFailureText = await errorLocator.isVisible({ timeout: 500 }).catch(() => false);
                        if (hasFailureText || tryAgainBtn) {
                            imageRetryCount++;
                            if (imageRetryCount > 2) {
                                chatgptFailureDetected = true;
                                console.log(`❌ Ảnh ${i + 1} đã thất bại sau ${imageRetryCount - 1} lần thử lại. Dừng mẻ ảnh.`);
                                liveLog(`❌ Ảnh ${i + 1}: ChatGPT tạo ảnh thất bại sau 2 lần thử lại. Đã dừng mẻ ảnh.`, 'error', 'ChatGPT');
                                break;
                            }
                            console.log(`⚠️ ChatGPT báo lỗi tạo ảnh. Đang nhấn Try again... (lần ${imageRetryCount}/2)`);
                            liveLog(`⚠️ Ảnh ${i + 1}: ChatGPT tạo ảnh thất bại. Đang thử lại lần ${imageRetryCount}/2...`, 'warning', 'ChatGPT');

                            // Tìm và nhấn nút "Try again" ở message mới nhất
                            try {
                                if (tryAgainBtn) {
                                    await tryAgainBtn.scrollIntoViewIfNeeded();
                                    await tryAgainBtn.waitFor({ state: 'visible', timeout: 3000 });
                                    await tryAgainBtn.click({ force: true });
                                    console.log('🔄 Đã nhấn "Try again". Chờ ChatGPT vẽ lại...');
                                    lastTryAgainMs = Date.now();
                                    await page.waitForTimeout(3000);
                                } else {
                                    console.log('⚠️ Không tìm thấy nút Try again. Thử gửi lại Enter...');
                                    await page.keyboard.press('Enter');
                                    lastTryAgainMs = Date.now();
                                    await page.waitForTimeout(3000);
                                }
                            } catch (btnErr) {
                                console.log('⚠️ Lỗi khi nhấn Try again:', btnErr.message);
                            }
                            continue;
                        }
                    } catch (e) {}
                }


                // ── Detect lỗi từ chối Content Policy ──
                try {
                    // ChatGPT trả lời văn bản ở div cuối cùng thay vì vẽ ảnh
                    const refusalTexts = ['i cannot', 'i\'m sorry', 'i am sorry', 'violate policy', 'i can\'t generate', 'không thể', 'xin lỗi', 'chính sách'];
                    const assistantMessages = await page.$$('div[data-message-author-role="assistant"]');
                    if (assistantMessages.length > 0) {
                        const lastMsg = assistantMessages[assistantMessages.length - 1];
                        const text = (await lastMsg.innerText() || '').toLowerCase();
                        const isRefusal = refusalTexts.some(word => text.includes(word));
                        if (isRefusal && text.length < 500 && !text.includes('đang tạo ảnh') && !text.includes('generating')) {
                            console.log('⚠️ Phát hiện ChatGPT từ chối tạo ảnh (Content Policy/Safety):', text.substring(0, 100).replace(/\n/g, ' '));
                            liveLog(`⚠️ Ảnh ${i + 1}: AI từ chối tạo ảnh: "${text.substring(0, 50).replace(/\n/g, ' ')}..."`, 'error', 'ChatGPT');
                            chatgptFailureDetected = true;
                            break; // Thoát vòng lặp chờ ảnh để skip mẻ này
                        }
                    }
                } catch (e) {}
                
                // Quét tìm ảnh có tọa độ Y lớn hơn ảnh cũ
                try {
                    const isStillGenerating = await page.getByText(/One last tweak|Creating image|Generating image|Making image|Đang tạo ảnh|Đang chỉnh/i).last().isVisible({ timeout: 300 }).catch(() => false);
                    
                    if (isStillGenerating) {
                        if (firstGeneratingMs === 0) firstGeneratingMs = Date.now();
                        const stuckSeconds = Math.round((Date.now() - firstGeneratingMs) / 1000);
                        
                        if (attempt > 0 && attempt % 6 === 0) {
                            console.log(`⏳ ChatGPT vẫn đang render ảnh ${i + 1} ("One last tweak...") đã ${stuckSeconds}s. Tiếp tục chờ...`);
                        }
                        
                        // Nếu kẹt quá 3 phút → Hủy chờ, tạo chat mới
                        if (stuckSeconds > 180 && Date.now() - lastTryAgainMs > 30000) {
                            chatgptFailureDetected = true;
                            console.log(`❌ Ảnh ${i + 1} bị kẹt "One last tweak" quá 3 phút. Dừng chờ để tạo Chat mới...`);
                            liveLog(`⚠️ Ảnh ${i + 1}: Kẹt tiến trình vẽ quá lâu. Chuẩn bị tạo Chat mới...`, 'warning', 'ChatGPT');
                            break;
                        }
                    } else {
                        firstGeneratingMs = 0; // Reset nếu không còn generating
                    }

                    const scanResult = await page.evaluate(({ minArea, oldSrc }) => {
                        const all = Array.from(document.images).map((img) => {
                            const rect = img.getBoundingClientRect();
                            const src = img.currentSrc || img.src || '';
                            const area = rect.width * rect.height;
                            const isUi = !src || src.includes('avatar') || src.includes('favicon') || src.startsWith('data:image/svg');
                            return {
                                src,
                                area,
                                width: rect.width,
                                height: rect.height,
                                isUi
                            };
                        });

                        const validImages = all.filter((img) => !img.isUi && img.area >= minArea);

                        // Lấy ảnh cuối cùng trong DOM (ảnh mới nhất luôn được append vào cuối)
                        const lastValid = validImages.length > 0 ? validImages[validImages.length - 1] : null;

                        let target = null;
                        if (lastValid && lastValid.src !== oldSrc) {
                            target = lastValid;
                        }

                        return {
                            target,
                            total: all.length,
                            validCount: validImages.length,
                            bestVisible: lastValid
                        };
                    }, {
                        minArea: GENERATED_IMAGE_MIN_AREA,
                        oldSrc: lastOldImageSrc
                    });

                    if (scanResult.target) {
                        targetImgSrc = scanResult.target.src;
                        console.log(`✅ Đã chộp được ảnh mới vẽ (Kích thước: ${Math.round(scanResult.target.area)} px²)`);
                    } else if (attempt > 0 && attempt % 6 === 0) {
                        const best = scanResult.bestVisible;
                        const bestText = best ? `${Math.round(best.width)}x${Math.round(best.height)} area=${Math.round(best.area)}` : 'none';
                        console.log(`🔎 Chưa thấy ảnh mới hợp lệ: total=${scanResult.total}, valid=${scanResult.validCount}, lastImg=${bestText}`);
                    }
                } catch (e) {}
                
                if (targetImgSrc) break;
            }
            
            if (!targetImgSrc) {
                if (fullRetryCountForImage < 1) { // Cho phép thử lại toàn bộ 1 lần
                    fullRetryCountForImage++;
                    console.log(`❌ Ảnh ${i + 1} bị lỗi/kẹt. Đang mở CHAT MỚI để thử lại từ đầu (Lần 2)...`);
                    liveLog(`⚠️ Ảnh ${i + 1} lỗi. Đang tạo Chat mới và gửi lại yêu cầu vẽ ảnh...`, 'warning', 'ChatGPT');
                    
                    try {
                        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
                        await page.waitForTimeout(8000); // Chờ chat mới tải
                        
                        // Tìm lại ô nhập liệu
                        promptLocator = null;
                        for (let retry = 0; retry < 5; retry++) {
                            for (const sel of PROMPT_SELECTORS) {
                                try {
                                    await page.waitForSelector(sel, { state: 'visible', timeout: 5000 });
                                    promptLocator = page.locator(sel).first();
                                    break;
                                } catch (e) {}
                            }
                            if (promptLocator) break;
                            await page.waitForTimeout(3000);
                        }
                    } catch (e) {
                        console.log('⚠️ Lỗi khi mở chat mới:', e.message);
                    }
                    
                    i--; // Lùi biến i để vòng lặp chạy lại đúng ảnh này
                    continue; // Bỏ qua đoạn lưu ảnh bên dưới, quay lại đầu vòng lặp
                } else {
                    const reason = chatgptFailureDetected
                        ? 'ChatGPT báo lỗi tạo ảnh sau nhiều lần thử lại'
                        : imageRetryCount > 0 
                        ? `ChatGPT tạo ảnh thất bại sau ${imageRetryCount} lần thử` 
                        : 'Không tìm thấy ảnh sau 8 phút chờ';
                    console.log(`❌ Dừng mẻ ảnh tại ảnh ${i + 1}: ${reason}`);
                    
                    if (outputPaths.length > 0) {
                        console.log(`⚠️ Đã tạo thành công ${outputPaths.length} ảnh trước đó. Bỏ qua các ảnh lỗi và sử dụng số ảnh này để tiếp tục đăng bài...`);
                        liveLog(`⚠️ Đã tạo được ${outputPaths.length}/${count} ảnh. Chấp nhận kết quả và đi tiếp...`, 'info', 'System');
                        break; // Thoát vòng lặp tạo ảnh, trả về các ảnh đã thành công
                    } else {
                        liveLog(`❌ Ảnh ${i + 1}: ${reason}. Đã tạo chat mới nhưng vẫn thất bại. Dừng mẻ ảnh.`, 'error', 'ChatGPT');
                        throw new Error(`Dừng mẻ ảnh tại ảnh ${i + 1}: ${reason}`);
                    }
                }
            }
            
            // Nếu thành công, reset biến đếm retry để dùng cho ảnh tiếp theo
            fullRetryCountForImage = 0;
            
            // Wait to fully load
            await page.waitForTimeout(2000);
            
            console.log('📥 Đang tải ảnh xuống máy...');
            const imageResponse = await page.evaluate(async (url) => {
                const res = await fetch(url);
                const blob = await res.blob();
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            }, targetImgSrc);
            
            const base64Data = imageResponse.split(',')[1];
            const rawBuffer = Buffer.from(base64Data, 'base64');
            const outputPath = path.join(__dirname, `../../temp_images/chatgpt_gen_${Date.now()}.png`);
            // Xóa sạch metadata AI (C2PA/IPTC/EXIF) để Facebook không gắn tag "Có dùng AI"
            const cleanBuffer = await sharp(rawBuffer).png().toBuffer();
            fs.writeFileSync(outputPath, cleanBuffer);
            console.log(`✅ Đã lưu ảnh ${i + 1} thành công (đã xóa metadata AI): ${path.basename(outputPath)}`);
            
            outputPaths.push(outputPath);
            
            // Anti-bot: Nghỉ ngơi giữa các ảnh (nếu còn ảnh tiếp theo)
            if (i < count - 1) {
                await humanBehavior.thinkingPause(page);
            }
            
            // Không cần cập nhật globalMaxY nữa vì đã dùng thuộc tính src để quét ảnh mới
        }
        
        if (count > 0 && outputPaths.length === 0) {
            throw new Error('ChatGPT không tạo được ảnh nào trong mẻ này. Dừng tiến trình để tránh chạy tiếp khi không có ảnh AI.');
        }

        console.log('✅ Hoàn thành tiến trình vẽ mẻ ảnh!');
        return outputPaths;

    } catch (error) {
        console.error('\n❌ LỖI TRONG TIẾN TRÌNH PLAYWRIGHT:');
        console.error(error.message);
        if (isBrowserClosedError(error)) {
            throw new Error('Chromium/ChatGPT browser đã bị đóng hoặc crash trong lúc tạo ảnh. Hãy restart server và không đóng cửa sổ ChatGPT đang chạy automation.');
        }
        throw error;
    } finally {
        if (context) {
            try {
                isClosingContext = true;
                await context.close();
            } catch (e) { console.error('⚠️ Lỗi khi đóng browser:', e.message); }
        }
        aiMutex.unlock();
    }
};

export const generateContentOnChatGPT = async (prompt, type, imagePath = null) => {
    // ── Toggle Check: Viết Content bằng API thay vì Playwright ──
    try {
      const allowContent = await prisma.setting.findUnique({ where: { key: 'gemini_allow_content' } });
      if (allowContent && allowContent.value === 'true') {
        console.log('[Toggle] ✅ Viết Content MXH bằng Gemini API (thay Playwright)...');
        let images = [];
        if (imagePath && fs.existsSync(imagePath)) {
          const base64Data = fs.readFileSync(imagePath, { encoding: 'base64' });
          const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
          images.push({ data: base64Data, mimeType });
        }
        const result = await callGeminiAPIDirectly(prompt, images);
        console.log('[Toggle] ✅ Đã nhận content từ Gemini API thành công!');
        return result;
      }
    } catch (e) {
      console.warn('[Toggle] ⚠️ Lỗi gọi Gemini API, fallback về Playwright:', e.message);
    }

    console.log('\n--- BẮT ĐẦU TIẾN TRÌNH PLAYWRIGHT (CHATGPT TEXT) ---');
    await aiMutex.lock();
    const userDataDir = path.join(__dirname, '../../chrome_data_chatgpt');
    
    console.log('🚀 Khởi động trình duyệt ảo (ChatGPT Text Profile)...');
    let context = null;
    let page = null;
    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            args: ['--window-position=-999,-999', '--window-size=1280,720'],
            viewport: { width: 1280, height: 720 }
        });
        page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
        // Luôn sử dụng URL gốc của Dự án Content AI (Bảo đảm 100% chạy trong Dự án)
        let targetUrl = getSettingValue('chatGptContentProjectUrl') || 'https://chatgpt.com/g/g-p-6a472f6b41d48191a7d769ade350641d-content-watch-ai/project';
        
        console.log(`🌐 Đang truy cập Dự án Content AI: ${targetUrl}...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        
        await page.waitForTimeout(3000);
        
        const PROMPT_SELECTORS = [
            '#prompt-textarea',
            'div[contenteditable="true"][data-lexical-editor]',
            'div[contenteditable="true"]',
            'p[data-placeholder]',
        ];

        let promptLocator = null;
        for (const sel of PROMPT_SELECTORS) {
            try {
                await page.waitForSelector(sel, { state: 'visible', timeout: 5000 });
                promptLocator = page.locator(sel).first();
                break;
            } catch (e) {}
        }

        if (!promptLocator) {
            throw new Error('Không tìm thấy ô nhập liệu ChatGPT!');
        }

        if (imagePath && fs.existsSync(imagePath)) {
            console.log('📤 Đang đính kèm ảnh...');
            const inputs = await page.$$('input[type="file"]');
            if (inputs.length > 0) {
                const activeInput = inputs[inputs.length - 1];
                await activeInput.setInputFiles([imagePath]);
                await page.waitForTimeout(4000);
            }
        }

        // Xử lý popup Duplicate File nếu có
        try {
            const duplicateModal = page.locator('#modal-duplicate-file');
            if (await duplicateModal.isVisible({ timeout: 1000 })) {
                console.log('⚠️ Phát hiện popup "Duplicate File", đang xử lý...');
                const confirmBtn = duplicateModal.locator('button.btn-primary');
                if (await confirmBtn.isVisible()) {
                    await confirmBtn.click();
                } else {
                    await page.keyboard.press('Escape');
                }
                await page.waitForTimeout(1000);
            }
        } catch (e) {}

        console.log('✍️ Đang gõ prompt text...');
        await promptLocator.click();
        await page.waitForTimeout(300);
        await promptLocator.fill(''); // Xóa text cũ nếu có
        await page.waitForTimeout(200);
        await page.keyboard.insertText(prompt);
        await page.waitForTimeout(1000);
        
        // Kích hoạt sự kiện để nút Send mở khóa
        await page.keyboard.press('Space');
        await page.waitForTimeout(100);
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);
        
        try {
            const sendBtn = await page.waitForSelector('button[data-testid="send-button"]:not([disabled])', { timeout: 10000 });
            if (sendBtn) await sendBtn.click();
            else await page.keyboard.press('Enter');
        } catch (err) {
            await page.keyboard.press('Enter');
        }
        
        // Ghi nhớ URL nếu chưa có (lấy URL hiện tại sau khi nó chuyển hướng)
        await page.waitForTimeout(3000);
        const currentUrl = page.url();
        if (currentUrl.includes('/c/')) {
            const saveType = type === 'fb' ? 'fbChatUrl' : (type === 'ig' ? 'igChatUrl' : 'fbChatUrl');
            updateAiTaskUrl(saveType, currentUrl);
        }
        
        // Đánh dấu các tin nhắn cũ
        await page.evaluate(() => {
            document.querySelectorAll('div[data-message-author-role="assistant"]').forEach(el => {
                el.classList.add('already-processed-msg');
            });
        });
        
        console.log('⏳ Đang chờ ChatGPT viết nội dung...');
        
        for (let attempt = 0; attempt < 60; attempt++) {
            await page.waitForTimeout(5000);
            // Đợi cho đến khi ChatGPT không còn nút Stop generating nữa (tức là đã viết xong)
            try {
                const stopBtn = await page.$('button[data-testid="stop-button"]');
                if (stopBtn) continue; // Vẫn đang stream chữ
            } catch (e) {}
            
            // Lấy text mới nhất từ tin nhắn chưa đánh dấu
            const newMessages = await page.$$('div[data-message-author-role="assistant"]:not(.already-processed-msg)');
            if (newMessages.length > 0) {
                const lastMsg = newMessages[newMessages.length - 1];
                const text = await page.evaluate((el) => {
                    // ChatGPT để nội dung chính trong thẻ .markdown, các nút Edit/Copy nằm ngoài
                    const markdownDiv = el.querySelector('.markdown');
                    return markdownDiv ? markdownDiv.innerText : el.innerText;
                }, lastMsg);
                console.log('✅ Đã lấy xong nội dung!');
                return text.trim();
            }
        }

        throw new Error('Timeout chờ text');

    } catch (error) {
        console.error('❌ LỖI TRONG TIẾN TRÌNH PLAYWRIGHT TEXT:', error.message);
        return null;
    } finally {
        if (context) {
            try { await context.close(); } catch (e) { console.error('⚠️ Lỗi khi đóng browser:', e.message); }
        }
        aiMutex.unlock();
    }
};

// ─── PHÂN TÍCH ẢNH MẪU MỚI → SINH PROMPT → LƯU VÀO .MD ───
const ANALYZED_MANIFEST_PATH = path.join(__dirname, '../../config/analyzed_samples.json');

const getAnalyzedManifest = () => {
    try {
        if (fs.existsSync(ANALYZED_MANIFEST_PATH)) {
            return JSON.parse(fs.readFileSync(ANALYZED_MANIFEST_PATH, 'utf8'));
        }
    } catch (e) {}
    return { analyzed: [] };
};

const saveAnalyzedManifest = (manifest) => {
    fs.writeFileSync(ANALYZED_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
};

const getNextPromptId = (section) => {
    const promptGuidePath = path.join(__dirname, '../../config/gpt_image_prompt.md');
    if (!fs.existsSync(promptGuidePath)) return 1;
    const content = fs.readFileSync(promptGuidePath, 'utf8');
    // Tìm ID lớn nhất hiện có trong section (ví dụ: MALE-30, FEMALE-23, NEUTRAL-5)
    const prefix = section.toUpperCase();
    const regex = new RegExp(`${prefix}-(\\d+)`, 'g');
    let maxId = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const id = parseInt(match[1]);
        if (id > maxId) maxId = id;
    }
    return maxId + 1;
};

const appendPromptToMd = (section, id, titleVi, promptEn, imgFile) => {
    const promptGuidePath = path.join(__dirname, '../../config/gpt_image_prompt.md');
    if (!fs.existsSync(promptGuidePath)) return;

    let content = fs.readFileSync(promptGuidePath, 'utf8');
    const prefix = section.toUpperCase();
    const newBlock = `\n\n### ${prefix}-${id} — ${titleVi}\n**Sample Image:** ${imgFile || 'N/A'}\n**English instruction for GPT:**\n> ${promptEn}\n\n---\n`;

    // Tìm vị trí cuối của section để chèn vào
    // Section headers: ## [MALE], ## [FEMALE], ## [NEUTRAL]
    const sectionHeader = `## [${prefix}]`;
    const sectionIdx = content.indexOf(sectionHeader);
    
    if (sectionIdx === -1) {
        // Section không tồn tại, thêm vào cuối file
        content = content.trimEnd() + `\n\n${sectionHeader} AUTO-GENERATED\n${newBlock}`;
    } else {
        // Tìm section tiếp theo để biết giới hạn
        const nextSectionRegex = /\n## \[(?:MALE|FEMALE|NEUTRAL)\]/g;
        nextSectionRegex.lastIndex = sectionIdx + sectionHeader.length;
        const nextMatch = nextSectionRegex.exec(content);
        
        if (nextMatch) {
            // Chèn trước section tiếp theo
            content = content.slice(0, nextMatch.index) + newBlock + content.slice(nextMatch.index);
        } else {
            // Là section cuối, chèn vào cuối file
            content = content.trimEnd() + newBlock;
        }
    }

    fs.writeFileSync(promptGuidePath, content);
};

export const analyzeNewSampleImages = async () => {
    const sampleDir = path.join(__dirname, '../../config/sample_images');
    if (!fs.existsSync(sampleDir)) return { generated: 0, prompts: [] };

    const validExt = ['.jpg', '.jpeg', '.png', '.webp'];
    const allImages = fs.readdirSync(sampleDir).filter(f => validExt.includes(path.extname(f).toLowerCase()));
    
    const manifest = getAnalyzedManifest();
    const newImages = allImages.filter(f => !manifest.analyzed.includes(f));

    if (newImages.length === 0) {
        console.log('📸 Không có ảnh mẫu mới cần phân tích.');
        return { generated: 0, prompts: [] };
    }

    console.log(`\n📸 Phát hiện ${newImages.length} ảnh mẫu mới. Đang gửi cho ChatGPT phân tích...`);
    liveLog(`📸 Phát hiện ${newImages.length} ảnh mẫu mới. Đang gửi AI phân tích để sinh prompt...`, 'highlight', 'System');

    let context;
    let page;
    await aiMutex.lock();
    try {
        const userDataDir = path.join(__dirname, '../../chrome_data_chatgpt');
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            args: ['--window-position=-999,-999', '--window-size=1280,720'],
            viewport: { width: 1280, height: 720 },
            timeout: 60000 // 60s timeout
        });
        page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    } catch (err) {
        console.error('❌ Lỗi khởi động trình duyệt:', err.message);
        if (err.message.includes('lock')) {
            liveLog('❌ Lỗi: Trình duyệt đang bị khóa. Hãy tắt tính năng "Train Ảnh GPT" đang chạy trước khi phân tích ảnh mẫu!', 'error', 'System');
        } else {
            liveLog(`❌ Lỗi khởi động trình duyệt: ${err.message}`, 'error', 'System');
        }
        return { generated: 0, prompts: [] };
    }

    const generatedPrompts = [];

    try {
        // Mở ChatGPT session mới cho việc phân tích
        await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Kiểm tra đăng nhập
        const isLoggedOut = await page.isVisible('text="Log in"');
        if (isLoggedOut) throw new Error('Chưa đăng nhập ChatGPT!');

        // Tìm ô nhập liệu
        const PROMPT_SELECTORS = [
            '#prompt-textarea',
            'div[contenteditable="true"][data-lexical-editor]',
            'div[contenteditable="true"]',
            'p[data-placeholder]',
        ];

        let promptLocator = null;
        for (const sel of PROMPT_SELECTORS) {
            try {
                await page.waitForSelector(sel, { state: 'visible', timeout: 8000 });
                promptLocator = page.locator(sel).first();
                break;
            } catch (e) {}
        }
        if (!promptLocator) throw new Error('Không tìm thấy ô nhập liệu ChatGPT!');

        for (let i = 0; i < newImages.length; i++) {
            const imgFile = newImages[i];
            const imgPath = path.join(sampleDir, imgFile);
            console.log(`\n📸 [${i + 1}/${newImages.length}] Đang phân tích: ${imgFile}`);
            liveLog(`📸 [${i + 1}/${newImages.length}] Đang phân tích ảnh mẫu: ${imgFile}`, 'typing', 'ChatGPT');

            try {
                // Upload ảnh
                const inputs = await page.$$('input[type="file"]');
                if (inputs.length > 0) {
                    const activeInput = inputs[inputs.length - 1];
                    await activeInput.setInputFiles([imgPath]);
                    await page.waitForTimeout(4000);
                }

                // Xử lý popup Duplicate File nếu có
                try {
                    const duplicateModal = page.locator('#modal-duplicate-file');
                    if (await duplicateModal.isVisible({ timeout: 1000 })) {
                        console.log('⚠️ Phát hiện popup "Duplicate File", đang xử lý...');
                        const confirmBtn = duplicateModal.locator('button.btn-primary');
                        if (await confirmBtn.isVisible()) {
                            await confirmBtn.click();
                        } else {
                            await page.keyboard.press('Escape');
                        }
                        await page.waitForTimeout(1000);
                    }
                } catch (e) {}

                // Gõ prompt phân tích
                let analyzePrompt = `Look at this lifestyle/product photography reference image carefully. I want you to describe it so I can use your description as a prompt to recreate a similar scene with a luxury watch composited into it.

Please provide your response in EXACTLY this format (nothing else):

TITLE_VI: [A short Vietnamese title describing the scene, max 15 words, e.g. "Flat lay + Bàn gỗ tối + Cốc cafe + Moody"]
SECTION: [One of: MALE, FEMALE, or NEUTRAL — based on the vibe of the scene]
PROMPT_EN: [A detailed English prompt describing the exact scene, lighting, composition, camera angle, props, and atmosphere. The prompt must follow this style: "Photorealistic lifestyle..." and end with "Portrait orientation. Ultra-sharp watch. No text, no watermark." The prompt should be ONE paragraph, no line breaks.]

IMPORTANT:
- The prompt must describe where to PLACE a luxury watch in this scene
- Include specific details: surface material, lighting direction, color temperature, props, camera angle
- Keep it photorealistic commercial photography style
- Do NOT mention any specific brand names in the prompt
- Leave enough composition room for the full watch bracelet/strap. The prompt must not crop, hide, shorten, or cut the strap ends.
- If a future product watch has a leather, rubber, or silicone strap while this reference image shows a steel bracelet, the future product strap must still remain full-length, continuous, and uncropped.`;

                await promptLocator.click();
                await page.waitForTimeout(300);
                await promptLocator.fill(analyzePrompt);
                await page.waitForTimeout(1000);

                // Send
                try {
                    const sendBtn = await page.waitForSelector('button[data-testid="send-button"]:not([disabled])', { timeout: 10000 });
                    if (sendBtn) await sendBtn.click();
                    else await page.keyboard.press('Enter');
                } catch (err) {
                    await page.keyboard.press('Enter');
                }

                // Đánh dấu tin nhắn cũ
                await page.evaluate(() => {
                    document.querySelectorAll('div[data-message-author-role="assistant"]').forEach(el => {
                        el.classList.add('already-processed-msg');
                    });
                });

                console.log('⏳ Đang chờ ChatGPT phân tích ảnh...');

                // Chờ response
                let responseText = null;
                for (let attempt = 0; attempt < 40; attempt++) {
                    await page.waitForTimeout(5000);
                    try {
                        const stopBtn = await page.$('button[data-testid="stop-button"]');
                        if (stopBtn) continue;
                    } catch (e) {}

                    const newMessages = await page.$$('div[data-message-author-role="assistant"]:not(.already-processed-msg)');
                    if (newMessages.length > 0) {
                        const lastMsg = newMessages[newMessages.length - 1];
                        responseText = await lastMsg.innerText();
                        break;
                    }
                }

                if (!responseText) {
                    console.log(`⚠️ Timeout phân tích ảnh ${imgFile}`);
                    continue;
                }

                // Parse response (bỏ qua dấu * nếu GPT lỡ in đậm markdown)
                const titleMatch = responseText.match(/TITLE_VI[\s*]*:[\s*]*(.+)/i);
                // ÉP BUỘC TẤT CẢ LÀ MALE THEO YÊU CẦU CỦA USER
                const section = 'MALE';
                const promptMatch = responseText.match(/PROMPT_EN[\s*]*:[\s*]*([\s\S]+)/i);

                if (titleMatch && promptMatch) {
                    const titleVi = titleMatch[1].trim();
                    let promptEn = promptMatch[1].trim();
                    // Dọn dấu quote nếu có
                    promptEn = promptEn.replace(/^["']|["']$/g, '');

                    const nextId = getNextPromptId(section);
                    appendPromptToMd(section, nextId, titleVi, promptEn, imgFile);

                    // Đánh dấu đã phân tích
                    manifest.analyzed.push(imgFile);
                    saveAnalyzedManifest(manifest);

                    generatedPrompts.push({
                        image: imgFile,
                        section,
                        id: `${section}-${nextId}`,
                        title: titleVi,
                        prompt: promptEn
                    });

                    console.log(`✅ Đã sinh prompt ${section}-${nextId}: "${titleVi}"`);
                    liveLog(`✅ Đã sinh prompt ${section}-${nextId} từ ảnh ${imgFile}`, 'success', 'ChatGPT');
                } else {
                    console.log(`⚠️ Không parse được response cho ${imgFile}. Response: ${responseText.substring(0, 200)}`);
                    liveLog(`⚠️ AI trả lời không đúng format cho ảnh ${imgFile}, bỏ qua.`, 'warning', 'System');
                }
            } catch (imgErr) {
                console.log(`⚠️ Lỗi phân tích ${imgFile}: ${imgErr.message}`);
            }
        }

        await context.close();
        
        const msg = `📸 Đã phân tích xong ${generatedPrompts.length}/${newImages.length} ảnh mẫu → sinh ${generatedPrompts.length} prompt mới vào gpt_image_prompt.md`;
        console.log(msg);
        liveLog(msg, 'success', 'System');

        return { generated: generatedPrompts.length, prompts: generatedPrompts };

    } catch (error) {
        console.error('❌ Lỗi phân tích ảnh mẫu:', error.message);
        liveLog(`❌ Lỗi phân tích ảnh mẫu: ${error.message}`, 'error', 'System');
        try { await context.close(); } catch (e) {}
        return { generated: generatedPrompts.length, prompts: generatedPrompts };
    } finally {
        aiMutex.unlock();
    }
};

export const openLoginHelper = async (provider) => {
    console.log(`\n--- BẮT ĐẦU ĐĂNG NHẬP THỦ CÔNG: ${provider.toUpperCase()} ---`);
    let userDataDir = '';
    let targetUrl = '';
    
    if (provider === 'chatgpt') {
        userDataDir = path.join(__dirname, '../../chrome_data_chatgpt');
        targetUrl = 'https://chatgpt.com';
    } else if (provider === 'gemini') {
        userDataDir = path.join(__dirname, '../../chrome_data_gemini');
        targetUrl = 'https://gemini.google.com/app';
    } else {
        throw new Error('Provider không hợp lệ');
    }
    
    await aiMutex.lock();
    try {
        if (fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
        console.log(`🗑️ Đã xoá profile cũ của ${provider}`);
    }
    
    console.log(`🚀 Khởi động trình duyệt (Headless: FALSE) cho ${provider}...`);
    const context = await chromium.launchPersistentContext(userDataDir, { 
        headless: false,
        viewport: { width: 1280, height: 720 }
    });
    
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    
    console.log(`🌐 Đang mở trang: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    console.log('⏳ Trình duyệt đang mở! Vui lòng đăng nhập vào tài khoản trên cửa sổ trình duyệt.');
    console.log('💡 KHI ĐĂNG NHẬP THÀNH CÔNG VÀ QUA ĐƯỢC CAPTCHA, HÃY TỰ TẮT CỬA SỔ TRÌNH DUYỆT ĐỂ LƯU PROFILE!');
    
    return new Promise((resolve) => {
        context.on('close', () => {
            console.log(`✅ Đã đóng trình duyệt. Profile ${provider} đã được lưu thành công!`);
            resolve(true);
        });
    });
    } finally {
        aiMutex.unlock();
    }
};
