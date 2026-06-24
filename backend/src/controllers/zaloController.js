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
    // Dùng CSV thay vì xlsx để tránh crash (xlsx 37MB vs CSV 39KB)
    const exportUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;

    const response = await fetch(exportUrl);
    if (!response.ok) throw new Error('Không thể tải Google Sheet');
    const csvText = await response.text();
    const workbook = xlsx.read(csvText, { type: 'string' });

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

    // ====== BƯỚC 6: Đăng bài (Zalo browser chỉ mở khi cần) ======
    let postsDone = 0;

    while (postsDone < postsPerSession) {
      if (signal.aborted) throw new Error('Đã dừng.');

      const product = pickWeightedProduct();
      if (!product) {
        log('⚠️ Hết mã SP để đăng!', 'warning');
        break;
      }

      // Tìm folder trên Drive khớp ĐÚNG tên mã SKU (VD: "735G2-D2")
      const skuFolder = skuFolders.find(f =>
        f.name.toUpperCase() === product.id.toUpperCase()
      ) || skuFolders.find(f =>
        f.name.toUpperCase().includes(product.id.toUpperCase())
      );

      if (!skuFolder) {
        log(`⚠️ Không tìm thấy folder [${product.id}] trên Drive, bỏ qua...`, 'warning');
        continue;
      }

      // Tìm ảnh: CHỈ lấy từ Anh_Hang hoặc Anh_Tu_Chup
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

      // KHÔNG fallback - chỉ dùng Anh_Hang hoặc Anh_Tu_Chup
      if (candidateFolders.length === 0) {
        log(`⚠️ ${product.id} không có ảnh trong cả Anh_Hang lẫn Anh_Tu_Chup, bỏ qua`, 'warning');
        continue;
      }

      // Random chọn 1 folder, lấy HẾT ảnh (vì mỗi folder SKU đã tách riêng biến thể)
      const chosen = candidateFolders[Math.floor(Math.random() * candidateFolders.length)];
      
      // Sắp xếp ảnh theo số thứ tự (_01, _02, _03...)
      chosen.images.sort((a, b) => {
        const numA = parseInt((a.name.match(/_(\d+)\.\w+$/) || [, '999'])[1]);
        const numB = parseInt((b.name.match(/_(\d+)\.\w+$/) || [, '999'])[1]);
        return numA - numB;
      });
      
      images = chosen.images;
      log(`📸 Folder [${skuFolder.name}] → [${chosen.folder.name}] → ${images.length} ảnh (sắp xếp _01→)`, 'info');

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

      // Tạo content bằng AI TRƯỚC - gửi ảnh _01 (đầu tiên sau sort) cho Gemini
      log('🤖 AI đang viết bài bán hàng... (gửi ảnh _01 cho Gemini)', 'info');
      const postContent = await generateZaloContentSmart(product, localPaths[0], phone, contentTone, skuFolder.name, product.priority);

      // Mở Zalo browser (lazy init - chỉ mở 1 lần, SAU khi Gemini xong)
      if (!browser) {
        log('🤖 Khởi động trình duyệt Zalo...', 'info');
        const userDataDir = path.join(__dirname, '../../zalo_profile');
        if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
        browser = await chromium.launchPersistentContext(userDataDir, {
          headless: false,
          args: ['--disable-notifications'],
          viewport: { width: 1280, height: 800 }
        });
      }

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

      // Tắt hoàn toàn trình duyệt Zalo trong lúc nghỉ ngơi để giải phóng RAM
      if (browser) {
        try { await browser.close(); } catch (e) {}
        browser = null;
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
      log('🔒 Đang tắt trình duyệt Zalo...', 'info');
      try { await browser.close(); } catch (e) {}
      browser = null;
    }
    log('✅ Chiến dịch đã kết thúc, tất cả trình duyệt đã đóng.', 'success');
    isZaloRunning = false;
  }
}

// ============== AI Content Generator (Playwright → gemini.google.com) ================= //

