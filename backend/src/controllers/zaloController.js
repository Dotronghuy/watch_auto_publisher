import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { getFoldersInFolder, getImagesInFolder, downloadFileFromDrive } from '../services/drive.service.js';
import { getProductInfoBySku } from '../services/sheet.service.js';
import { readFromSheet } from '../services/sheets.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();

const CONFIG_PATH = path.join(__dirname, '../../config/zalo-config.json');
const ROOT_DRIVE_FOLDER_ID = process.env.ROOT_DRIVE_FOLDER_ID || '1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl';

let isZaloRunning = false;
let zaloAbortController = new AbortController();
let zaloLogs = [];

function log(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('vi-VN');
  const logMsg = { time: timestamp, message: msg, type };
  zaloLogs.push(logMsg);
  console.log(`[ZaloTool] ${msg}`);
  if (zaloLogs.length > 1000) zaloLogs.shift();
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) { console.error('Error loading zalo config:', e.message); }
  return { groups: [], phone: '', sheetUrl: '', postsPerSession: 5, delayMinutes: 2, cooldownDays: 2, contentTone: 'auto' };
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// =================== API Handlers =================== //

export const getZaloConfig = (req, res) => {
  res.json(loadConfig());
};

export const saveZaloConfig = (req, res) => {
  try {
    const current = loadConfig();
    const updated = { ...current, ...req.body };
    saveConfig(updated);
    res.json({ success: true, config: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const getZaloHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const [items, total] = await Promise.all([
      prisma.zaloPostHistory.findMany({
        orderBy: { postedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.zaloPostHistory.count(),
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const deleteZaloHistory = async (req, res) => {
  try {
    await prisma.zaloPostHistory.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const checkGeminiLogin = (req, res) => {
  const geminiDir = path.join(__dirname, '../../chrome_data_gemini');
  let loggedIn = false;
  try {
    if (fs.existsSync(geminiDir)) {
      const files = fs.readdirSync(geminiDir);
      loggedIn = files.length > 0;
    }
  } catch (e) {}
  res.json({ loggedIn });
};

export const startZaloPost = async (req, res) => {
  if (isZaloRunning) {
    return res.status(400).json({ error: 'Tool Zalo đang chạy rồi.' });
  }

  isZaloRunning = true;
  zaloAbortController = new AbortController();
  zaloLogs = [];
  log('🚀 BẮT ĐẦU CHIẾN DỊCH ZALO AUTO POST', 'highlight');

  res.json({ message: 'Zalo tool started' });

  runZaloTask(zaloAbortController.signal).catch(err => {
    log(`❌ Lỗi nghiêm trọng: ${err.message}`, 'error');
  }).finally(() => {
    isZaloRunning = false;
  });
};

export const stopZaloPost = (req, res) => {
  if (!isZaloRunning) {
    return res.status(400).json({ error: 'Tool Zalo chưa chạy.' });
  }
  zaloAbortController.abort();
  log('🛑 Đang dừng chiến dịch Zalo...', 'error');
  res.json({ message: 'Đang dừng...' });
};

export const getZaloStatus = (req, res) => {
  res.json({ isRunning: isZaloRunning, logs: zaloLogs });
};

// =================== Core Logic =================== //

async function runZaloTask(signal) {
  let browser;
  const config = loadConfig();
  const { groups, phone, sheetUrl, postsPerSession, delayMinutes, cooldownDays, contentTone } = config;

  if (!groups || groups.length === 0) throw new Error('Chưa cấu hình nhóm Zalo!');
  if (!sheetUrl) throw new Error('Chưa nhập Link Google Sheet!');

  try {
    // ====== BƯỚC 1: Tải dữ liệu Google Sheet ======
    log('📥 Đang tải dữ liệu Google Sheet...', 'info');
    const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) throw new Error('Link Google Sheet không hợp lệ!');
    const exportUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;

    const response = await fetch(exportUrl);
    if (!response.ok) throw new Error('Không thể tải Google Sheet');
    const buffer = await response.arrayBuffer();
    const workbook = xlsx.read(buffer, { type: 'buffer' });

    const sheetData = [];
    for (const sheetName of workbook.SheetNames) {
      const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
      for (let i = 0; i < data.length; i++) {
        if (signal.aborted) throw new Error('Đã dừng.');
        const row = data[i];
        if (!row) continue;
        for (let col = 0; col < row.length; col++) {
          if (String(row[col] || '').toUpperCase().includes('MÃ SP')) {
            for (let j = col + 1; j < row.length; j++) {
              const sp = String(row[j] || '').trim();
              if (sp && sp !== 'NAN' && sp !== 'UNDEFINED' && i + 2 < data.length) {
                sheetData.push({ id: sp, priceRaw: String(data[i + 2][j] || '').trim() });
              }
            }
          }
        }
      }
    }
    log(`✅ Gom được ${sheetData.length} mã SP từ Sheet`, 'success');
    if (sheetData.length === 0) throw new Error('Sheet trống!');

    // ====== BƯỚC 2: Đọc SKU_STATUS Sheet để lấy cột "Tập Trung" ======
    log('📊 Đọc cột Tập Trung từ SKU_STATUS Sheet...', 'info');
    let skuStatusData = [];
    try {
      skuStatusData = await readFromSheet();
    } catch (e) {
      log(`⚠️ Không đọc được SKU_STATUS: ${e.message}, bỏ qua ưu tiên`, 'warning');
    }

    // ====== BƯỚC 3: Lọc cooldown từ DB ======
    log('🔍 Đang lọc sản phẩm theo cooldown...', 'info');
    const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);
    const recentPosts = await prisma.zaloPostHistory.findMany({
      where: { postedAt: { gte: cutoff } },
      select: { productId: true }
    });
    const recentIds = new Set(recentPosts.map(p => p.productId));
    const freshProducts = sheetData.filter(p => !recentIds.has(p.id));
    log(`📊 Còn ${freshProducts.length}/${sheetData.length} mã chưa đăng trong ${cooldownDays} ngày`, 'info');
    if (freshProducts.length === 0) throw new Error('Tất cả mã SP đã đăng gần đây!');

    // ====== BƯỚC 4: Phân nhóm theo "Tập Trung" + Weighted Random ======
    // 0 = Chưa bán (pre-order), 1 = Bán chạy, 2 = Bán ít
    // Tỉ lệ: 85% nhóm 1, 10% nhóm 2, 5% nhóm 0
    let priorityGroups = { '1': [], '2': [], '0': [] };

    for (const product of freshProducts) {
      const baseCode = (product.id.match(/^(\d+[a-zA-Z]?)/) || [])[1] || product.id.split('-')[0];
      const statusRow = skuStatusData.find(row =>
        (row['Mã SKU'] || row['Ma_SKU'] || '').toUpperCase().includes(baseCode.toUpperCase())
      );
      const priority = statusRow ? String(statusRow['Tập Trung'] || '0').trim() : '1';
      const group = ['1', '2', '0'].includes(priority) ? priority : '1';
      priorityGroups[group].push({ ...product, priority: group });
    }

    log(`📊 Phân nhóm: Nhóm 1 (bán chạy): ${priorityGroups['1'].length} | Nhóm 2 (bán ít): ${priorityGroups['2'].length} | Nhóm 0 (pre-order): ${priorityGroups['0'].length}`, 'info');

    // Weighted selection function
    const pickWeightedProduct = () => {
      const roll = Math.random() * 100;
      let pool;
      if (roll < 85 && priorityGroups['1'].length > 0) {
        pool = priorityGroups['1'];
      } else if (roll < 95 && priorityGroups['2'].length > 0) {
        pool = priorityGroups['2'];
      } else if (priorityGroups['0'].length > 0) {
        pool = priorityGroups['0'];
      } else {
        // Fallback
        pool = priorityGroups['1'].length > 0 ? priorityGroups['1'] :
               priorityGroups['2'].length > 0 ? priorityGroups['2'] :
               priorityGroups['0'];
      }
      if (!pool || pool.length === 0) return null;
      const idx = Math.floor(Math.random() * pool.length);
      const picked = pool[idx];
      pool.splice(idx, 1); // Không lặp lại
      return picked;
    };

    // ====== BƯỚC 5: Quét ảnh từ Google Drive ======
    log('🗂️ Đang quét Google Drive tìm ảnh...', 'info');
    const brandFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    const iwFolder = brandFolders.find(f =>
      f.name.toLowerCase().includes('i&w carnival') || f.name.toLowerCase().includes('i&w')
    );
    if (!iwFolder) throw new Error('Không tìm thấy thư mục I&W Carnival trên Drive!');
    const skuFolders = await getFoldersInFolder(iwFolder.id);
    log(`✅ Tìm thấy ${skuFolders.length} thư mục SKU trên Drive`, 'success');

    // ====== BƯỚC 5: Mở Browser + Đăng bài ======
    log('🤖 Khởi động trình duyệt Zalo...', 'info');
    const userDataDir = path.join(__dirname, '../../zalo_profile');
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    browser = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: ['--disable-notifications'],
      viewport: { width: 1280, height: 800 }
    });

    let postsDone = 0;

    while (postsDone < postsPerSession) {
      if (signal.aborted) throw new Error('Đã dừng.');

      const product = pickWeightedProduct();
      if (!product) {
        log('⚠️ Hết mã SP để đăng!', 'warning');
        break;
      }

      // Tìm SKU folder trên Drive
      const baseCode = (product.id.match(/^(\d+[a-zA-Z]?)/) || [])[1] || product.id.split('-')[0];
      const skuFolder = skuFolders.find(f =>
        f.name.toUpperCase().includes(baseCode.toUpperCase())
      );

      if (!skuFolder) {
        log(`⚠️ Không tìm thấy folder Drive cho ${product.id}, bỏ qua...`, 'warning');
        continue;
      }

      // Tìm ảnh: Random chọn 1 folder (Anh_Hang HOẶC Anh_Tu_Chup), lấy HẾT ảnh
      const subFolders = await getFoldersInFolder(skuFolder.id);
      let images = [];

      // Lọc ra 2 folder có ảnh
      const candidateFolders = [];
      for (const folderName of ['1_Anh_Hang', '2_Anh_Tu_Chup']) {
        const sub = subFolders.find(f => f.name.includes(folderName.split('_')[0]) || f.name.toLowerCase().includes(folderName.toLowerCase()));
        if (sub) {
          const subImages = await getImagesInFolder(sub.id);
          if (subImages.length > 0) {
            candidateFolders.push({ folder: sub, images: subImages });
          }
        }
      }

      if (candidateFolders.length > 0) {
        // Random chọn 1 folder
        const chosen = candidateFolders[Math.floor(Math.random() * candidateFolders.length)];
        images = chosen.images;
        log(`📸 Random chọn [${chosen.folder.name}] → ${images.length} ảnh (lấy hết)`, 'info');
      } else {
        // Fallback: quét toàn bộ thư mục SKU
        images = await getImagesInFolder(skuFolder.id);
      }

      if (images.length === 0) {
        log(`⚠️ Không có ảnh cho ${product.id} trên Drive, bỏ qua`, 'warning');
        continue;
      }

      // Lấy TẤT CẢ ảnh (không giới hạn)
      const selected = [...images];

      log(`\n🚀 [BÀI ${postsDone + 1}/${postsPerSession}] Mã: ${product.id} | Nhóm ${product.priority} | ${selected.length} ảnh`, 'highlight');

      // Tải ảnh về temp
      const tempDir = path.join(__dirname, '../../temp_images');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const localPaths = [];
      for (const img of selected) {
        if (signal.aborted) throw new Error('Đã dừng.');
        log(`   📥 Tải: ${img.name}...`, 'info');
        const localPath = await downloadFileFromDrive(img.id, `zalo_${img.name}`);
        localPaths.push(localPath);
      }

      // Tạo content bằng AI (truyền priority để phân biệt pre-order vs bình thường)
      log('🤖 AI đang viết bài bán hàng...', 'info');
      const postContent = await generateZaloContentSmart(product, localPaths[0], phone, contentTone, skuFolder.name, product.priority);

      // Đăng lên tất cả các nhóm
      const page = await browser.newPage();
      try {
        await page.goto('https://chat.zalo.me/', { timeout: 60000 });
        await page.waitForSelector('#contact-search-input', { timeout: 60000 });

        for (const groupName of groups) {
          if (signal.aborted) throw new Error('Đã dừng.');
          if (!groupName.trim()) continue;

          log(`   🎯 Nhóm: [${groupName}]`, 'info');

          // Clear search và tìm nhóm
          await page.fill('#contact-search-input', '');
          await page.waitForTimeout(500);
          await page.fill('#contact-search-input', groupName);
          await page.waitForTimeout(2500);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2500);

          // Upload ảnh
          log(`   📤 Upload ${localPaths.length} ảnh...`, 'info');
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('div[title*="hình ảnh" i], div[title*="ảnh" i], .icon-photo, div[data-id="btn_Send_Photo"]').first().click()
          ]);
          await fileChooser.setFiles(localPaths);
          await page.waitForTimeout(localPaths.length * 2500 + 2000);

          // Nhập nội dung
          await page.locator('#richInput').focus();
          await page.keyboard.insertText(postContent);
          await page.waitForTimeout(1500);
          await page.keyboard.press('Enter');
          log(`   ✅ Đã gửi vào: ${groupName}`, 'success');
          await page.waitForTimeout(2000);
        }

        // Lưu history vào DB
        await prisma.zaloPostHistory.upsert({
          where: { productId: product.id },
          update: { postedAt: new Date() },
          create: { productId: product.id }
        });

        postsDone++;
        log(`🎉 Hoàn tất mã: ${product.id} (${postsDone}/${postsPerSession})`, 'success');
      } catch (err) {
        log(`⚠️ Lỗi đăng bài ${product.id}: ${err.message}`, 'error');
      } finally {
        await page.close();
      }

      // Dọn temp files
      for (const p of localPaths) {
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
      }

      // Delay giữa các bài
      if (postsDone < postsPerSession && !signal.aborted) {
        const jitter = Math.floor(Math.random() * 60000) - 30000; // ±30s
        const waitMs = delayMinutes * 60 * 1000 + jitter;
        log(`⏳ Nghỉ ${Math.round(waitMs / 60000)} phút trước bài tiếp...`, 'info');
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, waitMs);
          signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    }

    log(`\n🎉 HOÀN TẤT CHIẾN DỊCH ZALO! Đã đăng ${postsDone} bài.`, 'highlight');

  } catch (error) {
    if (error.message === 'Đã dừng.') {
      log('🛑 ĐÃ DỪNG TOOL ZALO THEO YÊU CẦU.', 'error');
    } else {
      log(`❌ Lỗi: ${error.message}`, 'error');
    }
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    isZaloRunning = false;
  }
}

// ============== AI Content Generator (Playwright → gemini.google.com) ================= //

async function generateZaloContentSmart(product, imagePath, phone, toneKey, skuName, priority = '1') {
  try {
    // Lấy thông số SP từ Google Sheets (nếu có)
    let specsText = '';
    try {
      const productInfo = await getProductInfoBySku(skuName || product.id);
      if (productInfo) {
        specsText = Object.entries(productInfo).map(([k, v]) => `${k}: ${v}`).join('\n');
      }
    } catch (e) { /* ignore */ }

    // Detect giới tính từ mã SKU
    const skuUp = (skuName || product.id || '').toUpperCase();
    let gender = 'Unisex';
    if (/\dG$|G\d|\dG\d/.test(skuUp)) gender = 'Nam';
    else if (/\dL$|L\d|\dL\d/.test(skuUp)) gender = 'Nữ';

    // Format giá
    let priceK = String(product.priceRaw).replace(/\D/g, '');
    priceK = priceK ? Math.floor(parseInt(priceK) / 1000) + 'k' : 'Liên hệ';

    log(`   🎨 Giới tính: ${gender} | Giá CTV: ${priceK} | Nhóm: ${priority}`, 'info');

    let prompt;

    if (priority === '0') {
      // === TEMPLATE PRE-ORDER (Nhóm 0 - Chưa bán, mời đặt hàng) ===
      prompt = `Bạn là copywriter chuyên viết bài đồng hồ cho NHÓM ZALO BÁN SỈ / CTV.

Sản phẩm này CHƯA CÓ SẴN và KHÔNG CÓ THÔNG SỐ KỸ THUẬT. Viết bài PRE-ORDER / MỜI ĐẶT HÀNG TRƯỚC.

Nhìn ảnh và viết bài theo format:

[emoji hot] I&W CARNIVAL ${product.id} – [TIÊU ĐỀ HẤP DẪN, VIẾT HOA]
[emoji] SẮP VỀ HÀNG – NHẬN ĐẶT TRƯỚC!
[emoji] [Mô tả vẻ đẹp/thiết kế dựa trên NHÌN ẢNH – màu sắc, kiểu dáng, cảm nhận chung]
[emoji] [Mô tả thêm 1 điểm ấn tượng khi nhìn ảnh – chất liệu, mặt số, phong cách]
[emoji] Đặt hàng sớm để nhận giá ưu đãi!

Giới tính: ${gender}

QUY TẮC QUAN TRỌNG:
- TUYỆT ĐỐI KHÔNG bịa thông số (size, độ dày, bộ máy, chống nước) vì sản phẩm chưa có thông tin
- Chỉ mô tả những gì NHÌN THẤY trong ảnh (màu mặt số, kiểu dây, phong cách tổng thể)
- Tạo cảm giác KHAN HIẾM, SỐ LƯỢNG CÓ HẠN, FOMO
- Dùng EMOJI ĐA DẠNG, SÁNG TẠO
- KHÔNG viết hashtag, KHÔNG đề cập giá
- CHỈ TRẢ VỀ NỘI DUNG, KHÔNG GIẢI THÍCH`;
    } else {
      // Random chọn 1 trong 2 template cho nhóm 1 + 2
      const templateIdx = Math.floor(Math.random() * 2);

      if (templateIdx === 0) {
        // === TEMPLATE 1: Thông số kỹ thuật chi tiết ===
        prompt = `Bạn là copywriter chuyên viết bài đăng đồng hồ cho NHÓM ZALO BÁN SỈ / CTV (cộng tác viên).

Nhìn ảnh sản phẩm và viết bài đăng theo ĐÚNG FORMAT sau (giữ nguyên cấu trúc):

[Emoji đồng hồ] I&W CARNIVAL ${product.id} [TỰ ĐỘNG/AUTOMATIC nếu có] – [TIÊU ĐỀ NGẮN GỌN, SÚC TÍCH, VIẾT HOA] [emoji]
[emoji] Điểm nổi bật:
[emoji tick] Bộ máy: [tên bộ máy nếu biết, hoặc nhìn ảnh đoán]
[emoji tick] Size mặt: [đường kính mm] – Độ dày: [mm]  
[emoji tick] Chất liệu vỏ/dây: [thép không gỉ/da/...]
[emoji tick] Mặt kính: [Sapphire/Mineral/...]
[emoji tick] Chống nước: [ATM/mét]
[emoji tick] Thiết kế: [mô tả ngắn 1 dòng về phong cách]

${specsText ? `THÔNG SỐ TỪ HỆ THỐNG:\n${specsText}` : 'TỰ NHÌN ẢNH phân tích thông số.'}
Giới tính: ${gender}

QUY TẮC:
- Dùng EMOJI ĐA DẠNG, SÁNG TẠO (KHÔNG lặp lại emoji, mỗi dòng 1 emoji khác nhau)
- KHÔNG viết hashtag
- KHÔNG đề cập giá
- VIẾT ĐÚNG theo giới tính: ${gender === 'Nữ' ? 'nữ tính (thanh lịch, tôn da, nhẹ nhàng, quý phái)' : 'nam tính (lịch lãm, phong độ, mạnh mẽ, sang trọng)'}
- CHỈ TRẢ VỀ NỘI DUNG BÀI VIẾT, KHÔNG GIẢI THÍCH GÌ THÊM`;
      } else {
        // === TEMPLATE 2: Bullet highlights ngắn gọn ===
        prompt = `Bạn là copywriter chuyên viết bài cho NHÓM ZALO BÁN SỈ / CTV đồng hồ.

Nhìn ảnh và viết bài đăng theo style sau:

[emoji] I&W Carnival ${product.id} - [Câu mô tả ngắn hấp dẫn, viết hoa chữ cái đầu]
[emoji] [Nhận xét về mặt kính/chất liệu kính - Sapphire, vẻ đẹp mặt số]
[emoji] [Nhận xét về bộ máy - Cơ/Automatic/Quartz, trải nghiệm]
[emoji] [Nhận xét về vỏ/dây - thép 316L, da, titanium...]
[emoji] [Thông số: Size mm, độ dày mm]
[emoji] [Nhận xét về dây đeo - kim loại, da, cao su]

${specsText ? `THÔNG SỐ TỪ HỆ THỐNG:\n${specsText}` : 'TỰ NHÌN ẢNH phân tích thông số.'}
Giới tính: ${gender}

QUY TẮC:
- Mỗi dòng bắt đầu bằng dấu * và 1 EMOJI KHÁC NHAU (tự sáng tạo, đa dạng, không lặp)
- Viết tự nhiên, cuốn hút, có cảm xúc, KHÔNG khô khan liệt kê
- KHÔNG viết hashtag, KHÔNG đề cập giá
- ${gender === 'Nữ' ? 'Dùng từ nữ tính: thanh lịch, tôn da, nhẹ nhàng' : 'Dùng từ nam tính: lịch lãm, phong độ, sang trọng'}
- CHỈ TRẢ VỀ NỘI DUNG, KHÔNG GIẢI THÍCH GÌ THÊM`;
      }
    }

    // ====== Playwright → gemini.google.com ======
    log('   🌐 Mở Gemini trên trình duyệt...', 'info');
    const geminiDataDir = path.join(__dirname, '../../chrome_data_gemini');
    if (!fs.existsSync(geminiDataDir)) fs.mkdirSync(geminiDataDir, { recursive: true });

    const geminiCtx = await chromium.launchPersistentContext(geminiDataDir, {
      headless: false,
      args: ['--window-position=1300,0', '--window-size=900,700'],
      viewport: { width: 900, height: 700 }
    });

    const geminiPage = geminiCtx.pages().length > 0 ? geminiCtx.pages()[0] : await geminiCtx.newPage();

    try {
      await geminiPage.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await geminiPage.waitForTimeout(3000);

      // Upload ảnh (nếu có)
      if (imagePath && fs.existsSync(imagePath)) {
        log('   📤 Upload ảnh sản phẩm lên Gemini...', 'info');
        const fileInputs = await geminiPage.$$('input[type="file"]');
        if (fileInputs.length > 0) {
          await fileInputs[fileInputs.length - 1].setInputFiles([imagePath]);
          await geminiPage.waitForTimeout(3000);
        }
      }

      // Tìm ô nhập và gõ prompt
      const GEMINI_INPUT_SELECTORS = [
        'div.ql-editor[contenteditable="true"]',
        'rich-textarea div[contenteditable="true"]',
        'div[contenteditable="true"][aria-label]',
        '.text-input-field div[contenteditable="true"]',
        'div[contenteditable="true"]',
      ];

      let inputLocator = null;
      for (const sel of GEMINI_INPUT_SELECTORS) {
        try {
          await geminiPage.waitForSelector(sel, { state: 'visible', timeout: 8000 });
          inputLocator = geminiPage.locator(sel).first();
          break;
        } catch (e) {}
      }

      if (!inputLocator) {
        throw new Error('Không tìm thấy ô nhập Gemini! Hãy đăng nhập trước.');
      }

      await inputLocator.click();
      await geminiPage.waitForTimeout(500);
      await inputLocator.fill(prompt);
      await geminiPage.waitForTimeout(1000);

      // Bấm nút Send
      log('   🚀 Gửi prompt cho Gemini...', 'info');
      try {
        const sendBtn = await geminiPage.waitForSelector('button.send-button, button[aria-label*="Send"], button[aria-label*="Gửi"], button[data-at="send"]', { timeout: 5000 });
        if (sendBtn) await sendBtn.click();
        else await geminiPage.keyboard.press('Enter');
      } catch (e) {
        await geminiPage.keyboard.press('Enter');
      }

      // Chờ response
      log('   ⏳ Chờ Gemini viết content...', 'info');
      let aiDesc = null;

      for (let attempt = 0; attempt < 40; attempt++) {
        await geminiPage.waitForTimeout(3000);

        // Kiểm tra đang stream hay đã xong
        const isStreaming = await geminiPage.$('mat-spinner, .loading-indicator, [data-test-id="stop-button"]');
        if (isStreaming && attempt < 35) continue;

        // Lấy text response mới nhất
        try {
          aiDesc = await geminiPage.evaluate(() => {
            // Gemini hiển thị response trong message-content hoặc model-response
            const responseEls = document.querySelectorAll(
              'message-content .markdown, model-response .markdown, .response-container .markdown, .model-response-text'
            );
            if (responseEls.length > 0) {
              return responseEls[responseEls.length - 1].innerText;
            }
            // Fallback: tìm div có class chứa "response" hoặc "answer"
            const fallbackEls = document.querySelectorAll('[class*="response"] p, [class*="answer"] p');
            if (fallbackEls.length > 0) {
              return Array.from(fallbackEls).map(el => el.innerText).join('\n');
            }
            return null;
          });
        } catch (e) {}

        if (aiDesc && aiDesc.trim().length > 20) break;
      }

      await geminiCtx.close();

      if (!aiDesc || aiDesc.trim().length < 20) {
        throw new Error('Gemini không trả về nội dung hợp lệ');
      }

      aiDesc = aiDesc.trim();
      log(`   ✅ Gemini đã viết xong (${aiDesc.length} ký tự)`, 'success');

      if (priority === '0') {
        return `🔥 NHẬN ĐẶT TRƯỚC – Model ${product.id}\nLiên hệ đặt cọc: ${phone}\n\n${aiDesc}`;
      }
      return `☎ /-v CTV: ${priceK}\nGiá đại lý/ sỉ/ số lượng lớn liên hệ: ${phone}\n\n${aiDesc}`;

    } catch (innerErr) {
      try { await geminiCtx.close(); } catch (e) {}
      throw innerErr;
    }

  } catch (error) {
    log(`   ⚠️ AI lỗi: ${error.message}, dùng văn mẫu`, 'warning');

    if (priority === '0') {
      return `🔥 NHẬN ĐẶT TRƯỚC – Model ${product.id}\nLiên hệ đặt cọc: ${phone}\n\n⌚ I&W CARNIVAL ${product.id} – SẮP VỀ HÀNG\n✨ Siêu phẩm mới, số lượng có hạn\n📩 Đặt hàng sớm để nhận giá ưu đãi!`;
    }
    return `☎ /-v CTV: ${priceK}\nGiá đại lý/ sỉ/ số lượng lớn liên hệ: ${phone}\n\n⌚ I&W CARNIVAL ${product.id} – ĐẲNG CẤP TỪNG CHI TIẾT\n✨ Điểm nổi bật:\n✔️ Bộ máy bền bỉ, chính xác\n✔️ Mặt kính Sapphire chống trầy xước\n✔️ Thiết kế sang trọng, phù hợp mọi phong cách\n✔️ Vỏ thép không gỉ chắc chắn\n✔️ Chống nước tốt cho sử dụng hàng ngày`;
  }
}
