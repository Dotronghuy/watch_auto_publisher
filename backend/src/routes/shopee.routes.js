import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

import { prisma } from '../services/shopee/db.js';
import { prepareMediaForShopee, generateShopeeProductName, runShopeeAutomationDemo } from '../services/shopee/shopeeSync.service.js';

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

// ACTION ROUTES
router.get('/serve-local-file', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('No path');
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) return res.status(404).send('File not found: ' + absolutePath);
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

      const price = row[4] ? Number(String(row[4]).replace(/[^0-9]/g, '')) : 0;

      await prisma.variant.upsert({
        where: { sku: sku },
        update: { rawImage: localImagePath || undefined, price: price },
        create: { modelId: model.id, color: sku, sku: sku, price: price, rawImage: localImagePath }
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
      
      // Avatar path
      const avatarFiles = fs.readdirSync(path.join(process.cwd(), 'uploads')).filter(f => f.startsWith(`avatar_${variant.id}_`));
      let avatarPath = null;
      if (avatarFiles.length > 0) {
          avatarFiles.sort((a,b) => fs.statSync(path.join(process.cwd(), 'uploads', b)).mtime.getTime() - fs.statSync(path.join(process.cwd(), 'uploads', a)).mtime.getTime());
          avatarPath = path.join(process.cwd(), 'uploads', avatarFiles[0]);
      } else {
          return res.json({ success: false, message: 'Chưa generate Avatar cho biến thể này!' });
      }

      // Prepare media
      const media = await prepareMediaForShopee(variant.model?.name, variant.sku, avatarPath, (msg) => console.log(msg));

      // Mở trình duyệt chạy Auto
      await runShopeeAutomationDemo(cookiesSetting.value, productName, variant.shopeeProductId || '', media, variant.id, (msg) => console.log(msg));

      res.json({ success: true, message: 'Đã hoàn tất đồng bộ Shopee thành công!' });
    } catch (err) {
      console.error(err);
      res.json({ success: false, message: err.message });
    }
  });

router.post('/run-full-auto-sync', async (req, res) => {
  res.json({ success: true, total: 0 });
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

export default router;
