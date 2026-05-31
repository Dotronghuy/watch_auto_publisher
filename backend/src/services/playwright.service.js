import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { liveLog } from '../utils/liveLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

chromium.use(stealth());

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

const settingsPath = path.join(__dirname, '../config/settings.json');
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

export const generateBackgroundOnChatGPT = async (imagePath, promptsArray, abortSignal = null, sampleImagePath = null, isNewSession = true) => {
    console.log('\n--- BẮT ĐẦU TIẾN TRÌNH PLAYWRIGHT ---');
    const userDataDir = path.join(__dirname, '../../chrome_data_chatgpt');
    
    console.log('🚀 Khởi động trình duyệt ảo (Sử dụng Persistent Profile)...');
    // Hiển thị ra màn hình để theo dõi
    const context = await chromium.launchPersistentContext(userDataDir, { 
        headless: false,
        args: ['--window-position=0,0', '--window-size=1280,720'],
        viewport: { width: 1280, height: 720 }
    });
    
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    
    try {
        let targetUrl = 'https://chatgpt.com';
        if (!isNewSession) {
            const savedChatId = getAiTaskUrl('imageChatUrl');
            if (savedChatId) {
                targetUrl = `https://chatgpt.com/c/${savedChatId}`;
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
                    await page.waitForTimeout(10000); // Chờ 10 giây sau khi reload
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
        // Không cần downloadedSrcs nữa vì ta dùng logic quét từ dưới lên
        
        const count = promptsArray.length;
        for (let i = 0; i < count; i++) {
            console.log(`\n--- VẼ ẢNH ${i + 1}/${count} ---`);
            if (abortSignal?.aborted) throw new Error('aborted');

            const currentPromptObj = promptsArray[i];
            const isString = typeof currentPromptObj === 'string';
            const currentPrompt = isString ? currentPromptObj : currentPromptObj.prompt;
            const promptSampleImage = isString ? null : currentPromptObj.sampleImage;

            let currentSampleImage = null;
            if (promptSampleImage && fs.existsSync(promptSampleImage)) {
                currentSampleImage = promptSampleImage;
            } else if (i === 0 && sampleImagePath && fs.existsSync(sampleImagePath)) {
                currentSampleImage = sampleImagePath;
            } else if (i > 0) {
                currentSampleImage = getRandomSampleImageLocal();
            }

            console.log('📤 Đang tìm nút Upload và tải ảnh lên...');
            const inputs = await page.$$('input[type="file"]');
            if (inputs.length > 0) {
                const filesToUpload = [];
                if (imagePath && fs.existsSync(imagePath)) filesToUpload.push(imagePath);
                if (currentSampleImage && fs.existsSync(currentSampleImage)) {
                    filesToUpload.push(currentSampleImage);
                    console.log(`✅ Đã chọn kèm ảnh mẫu tham chiếu (${path.basename(currentSampleImage)})`);
                }
                if (filesToUpload.length > 0) {
                    const activeInput = inputs[inputs.length - 1]; // Lấy thẻ cuối cùng (active)
                    await activeInput.setInputFiles(filesToUpload);
                    console.log(`✅ Đã chọn ${filesToUpload.length} file ảnh xong.`);
                }
            } else {
                console.log('⚠️ Không tìm thấy input file, có thể giao diện đổi.');
            }
            
            // Chờ ảnh tải lên hiện thành thumbnail
            await page.waitForTimeout(4000);

            console.log(`✍️ Đang gõ prompt số ${i + 1}...`);
            await promptLocator.click();
            await page.waitForTimeout(300);
            
            let finalPrompt;
            if (currentSampleImage) {
                finalPrompt = `I am sending you TWO images:
- IMAGE 1 (first image): The luxury watch with a transparent/white background — this is the PRODUCT to feature.
- IMAGE 2 (second image): A real lifestyle reference photo — this is the SCENE/BACKGROUND to use.

YOUR TASK: Place the watch from Image 1 onto the wrist or surface in Image 2's scene. The final result must look like a real professional product photo.

STRICT RULES:
1. IGNORE ALL PREVIOUS IMAGES IN THIS CHAT. YOU MUST ONLY USE IMAGE 1 AS THE PRODUCT.\n2. KEEP the watch design from Image 1 100% identical — do NOT change the dial, bezel, hands, brand text, bracelet, or colors in any way.
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
            
            await promptLocator.fill(finalPrompt);
            await page.waitForTimeout(1000);
            console.log('🚀 Nhấn nút Send gửi yêu cầu...');
            
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

            try {
                const sendBtn = await page.waitForSelector('button[data-testid="send-button"]:not([disabled])', { timeout: 10000 });
                if (sendBtn) {
                    await sendBtn.click();
                } else {
                    await page.keyboard.press('Enter');
                }
            } catch (err) {
                await page.keyboard.press('Enter');
            }
            
            console.log(`⏳ Đang chờ ChatGPT vẽ ảnh ${i + 1} (có thể mất 60-100 giây)...`);
            
            let targetImgSrc = null;
            
            // Tìm tọa độ Y tuyệt đối lớn nhất của các ảnh cũ
            let maxY = 0;
            try {
                const existingImgs = await page.$$('img');
                for (const img of existingImgs) {
                    const box = await img.boundingBox();
                    if (box && box.width * box.height > 90000) {
                        const absoluteY = await page.evaluate((el) => {
                            const rect = el.getBoundingClientRect();
                            return rect.top + window.scrollY;
                        }, img);
                        if (absoluteY > Math.round(maxY)) maxY = absoluteY;
                    }
                }
            } catch (e) {}
            console.log(`📍 Tọa độ Y thấp nhất của ảnh cũ: ${Math.round(maxY)} px`);

            for (let attempt = 0; attempt < 60; attempt++) {
                if (abortSignal && abortSignal.aborted) throw new Error('Abort requested');
                await page.waitForTimeout(5000);
                
                // Quét tìm ảnh có tọa độ Y lớn hơn ảnh cũ
                try {
                    const images = await page.$$('img');
                    for (let j = images.length - 1; j >= 0; j--) {
                        const img = images[j];
                        const box = await img.boundingBox();
                        if (box) {
                            const area = box.width * box.height;
                            if (area > 90000) {
                                const src = await img.getAttribute('src');
                                const isUIElement = !src || src.includes('avatar') || src.includes('favicon') || src.startsWith('data:image');
                                if (!isUIElement) {
                                    const absoluteY = await page.evaluate((el) => {
                                        const rect = el.getBoundingClientRect();
                                        return rect.top + window.scrollY;
                                    }, img);
                                    
                                    // Bức ảnh mới luôn nằm dưới cùng, nên Y của nó phải lớn hơn Y của các ảnh cũ
                                    // +10 để bù trừ sai số pixel
                                    if (absoluteY > Math.round(maxY) + 10) {
                                        targetImgSrc = src;
                                        console.log(`✅ Đã chộp được ảnh mới vẽ ở vị trí Y: ${Math.round(absoluteY)} (Kích thước: ${Math.round(area)} px²)`);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {}
                
                if (targetImgSrc) break;
            }
            
            if (!targetImgSrc) {
                console.log(`⚠️ Timeout chờ ảnh ${i + 1} (Không tìm thấy ảnh sau 5 phút)`);
                continue;
            }
            
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
            const buffer = Buffer.from(base64Data, 'base64');
            const outputPath = path.join(__dirname, `../../temp_images/chatgpt_gen_${Date.now()}.png`);
            fs.writeFileSync(outputPath, buffer);
            console.log(`✅ Đã lưu ảnh ${i + 1} thành công: ${path.basename(outputPath)}`);
            
            outputPaths.push(outputPath);
        }
        
        console.log('✅ Hoàn thành tiến trình vẽ mẻ ảnh!');
        await context.close();
        
        return outputPaths;
        
    } catch (error) {
        console.error('\n❌ LỖI TRONG TIẾN TRÌNH PLAYWRIGHT:');
        console.error(error.message);
        if (page && !page.isClosed()) {
            await page.waitForTimeout(20000);
        }
        await context.close();
        return [];
    }
};

export const generateContentOnChatGPT = async (prompt, type, imagePath = null) => {
    console.log('\n--- BẮT ĐẦU TIẾN TRÌNH PLAYWRIGHT (CHATGPT TEXT) ---');
    const userDataDir = path.join(__dirname, '../../chrome_data_chatgpt');
    
    console.log('🚀 Khởi động trình duyệt ảo (ChatGPT Text Profile)...');
    const context = await chromium.launchPersistentContext(userDataDir, { 
        headless: false,
        args: ['--window-position=0,0', '--window-size=1280,720'],
        viewport: { width: 1280, height: 720 }
    });
    
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    
    try {
        let targetUrl = 'https://chatgpt.com';
        const savedChatId = type === 'fb' ? getAiTaskUrl('fbChatUrl') : (type === 'ig' ? getAiTaskUrl('igChatUrl') : getAiTaskUrl('fbChatUrl'));
        if (savedChatId) {
            targetUrl = `https://chatgpt.com/c/${savedChatId}`;
        }
        
        console.log(`🌐 Đang truy cập ${targetUrl}...`);
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

        console.log('✍️ Đang gõ prompt text...');
        await promptLocator.click();
        await page.waitForTimeout(300);
        await promptLocator.fill(prompt);
        await page.waitForTimeout(1000);
        
        try {
            const sendBtn = await page.waitForSelector('button[data-testid="send-button"]:not([disabled])', { timeout: 10000 });
            if (sendBtn) await sendBtn.click();
            else await page.keyboard.press('Enter');
        } catch (err) {
            await page.keyboard.press('Enter');
        }
        
        if (!savedChatId) {
            await page.waitForTimeout(3000);
            const currentUrl = page.url();
            if (currentUrl.includes('/c/')) {
                const saveType = type === 'fb' ? 'fbChatUrl' : (type === 'ig' ? 'igChatUrl' : 'fbChatUrl');
                updateAiTaskUrl(saveType, currentUrl);
            }
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
                const text = await lastMsg.innerText();
                console.log('✅ Đã lấy xong nội dung!');
                await context.close();
                return text.trim();
            }
        }
        
        throw new Error('Timeout chờ text');
        
    } catch (error) {
        console.error('❌ LỖI TRONG TIẾN TRÌNH PLAYWRIGHT TEXT:', error.message);
        await context.close();
        return null;
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
    try {
        const userDataDir = path.join(__dirname, '../../chrome_data_chatgpt');
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            args: ['--window-position=0,0', '--window-size=1280,720'],
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

                // Gõ prompt phân tích
                const analyzePrompt = `Look at this lifestyle/product photography reference image carefully. I want you to describe it so I can use your description as a prompt to recreate a similar scene with a luxury watch composited into it.

Please provide your response in EXACTLY this format (nothing else):

TITLE_VI: [A short Vietnamese title describing the scene, max 15 words, e.g. "Flat lay + Bàn gỗ tối + Cốc cafe + Moody"]
SECTION: [One of: MALE, FEMALE, or NEUTRAL — based on the vibe of the scene]
PROMPT_EN: [A detailed English prompt describing the exact scene, lighting, composition, camera angle, props, and atmosphere. The prompt must follow this style: "Photorealistic lifestyle..." and end with "Portrait orientation. Ultra-sharp watch. No text, no watermark." The prompt should be ONE paragraph, no line breaks.]

IMPORTANT:
- The prompt must describe where to PLACE a luxury watch in this scene
- Include specific details: surface material, lighting direction, color temperature, props, camera angle
- Keep it photorealistic commercial photography style
- Do NOT mention any specific brand names in the prompt`;

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
};
