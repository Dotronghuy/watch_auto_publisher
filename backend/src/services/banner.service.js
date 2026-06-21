import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// CẤU HÌNH TỌA ĐỘ VÀ KÍCH THƯỚC (Background 1254x1254)
// ==========================================
const BANNER_CONFIG = {
  templatePath: path.join(__dirname, '../../assets/banner_template/Background.jpg'),

  // Layout 3 đồng hồ (Trái + Giữa + Phải)
  triple: {
    left:   { x: 72,  y: 380, width: 460, height: 640 },
    center: { x: 380, y: 330, width: 500, height: 690 },
    right:  { x: 670, y: 380, width: 460, height: 640 }
  },

  // Layout 2 đồng hồ (Trái + Giữa, cân đối chính giữa canvas)
  double: {
    left:   { x: 120, y: 360, width: 480, height: 660 },
    center: { x: 530, y: 320, width: 510, height: 700 }
  },

  // Layout 1 đồng hồ (chỉ Giữa, to lớn chính giữa)
  single: {
    center: { x: 340, y: 300, width: 570, height: 720 }
  }
};

// Đường dẫn tới worker script
const WORKER_PATH = path.join(__dirname, '../workers/bg-remove.worker.js');

/**
 * Xóa nền ảnh bằng AI — chạy trong child process riêng để tránh crash server
 */
function removeBackgroundAI(imagePath) {
  return new Promise((resolve, reject) => {
    console.log(`[Banner] Đang bóc nền (child process): ${path.basename(imagePath)}...`);
    
    const child = execFile('node', [WORKER_PATH, imagePath], {
      timeout: 120000, // 2 phút timeout
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        console.warn(`[Banner] ⚠️ AI xóa nền lỗi: ${error.message}. Thử sharp fallback...`);
        removeWhiteBackgroundSharp(imagePath).then(resolve).catch(reject);
        return;
      }

      const lines = stdout.split('\n');
      const outputLine = lines.find(l => l.startsWith('OUTPUT:'));
      if (outputLine) {
        const outputPath = outputLine.replace('OUTPUT:', '').trim();
        if (fs.existsSync(outputPath)) {
          const buf = fs.readFileSync(outputPath);
          console.log(`[Banner] ✅ Bóc nền thành công: ${path.basename(imagePath)} (${buf.length} bytes)`);
          resolve(buf);
          try { fs.unlinkSync(outputPath); } catch(e) {}
          return;
        }
      }

      console.warn(`[Banner] ⚠️ Worker không trả output. Thử sharp fallback...`);
      removeWhiteBackgroundSharp(imagePath).then(resolve).catch(reject);
    });
  });
}

/**
 * Fallback: Xóa nền trắng bằng sharp (khi AI lỗi)
 */
async function removeWhiteBackgroundSharp(imagePath) {
  try {
    const { data, info } = await sharp(imagePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    const threshold = 240;

    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r >= threshold && g >= threshold && b >= threshold) {
        data[i + 3] = 0;
      }
    }

    const resultBuffer = await sharp(data, { raw: { width, height, channels } })
      .png()
      .toBuffer();

    console.log(`[Banner] ✅ Xóa nền trắng bằng sharp thành công: ${path.basename(imagePath)}`);
    return resultBuffer;
  } catch (err) {
    console.error(`[Banner] ❌ Sharp fallback cũng lỗi: ${err.message}. Trả về ảnh gốc.`);
    return fs.readFileSync(imagePath);
  }
}

/**
 * Resize ảnh đồng hồ vào bounding box, căn giữa-dưới
 */
async function resizeWatchForBox(watchBuffer, boxWidth, boxHeight) {
  const meta = await sharp(watchBuffer).metadata();
  // Tỷ lệ scale: 1.0 = vừa khít box
  const ratio = Math.max(boxWidth / meta.width, boxHeight / meta.height) * 1.0;
  const newWidth = Math.round(meta.width * ratio);
  const newHeight = Math.round(meta.height * ratio);

  const resizedBuffer = await sharp(watchBuffer)
    .resize(newWidth, newHeight, { fit: 'fill' })
    .png()
    .toBuffer();

  return { buffer: resizedBuffer, width: newWidth, height: newHeight };
}

