import { createCanvas, loadImage, registerFont } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import imglyRemoveBackground from '@imgly/background-removal-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// CẤU HÌNH TỌA ĐỘ VÀ KÍCH THƯỚC (Mock data - Đợi Sếp chốt)
// ==========================================
const BANNER_CONFIG = {
  templatePath: path.join(__dirname, '../../assets/banner_template/Background.jpg'),
  fontPath: path.join(__dirname, '../../assets/banner_template/CustomFont.ttf'), // Thay tên font sau
  fontName: 'BannerFont',
  
  // Tọa độ 3 đồng hồ (X, Y là điểm bắt đầu góc trên bên trái, W H là kích thước)
  watches: {
    left: { x: 168, y: 397, width: 353, height: 568 },
    center: { x: 448, y: 397, width: 353, height: 568 },
    right: { x: 734, y: 398, width: 353, height: 568 }
  },
  
  // Tọa độ chữ Mã SP
  text: {
    x: 460, // Căn trái theo PTS
    y: 985, // Theo PTS
    fontSize: 45, // Tương đương 42.84pt
    color: '#FFFF00', // Màu vàng chói theo PTS
    align: 'left',
    baseline: 'top'
  }
};

/**
 * Hàm xóa phông ảnh tự động bằng AI (Offline)
 */
async function removeBackground(imagePath) {
  try {
    console.log(`[Banner] Đang bóc nền ảnh bằng AI: ${path.basename(imagePath)}...`);
    const fileBuffer = fs.readFileSync(imagePath);
    const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
    const imageBlob = await imglyRemoveBackground(blob);
    const arrayBuffer = await imageBlob.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.warn(`[Banner] Cảnh báo: AI xóa nền lỗi (${error.message}). Tạm thời trả về ảnh gốc...`);
    return fs.readFileSync(imagePath);
  }
}

// Hàm vẽ ảnh giữ nguyên tỉ lệ (object-fit: contain)
function drawImageContain(ctx, img, boxX, boxY, boxWidth, boxHeight) {
  const ratio = Math.min(boxWidth / img.width, boxHeight / img.height);
  const newWidth = img.width * ratio;
  const newHeight = img.height * ratio;
  const drawX = boxX + (boxWidth - newWidth) / 2;
  const drawY = boxY + (boxHeight - newHeight) / 2;
  ctx.drawImage(img, drawX, drawY, newWidth, newHeight);
}

/**
 * Hàm chính để sinh ra Banner Bộ Sưu Tập
 * @param {Array} imagePaths - Mảng chứa 3 đường dẫn ảnh gốc (Trái, Giữa, Phải)
 * @param {String} skuText - Đoạn text mã SP (VD: "735G1-T")
 * @returns {String} Đường dẫn file banner đã tạo xong
 */
export async function generateCollectionBanner(imagePaths, skuText) {
  if (imagePaths.length !== 3) {
    throw new Error('Cần đúng 3 ảnh để tạo banner bộ sưu tập!');
  }

  try {
    // 1. Kiểm tra tài nguyên
    if (!fs.existsSync(BANNER_CONFIG.templatePath)) {
      throw new Error(`Thiếu file Background tại: ${BANNER_CONFIG.templatePath}`);
    }

    // Load font nếu có
    if (fs.existsSync(BANNER_CONFIG.fontPath)) {
      registerFont(BANNER_CONFIG.fontPath, { family: BANNER_CONFIG.fontName });
    }

    // 2. Bóc nền bằng AI imgly
    console.log('[Banner] Đang bóc nền 3 ảnh bằng AI...');
    const [bgLeftBuffer, bgCenterBuffer, bgRightBuffer] = await Promise.all([
      removeBackground(imagePaths[0]),
      removeBackground(imagePaths[1]),
      removeBackground(imagePaths[2])
    ]);

    // 3. Load Background Image
    const bgImage = await loadImage(BANNER_CONFIG.templatePath);
    console.log(`[Banner] Background size: ${bgImage.width}x${bgImage.height}`);
    
    // Tạo Canvas bằng đúng kích thước của Background
    const canvas = createCanvas(bgImage.width, bgImage.height);
    const ctx = canvas.getContext('2d');

    // Vẽ Background lót dưới cùng
    ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);

    // 4. Load 3 ảnh đã bóc nền thành Object ảnh của Canvas
    const [imgLeft, imgCenter, imgRight] = await Promise.all([
      loadImage(bgLeftBuffer),
      loadImage(bgCenterBuffer),
      loadImage(bgRightBuffer)
    ]);

    // Vẽ 3 đồng hồ đè lên (Giữ tỉ lệ)
    console.log('[Banner] Đang ghép đồng hồ vào bục trưng bày...');
    drawImageContain(ctx, imgLeft, BANNER_CONFIG.watches.left.x, BANNER_CONFIG.watches.left.y, BANNER_CONFIG.watches.left.width, BANNER_CONFIG.watches.left.height);
    drawImageContain(ctx, imgCenter, BANNER_CONFIG.watches.center.x, BANNER_CONFIG.watches.center.y, BANNER_CONFIG.watches.center.width, BANNER_CONFIG.watches.center.height);
    drawImageContain(ctx, imgRight, BANNER_CONFIG.watches.right.x, BANNER_CONFIG.watches.right.y, BANNER_CONFIG.watches.right.width, BANNER_CONFIG.watches.right.height);

    // 6. Lưu kết quả ra file Temp
    const tempDir = path.join(__dirname, '../../temp_images');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const outPath = path.join(tempDir, `banner_${Date.now()}.jpg`);
    const out = fs.createWriteStream(outPath);
    const stream = canvas.createJPEGStream({ quality: 0.95 });
    
    return new Promise((resolve, reject) => {
      stream.pipe(out);
      out.on('finish', () => {
        console.log(`[Banner] ✅ Đã tạo thành công Banner tại: ${outPath}`);
        resolve(outPath);
      });
      out.on('error', reject);
    });

  } catch (error) {
    console.error('[Banner] Lỗi sinh ảnh banner:', error);
    throw error;
  }
}
