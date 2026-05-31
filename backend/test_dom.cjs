const { chromium } = require('playwright');
const path = require('path');
(async () => {
  try {
    const userDataDir = path.join('c:/Users/Admin/Downloads/watch-auto-publisher/backend', 'chrome_data_chatgpt');
    const browser = await chromium.launchPersistentContext(userDataDir, { headless: true });
    const page = await browser.newPage();
    const settings = require('c:/Users/Admin/Downloads/watch-auto-publisher/backend/src/config/settings.json');
    await page.goto('https://chatgpt.com/c/' + settings.aiTasks.imageChatUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    // Find where the main content is
    const html = await page.evaluate(() => {
        const res = [];
        document.querySelectorAll('*').forEach(el => {
            if (el.tagName === 'CANVAS') res.push('CANVAS width=' + el.width + ' height=' + el.height);
            if (el.tagName === 'PICTURE') res.push('PICTURE');
            if (el.tagName === 'SVG') res.push('SVG class=' + el.className.baseVal);
            const bg = window.getComputedStyle(el).backgroundImage;
            if (bg && bg !== 'none' && !bg.includes('linear-gradient')) res.push('BG_IMAGE: ' + el.tagName + ' ' + bg.substring(0, 50));
            // Maybe they use web components like <image-view>?
            if (el.tagName.includes('-')) res.push('CUSTOM: ' + el.tagName);
            
            // Check for buttons with specific aria-labels like 'Chỉnh sửa' (Edit)
            if (el.innerText && el.innerText.includes('Chỉnh sửa')) {
               res.push('Found Text Chỉnh sửa in: ' + el.tagName + ' html: ' + el.parentElement.innerHTML.substring(0, 100));
            }
            if (el.innerText && el.innerText.includes('Thought for')) {
               res.push('Found Thought for in: ' + el.tagName);
            }
        });
        return res;
    });
    console.log(html.filter((v, i, a) => a.indexOf(v) === i));
    await browser.close();
  } catch(e) {
    console.error(e.message);
  }
})();