async function generateZaloContentSmart(product, imagePath, phone, toneKey, skuName, priority = '1') {
  try {
    // Lấy thông số SP từ Google Sheets (nếu có)
    let specsText = '';
    let giaCTV = '';
    try {
      const productInfo = await getProductInfoBySku(skuName || product.id);
      if (productInfo) {
        specsText = Object.entries(productInfo).map(([k, v]) => `${k}: ${v}`).join('\n');
        // Ưu tiên lấy Giá CTV từ Google Sheet Products (cột T)
        if (productInfo['Giá CTV']) {
          giaCTV = String(productInfo['Giá CTV']).replace(/\D/g, '');
        }
      }
    } catch (e) { /* ignore */ }

    // Detect giới tính từ mã SKU
    const skuUp = (skuName || product.id || '').toUpperCase();
    let gender = 'Unisex';
    if (/\dG$|G\d|\dG\d/.test(skuUp)) gender = 'Nam';
    else if (/\dL$|L\d|\dL\d/.test(skuUp)) gender = 'Nữ';

    // Format giá: Ưu tiên Giá CTV từ Products Sheet, fallback về priceRaw từ Sheet cũ
    let priceK;
    if (giaCTV && parseInt(giaCTV) > 0) {
      priceK = Math.floor(parseInt(giaCTV) / 1000) + 'k';
    } else {
      let rawPrice = String(product.priceRaw).replace(/\D/g, '');
      priceK = rawPrice ? Math.floor(parseInt(rawPrice) / 1000) + 'k' : 'Liên hệ';
    }

    log(`   🎨 Giới tính: ${gender} | Giá CTV: ${priceK} | Nhóm: ${priority}`, 'info');

    let prompt;

    if (priority === '0') {
      // === TEMPLATE PRE-ORDER (Nhóm 0 - Chưa bán, mời đặt hàng) ===
      prompt = `Bạn là copywriter chuyên viết bài đồng hồ cho NHÓM ZALO BÁN SỈ / CTV.

Sản phẩm này CHƯA CÓ SẴN và KHÔNG CÓ THÔNG SỐ KỸ THUẬT. Viết bài PRE-ORDER / MỜI ĐẶT HÀNG TRƯỚC.

Nhìn ảnh và viết bài theo format:

(1 emoji cháy nổ/hot) I&W CARNIVAL ${product.id} – [TIÊU ĐỀ HẤP DẪN, VIẾT HOA]
(1 emoji) SẮP VỀ HÀNG – NHẬN ĐẶT TRƯỚC!
(1 emoji) [Mô tả vẻ đẹp/thiết kế dựa trên NHÌN ẢNH – màu sắc, kiểu dáng, cảm nhận chung]
(1 emoji) [Mô tả thêm 1 điểm ấn tượng khi nhìn ảnh – chất liệu, mặt số, phong cách]
(1 emoji) Đặt hàng sớm để nhận giá ưu đãi!

Giới tính: ${gender}

QUY TẮC QUAN TRỌNG:
- TUYỆT ĐỐI KHÔNG bịa thông số (size, độ dày, bộ máy, chống nước) vì sản phẩm chưa có thông tin
- Chỉ mô tả những gì NHÌN THẤY trong ảnh (màu mặt số, kiểu dây, phong cách tổng thể)
- Tạo cảm giác KHAN HIẾM, SỐ LƯỢNG CÓ HẠN, FOMO
- Ở mỗi dòng, BẮT BUỘC chèn 1 emoji sinh động, đa dạng và phù hợp ngữ cảnh. KHÔNG lặp lại emoji.
- KHÔNG in ra chữ "emoji"
- KHÔNG viết hashtag, KHÔNG đề cập giá
- CHỈ TRẢ VỀ NỘI DUNG, KHÔNG GIẢI THÍCH`;
    } else {
      // Random chọn 1 trong 2 template cho nhóm 1 + 2
      const templateIdx = Math.floor(Math.random() * 2);

      if (templateIdx === 0) {
        // === TEMPLATE 1: Thông số kỹ thuật chi tiết ===
        prompt = `Bạn là copywriter chuyên viết bài đăng đồng hồ cho NHÓM ZALO BÁN SỈ / CTV (cộng tác viên).

Nhìn ảnh sản phẩm và viết bài đăng theo ĐÚNG FORMAT sau (giữ nguyên cấu trúc):

(1 emoji đồng hồ) I&W CARNIVAL ${product.id} [TỰ ĐỘNG/AUTOMATIC nếu có] – [TIÊU ĐỀ NGẮN GỌN, SÚC TÍCH, VIẾT HOA] (1 emoji sao)
(1 emoji nổi bật) Điểm nổi bật:
(1 emoji) Bộ máy: [tên bộ máy nếu biết, hoặc nhìn ảnh đoán]
(1 emoji) Size mặt: [đường kính mm] – Độ dày: [mm]  
(1 emoji) Chất liệu vỏ/dây: [thép không gỉ/da/...]
(1 emoji) Mặt kính: [Sapphire/Mineral/...]
(1 emoji) Chống nước: [ATM/mét]
(1 emoji) Thiết kế: [mô tả ngắn 1 dòng về phong cách]

${specsText ? `THÔNG SỐ TỪ HỆ THỐNG:\n${specsText}` : 'TỰ NHÌN ẢNH phân tích thông số.'}
Giới tính: ${gender}

QUY TẮC:
- BẮT BUỘC PHẢI VIẾT ĐỦ 6 GẠCH ĐẦU DÒNG THÔNG SỐ (Bộ máy, Size mặt, Chất liệu, Mặt kính, Chống nước, Thiết kế), tuyệt đối không được thiếu dòng nào. Dựa vào thông số từ hệ thống để điền, nếu không có thì nhìn ảnh tự đoán.
- Thay các đoạn "(1 emoji...)" bằng 1 EMOJI THẬT sự sáng tạo, đa dạng, không lặp lại.
- Tuyệt đối KHÔNG in ra chữ "(1 emoji)" trong bài viết.
- KHÔNG viết hashtag
- KHÔNG đề cập giá
- VIẾT ĐÚNG theo giới tính: ${gender === 'Nữ' ? 'nữ tính (thanh lịch, tôn da, nhẹ nhàng, quý phái)' : 'nam tính (lịch lãm, phong độ, mạnh mẽ, sang trọng)'}
- CHỈ TRẢ VỀ NỘI DUNG BÀI VIẾT, KHÔNG GIẢI THÍCH GÌ THÊM`;
      } else {
        // === TEMPLATE 2: Bullet highlights ngắn gọn ===
        prompt = `Bạn là copywriter chuyên viết bài cho NHÓM ZALO BÁN SỈ / CTV đồng hồ.

Nhìn ảnh và viết bài đăng theo style sau:

(1 emoji sang trọng) I&W Carnival ${product.id} - [Câu mô tả ngắn hấp dẫn, viết hoa chữ cái đầu]
(1 emoji) [Mô tả chi tiết mặt kính, chất liệu kính (VD: Sapphire nguyên khối...)]
(1 emoji) [Mô tả chi tiết bộ máy (VD: Automatic tự động vận hành êm ái...)]
(1 emoji) [Mô tả vỏ/dây (VD: Vỏ thép 316L không gỉ mạ PVD...)]
(1 emoji) [Ghi thông số Size mặt (mm) và độ dày (mm)]
(1 emoji) [Mô tả dây đeo (VD: Dây da cao cấp/dây kim loại đúc đặc...)]
(1 emoji) [Ghi thông số chịu nước (VD: Chống nước 5ATM/50M...)]

${specsText ? `THÔNG SỐ TỪ HỆ THỐNG:\n${specsText}` : 'TỰ NHÌN ẢNH phân tích thông số.'}
Giới tính: ${gender}

QUY TẮC:
- BẮT BUỘC PHẢI CÓ ĐẦY ĐỦ TẤT CẢ 6 DÒNG THÔNG SỐ TRÊN, tuyệt đối không được gộp, không được bớt. Phải nhìn thông số từ hệ thống để chèn vào.
- Thay các đoạn "(1 emoji...)" bằng 1 EMOJI THẬT sự đa dạng, liên quan đến nội dung dòng đó.
- Tuyệt đối KHÔNG in ra chữ "(1 emoji)" trong bài viết.
- Viết tự nhiên, cuốn hút, có cảm xúc, KHÔNG khô khan liệt kê
- KHÔNG viết hashtag, KHÔNG đề cập giá
- ${gender === 'Nữ' ? 'Dùng từ nữ tính: thanh lịch, tôn da, nhẹ nhàng' : 'Dùng từ nam tính: lịch lãm, phong độ, sang trọng'}
- CHỈ TRẢ VỀ NỘI DUNG, KHÔNG GIẢI THÍCH GÌ THÊM`;
      }
    }

    // ====== Toggle Check: Dùng Gemini API thay Playwright? ======
    const allowZalo = await prisma.setting.findUnique({ where: { key: 'gemini_allow_zalo' } });
    if (allowZalo && allowZalo.value === 'true') {
      log('   [Toggle] ✅ Dùng Gemini API viết Zalo content (thay Playwright)...', 'info');
      try {
        const geminiSetting = await prisma.setting.findUnique({ where: { key: 'gemini_api_key' } });
        const geminiKeys = (geminiSetting?.value || '').split(',').map(k => k.trim()).filter(k => k !== '');
        if (geminiKeys.length === 0) throw new Error('Không có Gemini API Key!');
        
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        let aiResult = null;
        
        for (let i = 0; i < geminiKeys.length; i++) {
          try {
            const ai = new GoogleGenerativeAI(geminiKeys[i]);
            const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const parts = [prompt];
            if (imagePath && fs.existsSync(imagePath)) {
              const base64Data = fs.readFileSync(imagePath, { encoding: 'base64' });
              const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
              parts.push({ inlineData: { data: base64Data, mimeType } });
            }
            const result = await model.generateContent(parts);
            aiResult = result.response.text().trim();
            break;
          } catch (err) {
            if (err.message?.includes('429') || err.message?.includes('503')) {
              await new Promise(r => setTimeout(r, 5000));
              continue;
            }
            break;
          }
        }
        
        if (aiResult && aiResult.length > 20) {
          log(`   [Toggle] ✅ Gemini API viết xong (${aiResult.length} ký tự)`, 'success');
          if (priority === '0') {
            return `🔥 NHẬN ĐẶT TRƯỚC – Model ${product.id}\nLiên hệ đặt cọc: ${phone}\n\n${aiResult}`;
          }
          return `☎ /-v CTV: ${priceK}\nGiá đại lý/ sỉ/ số lượng lớn liên hệ: ${phone}\n\n${aiResult}`;
        }
      } catch (apiErr) {
        log(`   [Toggle] ⚠️ Gemini API lỗi, fallback về Playwright: ${apiErr.message}`, 'warning');
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

      // Upload ảnh sản phẩm lên Gemini (UI mới: click "+" → "Files")
      if (imagePath && fs.existsSync(imagePath)) {
        log('   📤 Upload ảnh sản phẩm lên Gemini...', 'info');
        let imgUploaded = false;

        // Cách 1: Tìm input[type=file] ẩn (UI cũ)
        try {
          const fileInputs = await geminiPage.$$('input[type="file"]');
          if (fileInputs.length > 0) {
            await fileInputs[fileInputs.length - 1].setInputFiles([imagePath]);
            await geminiPage.waitForTimeout(3000);
            // Kiểm tra xem có thumbnail ảnh xuất hiện không
            const hasPreview = await geminiPage.$('img[class*="preview"], img[class*="thumbnail"], [class*="attachment"], [class*="chip"]');
            if (hasPreview) {
              imgUploaded = true;
              log('   ✅ Upload ảnh qua input[file] thành công', 'info');
            }
          }
        } catch (e) {}

        // Cách 2: Click nút "+" mở popup menu → click "Files" (UI mới Gemini 2025+)
        if (!imgUploaded) {
          try {
            log('   🔍 Thử upload qua menu "+" của Gemini...', 'info');
            // Tìm nút "+" (thường là nút đầu tiên gần ô nhập)
            const plusBtnSelectors = [
              'button[aria-label*="Add"]',
              'button[aria-label*="Thêm"]',
              'button[aria-label*="attachment"]',
              'button[aria-label*="more"]',
              'button[aria-label*="More"]',
              '.input-area-container button',
            ];

            let menuOpened = false;
            for (const sel of plusBtnSelectors) {
              try {
                const btns = await geminiPage.$$(sel);
                for (const btn of btns) {
                  if (await btn.isVisible()) {
                    await btn.click();
                    await geminiPage.waitForTimeout(1500);
                    // Kiểm tra popup menu có mở không (tìm text "Files")
                    const filesText = await geminiPage.$('text=Files');
                    if (filesText) {
                      menuOpened = true;
                      break;
                    }
                    // Đóng popup nếu không đúng
                    await geminiPage.keyboard.press('Escape');
                    await geminiPage.waitForTimeout(300);
                  }
                }
                if (menuOpened) break;
              } catch (e) {}
            }

            if (menuOpened) {
              // Click "Files" trong popup
              const [fileChooser] = await Promise.all([
                geminiPage.waitForEvent('filechooser', { timeout: 8000 }),
                geminiPage.locator('text=Files').first().click()
              ]);
              await fileChooser.setFiles([imagePath]);
              await geminiPage.waitForTimeout(4000);
              imgUploaded = true;
              log('   ✅ Upload ảnh qua menu Files thành công!', 'info');
            }
          } catch (e) {
            log(`   ⚠️ Menu Files lỗi: ${e.message}`, 'warning');
            // Đóng popup nếu đang mở
            try { await geminiPage.keyboard.press('Escape'); } catch (e2) {}
          }
        }

        if (!imgUploaded) {
          log('   ⚠️ Không upload được ảnh, AI sẽ viết dựa trên thông số', 'warning');
          try { await geminiPage.keyboard.press('Escape'); } catch (e) {}
          await geminiPage.waitForTimeout(500);
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
      let lastAiDesc = null;
      let sameTextCount = 0;

      for (let attempt = 0; attempt < 60; attempt++) {
        await geminiPage.waitForTimeout(2000);

        // Lấy text response mới nhất
        try {
          aiDesc = await geminiPage.evaluate(() => {
            // Lấy tất cả các block trả lời
            const responseEls = document.querySelectorAll(
              'message-content .markdown, model-response .markdown, .response-container .markdown, .model-response-text'
            );
            if (responseEls.length > 0) {
              return responseEls[responseEls.length - 1].innerText;
            }
            // Fallback
            const fallbackEls = document.querySelectorAll('[class*="response"] p, [class*="answer"] p');
            if (fallbackEls.length > 0) {
              return Array.from(fallbackEls).map(el => el.innerText).join('\n');
            }
            return null;
          });
        } catch (e) {}

        // Kiểm tra logic dừng: text phải > 50 ký tự và KHÔNG thay đổi trong 5 lần lặp (tức ~10 giây)
        if (aiDesc && aiDesc.trim().length > 50) {
          if (aiDesc === lastAiDesc) {
            sameTextCount++;
            if (sameTextCount >= 5) {
              // 10 giây không có text mới -> Chắc chắn Gemini đã viết xong
              break;
            }
          } else {
            sameTextCount = 0;
            lastAiDesc = aiDesc;
          }
        }
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
