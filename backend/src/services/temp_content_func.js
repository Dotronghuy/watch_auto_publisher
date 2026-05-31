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
        
        console.log('⏳ Đang chờ ChatGPT viết nội dung...');
        
        for (let attempt = 0; attempt < 60; attempt++) {
            await page.waitForTimeout(5000);
            let isGenerating = true;
            try {
                const sendBtn = await page.$('button[data-testid="send-button"]:not([disabled])');
                if (sendBtn) isGenerating = false;
            } catch (e) {}

            if (isGenerating) continue;
            
            // Lấy text mới nhất
            const messages = await page.$$('div[data-message-author-role="assistant"]');
            if (messages.length > 0) {
                const lastMsg = messages[messages.length - 1];
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
