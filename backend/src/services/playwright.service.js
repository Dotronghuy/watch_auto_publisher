import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { liveLog } from '../utils/liveLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

chromium.use(stealth());

export const generateBackgroundOnChatGPT = async (imagePath, promptsArray, abortSignal = null, sampleImagePath = null) => {
    console.log('\n--- BẮT ĐẦU TIẾN TRÌNH PLAYWRIGHT ---');
    const userDataDir = path.join(__dirname, '../../chrome_data_chatgpt');
    
    console.log('🚀 Khởi động trình duyệt ảo (Sử dụng Persistent Profile)...');
    // headless: false + ẩn ra ngoài màn hình để tránh bị ChatGPT detect
    const context = await chromium.launchPersistentContext(userDataDir, { 
        headless: false,
        args: ['--window-position=-32000,-32000', '--window-size=1280,720'],
        viewport: { width: 1280, height: 720 }
    });
    
    // Persistent Context mặc định mở sẵn 1 tab trắng
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    
    try {
        console.log('🌐 Đang truy cập chatgpt.com...');
        await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
        
        // Kiểm tra xem đã đăng nhập chưa
        await page.waitForTimeout(3000); // Chờ trang tải các nút bấm
        const isLoggedOut = await page.isVisible('text="Log in"');
        if (isLoggedOut) {
            console.log('⚠️ BẠN CHƯA ĐĂNG NHẬP CHATGPT! Trình duyệt sẽ dừng lại để bạn thao tác.');
            console.log('⏳ Vui lòng đăng nhập vào tài khoản Plus trên trình duyệt đang mở (Bạn có 3 phút)...');
            
            // Vòng lặp kiểm tra trạng thái đăng nhập mỗi 5 giây
            // Phải dùng vòng lặp vì khi bấm Login, trang sẽ chuyển hướng sang trang của OpenAI auth
            for (let i = 0; i < 36; i++) {
                await page.waitForTimeout(5000);
                try {
                    const currentUrl = page.url();
                    // Nếu đã quay lại trang chủ và không còn nút Log in
                    if (currentUrl.includes('chatgpt.com')) {
                        const stillLoggedOut = await page.isVisible('text="Log in"');
                        if (!stillLoggedOut) {
                            console.log('✅ Đã phát hiện đăng nhập thành công! Tiếp tục tiến trình...');
                            await page.waitForTimeout(3000);
                            break;
                        }
                    }
                } catch (e) {
                    // Bỏ qua lỗi context bị hủy tạm thời khi chuyển trang
                }
            }
        }
        
        // Đảm bảo ô nhập prompt đã sẵn sàng - thư nhiều selector vì ChatGPT hay đổi UI
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

        console.log('📤 Đang tìm nút Upload và tải ảnh lên...');
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
            // Upload ảnh AVT đồng hồ (bắt buộc)
            const filesToUpload = [imagePath];
            
            // Nếu có ảnh mẫu tham chiếu, upload thêm vào cùng lúc
            if (sampleImagePath && fs.existsSync(sampleImagePath)) {
                filesToUpload.push(sampleImagePath);
                console.log(`✅ Đã chọn 2 file: Watch AVT + Ảnh mẫu tham chiếu (${path.basename(sampleImagePath)})`);
            } else {
                console.log('✅ Đã chọn 1 file: Watch AVT (không có ảnh mẫu).');
            }
            
            await fileInput.setInputFiles(filesToUpload);
        } else {
            throw new Error('Không tìm thấy nút Upload File trên giao diện ChatGPT. Có thể giao diện đã bị thay đổi!');
        }
        
        // Chờ ảnh được tải lên (hiện thumbnail)
        await page.waitForTimeout(5000);
        
        const outputPaths = [];
        const downloadedSrcs = new Set();
        
        const count = promptsArray.length;
        for (let i = 0; i < count; i++) {
            console.log(`\n--- VẼ ẢNH ${i + 1}/${count} ---`);
            const currentPrompt = promptsArray[i];
            
            if (i === 0) {
                console.log(`✍️ Đang gõ prompt gốc số 1...`);
                await promptLocator.click();
                await page.waitForTimeout(300);
                
                // Nếu có ảnh mẫu tham chiếu → dùng prompt đặc biệt để GPT ghép vào bối cảnh thật
                let firstPrompt;
                if (sampleImagePath && fs.existsSync(sampleImagePath)) {
                    firstPrompt = `I am sending you TWO images:
- IMAGE 1 (first image): The luxury watch with a transparent/white background — this is the PRODUCT to feature.
- IMAGE 2 (second image): A real lifestyle reference photo — this is the SCENE/BACKGROUND to use.

YOUR TASK: Place the watch from Image 1 onto the wrist or surface in Image 2's scene. The final result must look like a real professional product photo.

STRICT RULES:
1. KEEP the watch design from Image 1 100% identical — do NOT change the dial, bezel, hands, brand text, bracelet, or colors in any way.
2. KEEP the background, lighting, atmosphere, and composition from Image 2 as close to the original as possible.
3. The watch must be naturally integrated — correct lighting angle, realistic shadow, proper scale on the wrist/surface.
4. Output: photorealistic, high-end commercial photography quality, 4K.

Additional scene variation for this image:
${currentPrompt}`;
                } else {
                    firstPrompt = currentPrompt;
                }
                
                await promptLocator.fill(firstPrompt);
            } else {
                console.log(`✍️ Đang gõ prompt biến thể số ${i + 1}...`);
                let followUpPrompt;
                if (sampleImagePath && fs.existsSync(sampleImagePath)) {
                    followUpPrompt = `Now create the next variation. Use the SAME watch from Image 1 (keep it 100% identical), but place it in a DIFFERENT scene variation as described below:\n\n"${currentPrompt}"\n\nKeep it photorealistic and natural. The watch details must remain exactly unchanged.`;
                } else {
                    followUpPrompt = `Bây giờ, hãy tạo bức ảnh tiếp theo. YÊU CẦU BẮT BUỘC: Thay đổi hoàn toàn bối cảnh theo mô tả chi tiết sau đây:\n\n"${currentPrompt}"\n\nTuyệt đối giữ nguyên vẹn 100% thiết kế của chiếc đồng hồ gốc. Đảm bảo chất lượng 4K siêu thực.`;
                }
                await promptLocator.click();
                await page.waitForTimeout(300);
                await promptLocator.fill(followUpPrompt);
            }
            
            await page.waitForTimeout(1000);
            console.log('🚀 Nhấn Enter gửi yêu cầu...');
            
            // Chụp snapshot tất cả ảnh HIỆN CÓ trên trang TRƯỚC khi GPT sinh ảnh mới
            // → Tránh nhận nhầm ảnh thumbnail đã upload thành ảnh AI vừa tạo
            try {
                const existingImgs = await page.$$('img');
                for (const img of existingImgs) {
                    const src = await img.getAttribute('src');
                    if (src) downloadedSrcs.add(src);
                }
                console.log(`📸 Đã snapshot ${downloadedSrcs.size} ảnh hiện có (sẽ bỏ qua khi scan).`);
            } catch (e) {}
            
            await page.keyboard.press('Enter');
            
            console.log(`⏳ Đang chờ ChatGPT vẽ ảnh ${i + 1} (có thể mất 60-100 giây)...`);
            
            let targetImgSrc = null;
            // Quét tìm ảnh liên tục mỗi 5 giây, tối đa 60 lần (300 giây = 5 phút)
            for (let attempt = 0; attempt < 60; attempt++) {
                // Kiểm tra lệnh dừng trước mỗi lần quét
                if (abortSignal && abortSignal.aborted) {
                    console.log('⏹️ Nhận lệnh dừng, thoát vòng lặp chờ ảnh GPT.');
                    throw new Error('Abort requested');
                }
                await page.waitForTimeout(5000);
                
                // Xử lý trường hợp ChatGPT bật chế độ A/B Testing
                try {
                    const img1Btn = await page.$('text="Image 1 is better"');
                    if (img1Btn) {
                        console.log('👀 Phát hiện ChatGPT hỏi chọn ảnh (A/B Test). Tự động chọn Image 1...');
                        await img1Btn.click();
                        await page.waitForTimeout(2000); 
                    }
                } catch (e) {}

                const images = await page.$$('img');
                
                let maxArea = 0;
                let bestImgSrc = null;
                
                for (const img of images) {
                    try {
                        const box = await img.boundingBox();
                        if (box) {
                            const area = box.width * box.height;
                            if (area > 10000) { // Hạ ngưỡng xuống để bắt kịp ảnh chưa render full
                                const src = await img.getAttribute('src');
                                // Loại bỏ các ảnh UI (avatar, icon, logo trang web)
                                const isUIElement = !src || 
                                    src.includes('avatar') || 
                                    src.includes('favicon') ||
                                    src.includes('_next/static') ||
                                    src.includes('logo') ||
                                    src.includes('icon') ||
                                    src.startsWith('data:image/svg');
                                if (!isUIElement && !downloadedSrcs.has(src) && area > maxArea) {
                                    maxArea = area;
                                    bestImgSrc = src;
                                }
                            }
                        }
                    } catch (e) {
                        // Bỏ qua lỗi DOM
                    }
                }
                
                if (bestImgSrc) {
                    targetImgSrc = bestImgSrc;
                    console.log(`✅ Đã bắt được ảnh DALL-E mới (Diện tích: ${maxArea}px). Chờ 5 giây cho ảnh render hoàn toàn...`);
                    await page.waitForTimeout(5000); 
                    break;
                }
                
                console.log(`⏳ Chưa thấy ảnh (lần thử ${attempt + 1}/60, đã chờ ${((attempt + 1) * 5)}s)...`);
            }
            
            if (!targetImgSrc) {
                console.log(`❌ LỖI: Không thể tìm thấy ảnh thứ ${i + 1} do ChatGPT vẽ ra sau 150 giây. Sẽ dừng vòng lặp tại đây.`);
                break;
            }
            
            downloadedSrcs.add(targetImgSrc);
            
            console.log(`📥 Đang tải ảnh mới về máy: ${targetImgSrc.substring(0, 50)}...`);
            const imageBuffer = await page.evaluate(async (url) => {
                const res = await fetch(url);
                const buffer = await res.arrayBuffer();
                return Array.from(new Uint8Array(buffer));
            }, targetImgSrc);
            
            const outputPath = path.join(__dirname, `../../temp_images/chatgpt_ai_${i}_${Date.now()}.png`);
            fs.writeFileSync(outputPath, Buffer.from(imageBuffer));
            const fileName = path.basename(outputPath);
            const imageUrl = `http://localhost:3000/images/${fileName}`;

            console.log(`🎉 HOÀN THÀNH ẢNH ${i + 1}/${count}: ${outputPath}`);
            
            // Gửi ngay lên Live Monitor để hiển thị carousel
            liveLog(
              `🖼️ Ảnh ${i + 1}/${count} đã được sinh xong!`,
              'success',
              'GPT-4 Vision',
              { image: imageUrl, imageIndex: i + 1, imageTotal: count }
            );
            
            outputPaths.push(outputPath);
            
            // Nghỉ một chút trước khi yêu cầu vẽ bức tiếp theo
            if (i < count - 1) {
                await page.waitForTimeout(3000);
            }
        }
        
        // Giữ trình duyệt 5 giây để User nhìn thấy kết quả
        await page.waitForTimeout(5000);
        await context.close();
        
        return outputPaths;
        
    } catch (error) {
        console.error('\n❌ LỖI TRONG TIẾN TRÌNH PLAYWRIGHT:');
        console.error(error.message);
        // Không đóng ngay để User xem lỗi trên màn hình
        console.log('⏳ Sẽ giữ trình duyệt 30 giây để bạn xem lỗi trước khi tắt...');
        await page.waitForTimeout(30000);
        await context.close();
        throw error;
    }
};