/**
 * Hàm chính để sinh ra Banner Bộ Sưu Tập
 * @param {Object} images - Object chứa ảnh theo vị trí: { left?, center, right? }
 * @param {String} skuText - Đoạn text mã SP
 * @returns {String} Đường dẫn file banner đã tạo xong
 */
export async function generateCollectionBanner(images, skuText) {
  // Xác định layout dựa trên số lượng ảnh
  const hasLeft   = !!images.left;
  const hasCenter = !!images.center;
  const hasRight  = !!images.right;

  if (!hasCenter) {
    throw new Error('Phải có ít nhất ảnh giữa (center/bannerPosition=1) để tạo banner!');
  }

  let layoutName;
  let layoutConfig;

  if (hasLeft && hasRight) {
    layoutName = 'triple';
    layoutConfig = BANNER_CONFIG.triple;
  } else if (hasLeft || hasRight) {
    layoutName = 'double';
    layoutConfig = BANNER_CONFIG.double;
  } else {
    layoutName = 'single';
    layoutConfig = BANNER_CONFIG.single;
  }

  const imageCount = (hasLeft ? 1 : 0) + 1 + (hasRight ? 1 : 0);
  console.log(`[Banner] Layout: ${layoutName} (${imageCount} đồng hồ)`);

  try {
    // 1. Kiểm tra tài nguyên
    if (!fs.existsSync(BANNER_CONFIG.templatePath)) {
      throw new Error(`Thiếu file Background tại: ${BANNER_CONFIG.templatePath}`);
    }

    // 2. Bóc nền các ảnh (tuần tự, child process)
    console.log(`[Banner] Đang bóc nền ${imageCount} ảnh...`);
    const bgBuffers = {};
    
    if (hasLeft) {
      bgBuffers.left = await removeBackgroundAI(images.left);
    }
    bgBuffers.center = await removeBackgroundAI(images.center);
    if (hasRight) {
      bgBuffers.right = await removeBackgroundAI(images.right);
    }

    // 3. Xây dựng composite inputs theo layout
    console.log('[Banner] Đang resize và ghép đồng hồ...');
    const compositeInputs = [];

    // Thứ tự vẽ: phía sau trước, giữa cuối cùng (nằm trên)
    let drawOrder;
    if (layoutName === 'triple') {
      drawOrder = ['left', 'right', 'center']; // Giữa vẽ cuối = phía trước
    } else if (layoutName === 'double') {
      if (hasLeft) {
        drawOrder = ['left', 'center']; // Giữa vẽ cuối = phía trước
      } else {
        drawOrder = ['center', 'right']; // Phải vẽ cuối nếu chỉ có center+right
      }
    } else {
      drawOrder = ['center'];
    }

    for (const pos of drawOrder) {
      if (!bgBuffers[pos] || !layoutConfig[pos]) continue;

      const box = layoutConfig[pos];
      const { buffer, width, height } = await resizeWatchForBox(bgBuffers[pos], box.width, box.height);

      // Căn giữa ngang, căn dưới dọc (đồng hồ đứng trên bục)
      const left = Math.round(box.x + (box.width - width) / 2);
      const top = Math.round(box.y + (box.height - height));

      compositeInputs.push({
        input: buffer,
        top: Math.max(0, top),
        left: Math.max(0, left),
      });
    }

    // 4. Composite lên background bằng sharp
    console.log('[Banner] Đang ghép đồng hồ vào bục trưng bày...');
    const tempDir = path.join(__dirname, '../../temp_images');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const outPath = path.join(tempDir, `banner_${Date.now()}.jpg`);

    await sharp(BANNER_CONFIG.templatePath)
      .composite(compositeInputs)
      .jpeg({ quality: 95 })
      .toFile(outPath);

    console.log(`[Banner] ✅ Đã tạo thành công Banner (${layoutName}) tại: ${outPath}`);
    return outPath;

  } catch (error) {
    console.error('[Banner] Lỗi sinh ảnh banner:', error);
    throw error;
  }
}
