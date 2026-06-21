/**
 * Worker chạy trong child process riêng biệt
 * Nhận đường dẫn ảnh qua IPC, xóa nền, trả buffer về
 */
import { removeBackground } from '@imgly/background-removal-node';
import fs from 'fs';
import path from 'path';

const imagePath = process.argv[2];

if (!imagePath || !fs.existsSync(imagePath)) {
  console.error('File not found:', imagePath);
  process.exit(1);
}

async function run() {
  try {
    const fileBuffer = fs.readFileSync(imagePath);
    const blob = new Blob([fileBuffer], { type: 'image/png' });
    const imageBlob = await removeBackground(blob, {
      debug: false,
      model: 'medium',
    });
    const arrayBuffer = await imageBlob.arrayBuffer();
    const resultBuffer = Buffer.from(arrayBuffer);

    // Ghi kết quả ra file tạm (PNG transparent)
    const outputPath = imagePath + '.nobg.png';
    fs.writeFileSync(outputPath, resultBuffer);
    
    // Trả đường dẫn output qua stdout
    console.log('OUTPUT:' + outputPath);
    process.exit(0);
  } catch (error) {
    console.error('BG_REMOVE_ERROR:', error.message);
    process.exit(1);
  }
}

run();