export const generateTextOnGemini = async (prompt, imagePath = null) => {
    console.log('\n--- BẮT ĐẦU TIẾN TRÌNH PLAYWRIGHT (GEMINI TEXT) ---');
    // Ta tách riêng thư mục profile để tránh xung đột file lock với ChatGPT
    const userDataDir = path.join(__dirname, '../../chrome_data_gemini');
    
    console.log('🚀 Khởi động trình duyệt ảo (Gemini Profile)...');
    // headless: false + ẩn ra ngoài màn hình để tránh bị Gemini detect
    const context = await chromium.launchPersistentContext(userDataDir, { 
        headless: false,
        args: ['--window-position=-32000,-32000', '--window-size=1280,720'],
        viewport: { width: 1280, height: 720 }
    });
    
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    
    try {
        console.log('🌐 Đang truy cập gemini.google.com...');
        await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
        
        // Kiểm tra xem đã đăng nhập chưa
        await page.waitForTimeout(3000);
        const isGeminiLoggedOut = await page.isVisible('text="Sign in"');
        if (isGeminiLoggedOut) {
            console.log('⚠️ BẠN CHƯA ĐĂNG NHẬP GOOGLE! Trình duyệt sẽ dừng lại để bạn thao tác.');
            console.log('⏳ Vui lòng đăng nhập vào tài khoản Google trên trình duyệt đang mở (Bạn có 3 phút)...');
            
            for (let i = 0; i < 36; i++) {
                await page.waitForTimeout(5000);
                try {
                    const currentUrl = page.url();
                    if (currentUrl.includes('gemini.google.com')) {
                        const stillLoggedOut = await page.isVisible('text="Sign in"');
                        if (!stillLoggedOut) {
                            console.log('✅ Đã phát hiện đăng nhập thành công! Tiếp tục tiến trình...');
                            await page.waitForTimeout(3000);
                            break;
                        }
                    }
                } catch (e) {
                    // Bỏ qua lỗi
                }
            }
        }
        
        await page.waitForSelector('rich-textarea', { state: 'visible', timeout: 30000 });

        if (imagePath && fs.existsSync(imagePath)) {
            console.log('📤 Đang đính kèm ảnh lên Gemini bằng cách giả lập Paste...');
            try {
                // Đọc file ảnh chuyển thành Base64
                const imageBuffer = fs.readFileSync(imagePath);
                const base64Image = imageBuffer.toString('base64');
                const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                
                // Focus vào ô nhập liệu trước
                const editor = page.locator('rich-textarea');
                await editor.click();
                await page.waitForTimeout(500);
                
                // Giả lập lệnh Paste (Ctrl+V) đẩy thẳng file ảnh vào bộ nhớ đệm của thẻ rich-textarea
                await page.evaluate(async ({ base64, mime }) => {
                    const res = await fetch(`data:${mime};base64,${base64}`);
                    const blob = await res.blob();
                    const file = new File([blob], "image.jpg", { type: mime });
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);
                    
                    const pasteEvent = new ClipboardEvent('paste', {
                        clipboardData: dataTransfer,
                        bubbles: true,
                        cancelable: true
                    });
                    document.querySelector('rich-textarea').dispatchEvent(pasteEvent);
                }, { base64: base64Image, mime: mimeType });
                
                console.log('✅ Đã dán ảnh thành công.');
                await page.waitForTimeout(4000); // Đợi Gemini xử lý xong ảnh vừa dán
            } catch (err) {
                console.log(`⚠️ Lỗi dán ảnh: ${err.message}. Sẽ gửi nội dung không kèm ảnh.`);
            }
        }

        console.log('✍️ Đang gõ yêu cầu cho Gemini...');
        const editor = page.locator('rich-textarea');
        await editor.click(); // Focus vào thẻ
        await page.waitForTimeout(500); // Chờ focus ăn
        await page.keyboard.insertText(prompt); // Chèn text trực tiếp như người dùng paste nội dung
        await page.waitForTimeout(1000);
        
        console.log('🚀 Đang gửi yêu cầu...');
        // Hủy bôi đen đoạn text vừa dán để tránh việc bấm Enter làm xóa text
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(500);

        try {
            // Thử click nút Send của Gemini (nút có aria-label chứa chữ Send)
            const sendBtn = page.locator('button[aria-label*="Send" i]').first();
            if (await sendBtn.isVisible({ timeout: 1000 })) {
                await sendBtn.click();
                console.log('✅ Đã click nút Send.');
            } else {
                console.log('⚠️ Không tìm thấy nút Send, sẽ thử dùng phím Enter.');
                await page.keyboard.press('Enter');
            }
        } catch(e) {
            await page.keyboard.press('Enter');
        }
        
        console.log('⏳ Đang chờ Gemini sinh nội dung (có thể mất 15-30 giây)...');
        
        let finalText = '';
        
        // Quét kết quả trả về liên tục mỗi 4 giây
        for (let attempt = 0; attempt < 15; attempt++) {
            await page.waitForTimeout(4000);
            
            // Tìm tất cả các khối trả lời (message-content)
            const responses = await page.$$('message-content');
            if (responses.length > 0) {
                const lastResponse = responses[responses.length - 1];
                const text = await lastResponse.innerText();
                
                // Nếu text đủ dài, ta chờ thêm 3 giây xem nó có đang gõ tiếp không
                if (text && text.length > 50) {
                    await page.waitForTimeout(3000);
                    const newText = await lastResponse.innerText();
                    
                    // Nếu sau 3 giây mà text không đổi, nghĩa là Gemini đã trả lời xong!
                    if (newText === text) {
                        finalText = newText;
                        break;
                    }
                }
            }
        }
        
        if (!finalText) {
            throw new Error('❌ Không thể lấy được nội dung từ Gemini sau 60 giây. Có thể do lỗi mạng hoặc tài khoản bị block.');
        }
        
        console.log('🎉 HOÀN THÀNH: Đã lấy được nội dung từ Gemini!');

        // Gửi nội dung lên Live Monitor để hiển thị phần Gemini Content
        liveLog(
          `✅ Gemini đã viết xong nội dung (${finalText.length} ký tự)!`,
          'success',
          'Gemini 1.5 Pro',
          { textPreview: finalText }
        );
        
        await page.waitForTimeout(2000);
        await context.close();
        
        return finalText;
        
    } catch (error) {
        console.error('\n❌ LỖI TRONG TIẾN TRÌNH GEMINI PLAYWRIGHT:');
        console.error(error.message);
        console.log('⏳ Sẽ giữ trình duyệt 30 giây để bạn xem lỗi trước khi tắt...');
        await page.waitForTimeout(30000);
        await context.close();
        throw error;
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
