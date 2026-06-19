const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const userDataDir = path.join(process.cwd(), 'shopee-chrome-profile');
  const browser = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const cookies = await browser.cookies();
  console.log('Total cookies:', cookies.length);
  await browser.close();
})();
