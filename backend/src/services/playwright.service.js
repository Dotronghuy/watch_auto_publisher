import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

chromium.use(stealth());

export const generateBackgroundOnChatGPT = async (imagePath, prompt, count = 1) => {
    console.log('\n--- BẮT ĐẦU TIẾN TRÌNH PLAYWRIGHT ---');
    const userDataDir = path.join(__dirname, '../../chrome_data_chatgpt');
    
    console.log('🚀 Khởi động trình duyệt ảo (Sử dụng Persistent Profile)...');
    // Mở trình duyệt với Profile được lưu lại, không cần dùng cookies.json nữa
    const context = await chromium.launchPersistentContext(userDataDir, { 
        headless: false,
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
        
        // Đảm bảo ô nhập prompt đã sẵn sàng
        await page.waitForSelector('#prompt-textarea', { state: 'visible', timeout: 30000 });

        console.log('📤 Đang tìm nút Upload và tải ảnh gốc lên...');
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
            await fileInput.setInputFiles(imagePath);
            console.log('✅ Đã chọn file ảnh.');
        } else {
            throw new Error('Không tìm thấy nút Upload File trên giao diện ChatGPT. Có thể giao diện đã bị thay đổi!');
        }
        
        // Chờ ảnh được tải lên (hiện thumbnail)
        await page.waitForTimeout(5000);
        
        const outputPaths = [];
        const downloadedSrcs = new Set();
        
        for (let i = 0; i < count; i++) {
            console.log(`\n--- VẼ ẢNH ${i + 1}/${count} ---`);
            
            if (i === 0) {
                console.log(`✍️ Đang gõ prompt gốc...`);
                await page.fill('#prompt-textarea', prompt);
            } else {
                console.log(`✍️ Đang gõ prompt biến thể...`);
                const followUpPrompt = "Hãy tạo thêm 1 bức ảnh khác với bối cảnh tương tự nhưng thay đổi góc nhìn, cách bài trí hoặc ánh sáng một chút. Khung cảnh vẫn phải thật sang trọng.";
                await page.fill('#prompt-textarea', followUpPrompt);
            }
            
            await page.waitForTimeout(1000);
            console.log('🚀 Nhấn Enter gửi yêu cầu...');
            await page.keyboard.press('Enter');
            
            console.log(`⏳ Đang chờ ChatGPT vẽ ảnh ${i + 1} (có thể mất 60-100 giây)...`);
            
            let targetImgSrc = null;
            // Quét tìm ảnh liên tục mỗi 5 giây, tối đa 20 lần (100 giây)
            for (let attempt = 0; attempt < 20; attempt++) {
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
                            if (area > maxArea && area > 70000) {
                                const src = await img.getAttribute('src');
                                // Loại bỏ ảnh đại diện và các ảnh đã tải ở vòng lặp trước
                                if (src && !src.includes('avatar') && !downloadedSrcs.has(src)) {
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
            }
            
            if (!targetImgSrc) {
                console.log(`❌ LỖI: Không thể tìm thấy ảnh thứ ${i + 1} do ChatGPT vẽ ra sau 100 giây. Sẽ dừng vòng lặp tại đây.`);
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
            console.log(`🎉 HOÀN THÀNH ẢNH ${i + 1}: ${outputPath}`);
            
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
    const context = await chromium.launchPersistentContext(userDataDir, { 
        headless: false,
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
