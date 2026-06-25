import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

import { prisma } from '../services/shopee/db.js';
import { prepareMediaForShopee, generateShopeeProductName, runShopeeAutomationDemo, startFullAutoSyncBackground } from '../services/shopee/shopeeSync.service.js';

global.autoSyncLogs = [];

const router = express.Router();
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'uploads/') },
  filename: function (req, file, cb) { cb(null, Date.now() + '-' + file.originalname) }
});
const upload = multer({ storage: storage });

// MODELS
router.delete('/models', async (req, res) => {
  try {
    await prisma.variant.deleteMany({});
    await prisma.watchModel.deleteMany({});
    res.json({ success: true, message: 'Đã xóa toàn bộ dữ liệu thành công' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

router.get('/models', async (req, res) => {
  try {
    const models = await prisma.watchModel.findMany({ include: { variants: true } });
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/models', async (req, res) => {
  try {
    const newModel = await prisma.watchModel.create({ data: { name: req.body.name } });
    res.json(newModel);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/models', async (req, res) => {
  try {
    await prisma.variant.deleteMany({});
    await prisma.watchModel.deleteMany({});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// VARIANTS
router.get('/variants/missing', async (req, res) => {
  try {
    const data = await prisma.variant.findMany({
      where: { OR: [{ shopeeProductId: null }, { shopeeProductId: '' }] },
      include: { model: true }
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/variants/:modelId', async (req, res) => {
  try {
    const data = await prisma.variant.findMany({ where: { modelId: req.params.modelId } });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/variants', async (req, res) => {
  try {
    const newVariant = await prisma.variant.create({ data: req.body });
    res.json(newVariant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/variants/:id', async (req, res) => {
  try {
    const updated = await prisma.variant.update({ where: { id: req.params.id }, data: req.body });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/variants/:id', async (req, res) => {
  try {
    await prisma.variant.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SETTINGS
router.get('/settings/:key', async (req, res) => {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: req.params.key } });
    res.json({ value: setting ? setting.value : null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    const setting = await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
    res.json(setting);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update .env file specifically for GEMINI
router.post('/settings/env', async (req, res) => {
  try {
    const { key, value } = req.body;
    // 1. Update in Prisma DB to keep things in sync
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });

    // 2. Update .env file
    if (key === 'gemini_api_key') {
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        // Thay thế GEMINI_API_KEY=...
        const regex = /^GEMINI_API_KEY=.*$/m;
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `GEMINI_API_KEY=${value}`);
        } else {
          envContent += `\nGEMINI_API_KEY=${value}`;
        }
        fs.writeFileSync(envPath, envContent);
      }
    }
    res.json({ success: true, message: 'Saved to .env' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// TEMPLATE CONFIG
router.get('/templates', async (req, res) => {
  try {
    const templates = await prisma.templateConfig.findMany();
    const template = templates.length > 0 ? templates[0] : { nameTemplate: '', descTemplate: '' };
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { nameTemplate, descTemplate } = req.body;
    let templates = await prisma.templateConfig.findMany();
    
    if (templates.length > 0) {
      const updated = await prisma.templateConfig.update({
        where: { id: templates[0].id },
        data: { nameTemplate, descTemplate }
      });
      return res.json(updated);
    }
    
    // Fallback: create new for the first shop
    const shop = await prisma.shop.findFirst();
    if (!shop) throw new Error("Chưa có Shop nào trong hệ thống");
    
    const created = await prisma.templateConfig.create({
      data: { nameTemplate, descTemplate, shopId: shop.id }
    });
    res.json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ACTION ROUTES
router.get('/serve-local-file', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('No path');
    
    let absolutePath = path.resolve(filePath);
    
    if (!fs.existsSync(absolutePath)) {
      // Fix for database portability across computers:
      // If the absolute path from the original PC fails, look for the file in the local uploads directory
      const fileName = path.basename(filePath);
      const fallbackUploads = path.join(process.cwd(), 'uploads', fileName);
      const fallbackSapo = path.join(process.cwd(), 'uploads', 'SapoImages', fileName);
      
      if (fs.existsSync(fallbackUploads)) {
        absolutePath = fallbackUploads;
      } else if (fs.existsSync(fallbackSapo)) {
        absolutePath = fallbackSapo;
      } else {
        return res.status(404).send('File not found: ' + absolutePath);
      }
    }
    
    res.sendFile(absolutePath);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.post('/upload-watermark', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ path: path.resolve(req.file.path) });
});

router.post('/upload-image', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ path: path.resolve(req.file.path) });
});

router.post('/import-excel', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Chưa chọn file' });
  try {
    const _xlsx = await import('xlsx');
    const xlsx = _xlsx.default || _xlsx;
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    let count = 0;
    let currentShopeeId = '';
    let currentModelName = '';

    for (let i = 5; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const rawId = row[0] ? String(row[0]).trim() : '';
      const rawName = row[1] ? String(row[1]).trim() : '';
      if (rawId) currentShopeeId = rawId;
      if (rawName) currentModelName = rawName;

      const color = row[3] ? String(row[3]).trim() : 'Mặc định';
      const rawSku = row[5] ? String(row[5]).trim() : '';
      const priceStr = row[6] ? String(row[6]).trim() : '0';

      if (!currentModelName) continue;

      const sku = rawSku || `NO_SKU_${currentShopeeId}_${i}`;
      let baseModelName = currentModelName;
      if (rawSku && rawSku.includes('-')) baseModelName = rawSku.split('-')[0].trim();
      else if (rawSku) baseModelName = rawSku.trim();
      
      if (baseModelName.includes('-')) baseModelName = baseModelName.split('-')[0].trim();

      let model = await prisma.watchModel.findUnique({ where: { name: baseModelName } });
      if (!model) {
        model = await prisma.watchModel.create({ data: { name: baseModelName } });
      }

      await prisma.variant.upsert({
        where: { sku: sku },
        update: { color: color, shopeeProductId: currentShopeeId, price: Number(priceStr) || 0 },
        create: { modelId: model.id, color: color, sku: sku, price: Number(priceStr) || 0, shopeeProductId: currentShopeeId }
      });
      count++;
    }
    res.json({ success: true, count: count });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post('/import-sapo-excel', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Chưa chọn file' });
  try {
    const _xlsx = await import('xlsx');
    const xlsx = _xlsx.default || _xlsx;
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    let count = 0;
    const sapoImagesDir = path.join(process.cwd(), 'uploads', 'SapoImages');
    if (!fs.existsSync(sapoImagesDir)) fs.mkdirSync(sapoImagesDir, { recursive: true });

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 2) continue;

      const productName = row[0] ? String(row[0]).trim() : '';
      const sku = row[1] ? String(row[1]).trim() : '';
      let imageUrl = row[2] ? String(row[2]).trim() : '';

      if (!sku || sku === 'MÃ SKU' || sku.toLowerCase() === 'sku') continue;

      let baseModelName = productName;
      if (sku.includes('-')) baseModelName = sku.split('-')[0].trim();
      else if (sku.includes(' ')) baseModelName = sku.split(' ')[0].trim();
      else {
        const parts = productName.split(' ');
        baseModelName = parts[parts.length - 1] || productName;
      }

      let model = await prisma.watchModel.findFirst({ where: { name: baseModelName } });
      if (!model) model = await prisma.watchModel.create({ data: { name: baseModelName } });

      let localImagePath = null;
      if (imageUrl && imageUrl.startsWith('http')) {
        try {
          const safeSku = sku.replace(/[^a-zA-Z0-9_-]/g, '');
          const fileName = `${safeSku}_${Date.now()}.jpg`;
          const filePath = path.join(sapoImagesDir, fileName);
          const response = await fetch(imageUrl);
          const arrayBuffer = await response.arrayBuffer();
          fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
          localImagePath = filePath;
        } catch (err) {
          console.error('Lỗi tải ảnh Sapo:', err.message);
        }
      }

      const price = row[5] ? Number(String(row[5]).replace(/[^0-9]/g, '')) : 0;
      // Cột G (row[6]): Vị trí banner — 1=Giữa(AVT chính), 2=Trái, 3=Phải
      const rawBannerPos = row[6] ? parseInt(String(row[6]).trim()) : null;
      const bannerPosition = [1, 2, 3].includes(rawBannerPos) ? rawBannerPos : null;

      const updateData = { price: price };
      if (localImagePath) updateData.rawImage = localImagePath;
      if (bannerPosition !== null) updateData.bannerPosition = bannerPosition;

      await prisma.variant.upsert({
        where: { sku: sku },
        update: updateData,
        create: { modelId: model.id, color: sku, sku: sku, price: price, rawImage: localImagePath, bannerPosition: bannerPosition }
      });
      count++;
    }
    res.json({ success: true, count: count });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post('/auto-match-images-ai', async (req, res) => {
  res.json({ success: true, data: [] });
});

router.post('/generate-avatar/:variantId', async (req, res) => {
  try {
    const variantId = req.params.variantId;
    const variant = await prisma.variant.findUnique({ where: { id: variantId } });
    if (!variant || !variant.rawImage) return res.json({ success: false, message: 'Chưa có ảnh gốc (rawImage)' });

    const watermarkSetting = await prisma.setting.findUnique({ where: { key: 'watermark_path' } });
    if (!watermarkSetting || !watermarkSetting.value) return res.json({ success: false, message: 'Chưa chọn watermark' });

    const rawPath = variant.rawImage;
    const watermarkPath = watermarkSetting.value;

    if (!fs.existsSync(rawPath)) return res.json({ success: false, message: 'File ảnh gốc không tồn tại' });
    if (!fs.existsSync(watermarkPath)) return res.json({ success: false, message: 'File watermark không tồn tại' });

    const outputPath = path.resolve(`uploads/avatar_${variantId}_${Date.now()}.jpg`);

    // Dùng sharp ghép watermark
          // Đọc cấu hình tọa độ
      const settingX = await prisma.setting.findUnique({ where: { key: 'watermark_x' } });
      const settingY = await prisma.setting.findUnique({ where: { key: 'watermark_y' } });
      const settingScale = await prisma.setting.findUnique({ where: { key: 'watermark_scale' } });
      
      const wx = settingX ? parseFloat(settingX.value) : 50;
      const wy = settingY ? parseFloat(settingY.value) : 50;
      const wScale = settingScale ? parseFloat(settingScale.value) : 30;

      // Tính kích thước Logo (Khung 800x800)
      const logoWidthPx = Math.round(800 * (wScale / 100));
      const watermarkBuffer = await sharp(watermarkPath)
         .resize({ width: logoWidthPx })
         .toBuffer();

      const watermarkMeta = await sharp(watermarkBuffer).metadata();
      
      // Tọa độ Top Left (wx, wy là tọa độ gốc trái trên)
      const leftPx = Math.round(800 * (wx / 100));
      const topPx = Math.round(800 * (wy / 100));

      // Ràng buộc trong khung hình
      const safeLeft = Math.max(0, Math.min(800 - watermarkMeta.width, leftPx));
      const safeTop = Math.max(0, Math.min(800 - watermarkMeta.height, topPx));

      // Dùng sharp ghép watermark trên nền 800x800
      await sharp(rawPath)
        .resize(800, 800, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .composite([{ input: watermarkBuffer, top: safeTop, left: safeLeft }])
        .jpeg({ quality: 90 })
        .toFile(outputPath);

    await prisma.variant.update({
      where: { id: variantId },
      data: { avatarImage: outputPath }
    });

    res.json({ success: true, message: 'Tạo Avatar thành công', path: outputPath });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post('/sync-shopee/:variantId', async (req, res) => {
    try {
      const variantId = req.params.variantId;
      
      const cookiesSetting = await prisma.setting.findUnique({ where: { key: 'shopee_cookies' } });
      if (!cookiesSetting || !cookiesSetting.value) {
        return res.json({ success: false, message: 'Chưa có session Shopee! Vui lòng login trước.' });
      }

      const variant = await prisma.variant.findUnique({ 
        where: { id: variantId },
        include: { model: true }
      });
      if (!variant) return res.json({ success: false, message: 'Không tìm thấy variant' });

      // Generate productName
      const productName = await generateShopeeProductName(variant.id, variant.model?.name);

      if (variant.shopeeProductId) {
        return res.json({ success: true, message: `Mã này đã có Shopee ID (${variant.shopeeProductId}), hệ thống tự động bỏ qua (không đăng lại hay cập nhật).` });
      }
      
      // Avatar path
      const avatarFiles = fs.readdirSync(path.join(process.cwd(), 'uploads')).filter(f => f.startsWith(`avatar_${variant.id}_`));
      let avatarPath = null;
      if (avatarFiles.length > 0) {
          avatarFiles.sort((a,b) => fs.statSync(path.join(process.cwd(), 'uploads', b)).mtime.getTime() - fs.statSync(path.join(process.cwd(), 'uploads', a)).mtime.getTime());
          avatarPath = path.join(process.cwd(), 'uploads', avatarFiles[0]);
      } else {
          return res.json({ success: false, message: 'Chưa generate Avatar cho biến thể này!' });
      }

      // Luôn lấy ảnh đúng của biến thể đang Sync, không lấy của biến thể Avatar mặc định
      const sourceSku = variant.sku;

      // Prepare media
      const media = await prepareMediaForShopee(variant.model?.name, sourceSku, avatarPath, (msg) => console.log(msg));

      // Mở trình duyệt chạy Auto
      await runShopeeAutomationDemo(cookiesSetting.value, productName, variant.shopeeProductId || '', media, variant.id, (msg) => console.log(msg));

      res.json({ success: true, message: 'Đã hoàn tất đồng bộ Shopee thành công!' });
    } catch (err) {
      console.error(err);
      res.json({ success: false, message: err.message });
    }
  });

router.post('/run-full-auto-sync', async (req, res) => {
  if (global.isAutoSyncRunning) {
    return res.json({ success: false, message: 'Tiến trình Auto Sync đang chạy, vui lòng đợi hoàn tất hoặc khởi động lại server!' });
  }

  const { prioritySku, publishMode } = req.body || {};
  global.isAutoSyncRunning = true;
  // Trả về ngay để frontend không bị timeout
  res.json({ success: true, message: 'Đã bắt đầu tiến trình chạy ngầm!' });
  
  // Gọi hàm chạy ngầm (không dùng await để nó chạy độc lập)
  startFullAutoSyncBackground(prioritySku, publishMode).then(() => {
    global.isAutoSyncRunning = false;
  }).catch(err => {
    global.isAutoSyncRunning = false;
    console.error('Lỗi Background Full Auto Sync:', err);
    global.autoSyncLogs.push(`[SYSTEM] Lỗi nghiêm trọng: ${err.message}`);
  });
});

router.post('/stop-auto-sync', (req, res) => {
  global.shouldStopAutoSync = true;
  global.autoSyncLogs.push('[SYSTEM] 🛑 Đã nhận lệnh DỪNG, tiến trình sẽ thoát ngay khi hoàn tất chu kỳ hiện tại!');
  res.json({ success: true, message: 'Đã gửi lệnh dừng!' });
});

router.get('/auto-sync-logs', (req, res) => {
  // Trả về các log hiện tại và reset (lấy log mới nhất)
  const logs = [...(global.autoSyncLogs || [])];
  global.autoSyncLogs = []; // Dọn bộ nhớ sau khi client đã lấy
  res.json({ success: true, logs });
});

router.post('/shopee-login', async (req, res) => {
  try {
    const userDataDir = path.join(process.cwd(), 'shopee-chrome-profile');
    
    // Các args chống phát hiện bot cơ bản
    const args = [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1280,800'
    ];

    let browser;
    try {
      browser = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null,
        channel: 'chrome',
        args: args
      });
    } catch (e) {
      try {
        browser = await chromium.launchPersistentContext(userDataDir, {
          headless: false,
          viewport: null,
          channel: 'msedge',
          args: args
        });
      } catch (e2) {
        browser = await chromium.launchPersistentContext(userDataDir, {
          headless: false,
          viewport: null,
          args: args
        });
      }
    }

    const page = await browser.newPage();
    
    // Ghi đè webdriver để qua mặt captcha
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto('https://banhang.shopee.vn/');

    let latestCookies = await browser.cookies();
    
    let pollInterval = setInterval(async () => {
      try {
        latestCookies = await browser.cookies();
      } catch (e) {
         // ignore
      }
    }, 2000);

    // Khi người dùng TỰ TẮT trình duyệt (giống bản cũ), ta mới lưu DB và báo thành công
    browser.on('close', async () => {
      clearInterval(pollInterval);
      if (!res.headersSent) {
        if (latestCookies.length > 0) {
          try {
            await prisma.setting.upsert({
              where: { key: 'shopee_cookies' },
              update: { value: JSON.stringify(latestCookies) },
              create: { key: 'shopee_cookies', value: JSON.stringify(latestCookies) }
            });
            res.json({ success: true, message: 'Đã lưu Cookie thành công sau khi đóng trình duyệt!' });
          } catch (dbErr) {
            res.json({ success: false, message: 'Lỗi khi lưu Cookie vào DB: ' + dbErr.message });
          }
        } else {
          res.json({ success: false, message: 'Trình duyệt đã đóng nhưng không tìm thấy Cookie nào.' });
        }
      }
    });

  } catch (error) {
    if (!res.headersSent) res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/import-shopee-excel', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Chưa chọn file' });
  try {
    const _xlsx = await import('xlsx');
    const xlsx = _xlsx.default || _xlsx;
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    let updatedCount = 0;
    let skippedCount = 0;

    // Auto-detect format dựa trên header row
    const header = data[0] || [];
    let shopeeIdCol = -1;
    let skuCol = -1;
    let startRow = 1; // Bỏ qua header

    for (let c = 0; c < header.length; c++) {
      const h = String(header[c] || '').trim().toLowerCase();
      if (h.includes('id sản phẩm') || h.includes('product id') || h === 'id') shopeeIdCol = c;
      if (h.includes('sku phân loại') || h.includes('sku') || h.includes('mã sku')) skuCol = c;
    }

    // Nếu không tìm thấy header, thử detect format dựa trên dữ liệu thực
    if (shopeeIdCol === -1 && skuCol === -1) {
      // Quét 200 dòng đầu để tìm format thật (vì có thể nhiều dòng đầu trống)
      let detected = false;
      for (let probe = 0; probe < Math.min(200, data.length); probe++) {
        const row = data[probe] || [];
        const colB = String(row[1] || '').trim();
        const colC = String(row[2] || '').trim();
        // Format Google Sheet log: cột B = Shopee ID (số dài), cột C = SKU (chứa "-")
        if (/^\d{5,}$/.test(colB) && colC.includes('-')) {
          shopeeIdCol = 1;
          skuCol = 2;
          startRow = 0;
          detected = true;
          break;
        }
      }
      if (!detected) {
        // Fallback: Format Shopee Seller Center (cột A = ID, cột F = SKU)
        shopeeIdCol = 0;
        skuCol = 5;
      }
    }

    let currentShopeeId = '';

    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const rawId = row[shopeeIdCol] ? String(row[shopeeIdCol]).trim() : '';
      if (rawId && /^\d+$/.test(rawId)) currentShopeeId = rawId;

      const sku = row[skuCol] ? String(row[skuCol]).trim() : '';
      if (!sku || !currentShopeeId) continue;

      // Tìm variant chính xác theo SKU
      const variant = await prisma.variant.findFirst({
        where: { sku: sku }
      });

      if (variant) {
        await prisma.variant.update({
          where: { id: variant.id },
          data: { shopeeProductId: currentShopeeId }
        });
        updatedCount++;
      } else {
        // Thử tìm theo base model name (VD: "737G2-S1" -> tìm tất cả "737G2-*")
        const baseName = sku.includes('-') ? sku.split('-')[0].trim() : sku;
        const variants = await prisma.variant.findMany({
          where: { sku: { startsWith: baseName + '-' } }
        });
        for (const v of variants) {
          if (!v.shopeeProductId) { // Chỉ cập nhật nếu chưa có
            await prisma.variant.update({
              where: { id: v.id },
              data: { shopeeProductId: currentShopeeId }
            });
            updatedCount++;
          }
        }
        if (variants.length === 0) skippedCount++;
      }
    }

    res.json({ 
      success: true, 
      message: `Đã cập nhật Shopee ID cho ${updatedCount} SKU. Bỏ qua ${skippedCount} SKU không tìm thấy.`,
      count: updatedCount
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

export default router;
