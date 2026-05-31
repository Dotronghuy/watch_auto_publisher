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
        const targetUrl = 'https://chatgpt.com';
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
        console.log('🔍 Đang tìm ô nhập liệu ChatGPT...');
        for (const sel of PROMPT_SELECTORS) {
            try {
                await page.waitForSelector(sel, { state: 'visible', timeout: 8000 });
                promptLocator = page.locator(sel).first();
                console.log(`✅ Tìm thấy ô nhập liệu bằng selector: ${sel}`);
                break;
            } catch (e) {
                console.log(`⚠️ Không tìm thấy: ${sel}, thử selector tiếp theo...`);
            }
        }

        if (!promptLocator) {
            throw new Error('Không tìm thấy ô nhập liệu ChatGPT! Giao diện có thể đã thay đổi hoặc tài khoản chưa đăng nhập.');
        }

        const outputPaths = [];
        const downloadedSrcs = new Set();
        
        const count = promptsArray.length;
        for (let i = 0; i < count; i++) {
            console.log(`\n--- VẼ ẢNH ${i + 1}/${count} ---`);
            const currentPrompt = promptsArray[i];

            // Xác định ảnh mẫu
            let currentSampleImage = null;
            if (i === 0 && sampleImagePath && fs.existsSync(sampleImagePath)) {
                currentSampleImage = sampleImagePath;
            } else if (i > 0) {
                currentSampleImage = getRandomSampleImageLocal();
            }

            console.log('📤 Đang tìm nút Upload và tải ảnh lên...');
            const inputs = await page.$$('input[type="file"]');
            if (inputs.length > 0) {
                const filesToUpload = [imagePath];
                if (currentSampleImage) {
                    filesToUpload.push(currentSampleImage);
                    console.log(`✅ Đã chọn kèm ảnh mẫu tham chiếu (${path.basename(currentSampleImage)})`);
                }
                const activeInput = inputs[inputs.length - 1]; // Lấy thẻ cuối cùng (active)
                await activeInput.setInputFiles(filesToUpload);
                console.log('✅ Đã chọn file ảnh xong.');
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
            
            // Snapshot existing images to avoid grabbing them
            try {
                const existingImgs = await page.$$('img');
                for (const img of existingImgs) {
                    const src = await img.getAttribute('src');
                    if (src) downloadedSrcs.add(src);
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
            for (let attempt = 0; attempt < 60; attempt++) {
                if (abortSignal && abortSignal.aborted) throw new Error('Abort requested');
                await page.waitForTimeout(5000);
                
                // Wait for AI to finish generating
                let isGenerating = true;
                try {
                    const sendBtn = await page.$('button[data-testid="send-button"]:not([disabled])');
                    if (sendBtn) {
                        isGenerating = false;
                    }
                } catch (e) {}

                if (isGenerating) continue; // Still generating

                // Now find the new image
                let images = [];
                try {
                    images = await page.$$('img');
                } catch (e) {}
                
                let maxArea = 0;
                let bestImgSrc = null;
                
                for (const img of images) {
                    try {
                        const box = await img.boundingBox();
                        if (box) {
                            const area = box.width * box.height;
                            if (area > 90000) {
                                const src = await img.getAttribute('src');
                                const isUIElement = !src || src.includes('avatar') || src.includes('favicon') || src.startsWith('data:image');
                                if (!isUIElement && !downloadedSrcs.has(src)) {
                                    if (area > maxArea) {
                                        maxArea = area;
                                        bestImgSrc = src;
                                    }
                                }
                            }
                        }
                    } catch (e) {}
                }
                
                if (bestImgSrc) {
                    targetImgSrc = bestImgSrc;
                    downloadedSrcs.add(targetImgSrc);
                    console.log(`✅ Đã tìm thấy ảnh mới vẽ (Kích thước: ${Math.round(maxArea)} px²)`);
                    break;
                }
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
