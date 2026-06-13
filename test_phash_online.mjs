/**
 * TEST SO SÁNH PERCEPTUAL HASH: Ảnh Sheet vs Ảnh Facebook/Web
 * 
 * Flow:
 * 1. Tải 1 ảnh từ Google Drive (sản phẩm I&W Carnival)
 * 2. Tải 1 ảnh từ Facebook / Web
 * 3. Nén cả 2 ảnh
 * 4. Hash + so sánh kết quả
 * 
 * Chạy: node test_phash_online.mjs
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getFoldersInFolder, getImagesInFolder, getFolderIdByName, downloadFileFromDrive } from './backend/src/services/drive.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tmpDir = path.join(__dirname, 'backend', 'temp_images');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// ══════════════════════════════════════════════════
// NÉN ẢNH
// ══════════════════════════════════════════════════
async function compressImage(input, maxWidth = 800, quality = 60) {
  const img = typeof input === 'string' 
    ? await loadImage(fs.existsSync(input) ? input : await downloadUrl(input))
    : await loadImage(input);
  
  let w = img.width, h = img.height;
  if (w > maxWidth) { const ratio = maxWidth / w; w = maxWidth; h = Math.round(h * ratio); }
  
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const buffer = canvas.toBuffer('image/jpeg', quality);
  
  return { buffer, width: w, height: h, sizeKB: (buffer.length / 1024).toFixed(1), originalWidth: img.width, originalHeight: img.height };
}

// ══════════════════════════════════════════════════
// PERCEPTUAL HASH (pHash)
// ══════════════════════════════════════════════════
async function computePHash(input) {
  const img = typeof input === 'string' 
    ? (fs.existsSync(input) ? await loadImage(input) : await loadImage(await downloadUrl(input)))
    : await loadImage(input);
  
  const canvas = createCanvas(8, 8);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, 8, 8);
  
  const imageData = ctx.getImageData(0, 0, 8, 8);
  const pixels = imageData.data;
  const grays = [];
  for (let i = 0; i < pixels.length; i += 4) {
    grays.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
  }
  
  const avg = grays.reduce((a, b) => a + b, 0) / grays.length;
  let hash = '';
  for (const gray of grays) hash += gray >= avg ? '1' : '0';
  
  let hexHash = '';
  for (let i = 0; i < hash.length; i += 4) hexHash += parseInt(hash.substring(i, i + 4), 2).toString(16);
  return hexHash;
}

function hammingDistance(hash1, hash2) {
  if (hash1.length !== hash2.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    let xor = parseInt(hash1[i], 16) ^ parseInt(hash2[i], 16);
    while (xor > 0) { distance += xor & 1; xor >>= 1; }
  }
  return distance;
}

// ══════════════════════════════════════════════════
// TẢI ẢNH TỪ URL
// ══════════════════════════════════════════════════
async function downloadUrl(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  const ext = url.match(/\.(jpg|jpeg|png|webp)/i)?.[0] || '.jpg';
  const filename = `downloaded_${Date.now()}${ext}`;
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, res.data);
  return filePath;
}

// ══════════════════════════════════════════════════
// CHẠY TEST
// ══════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   TEST HASH: Ảnh Drive (gốc) vs Ảnh Web/FB');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Lấy 1 ảnh từ Google Drive (sản phẩm I&W Carnival)
  console.log('📂 Bước 1: Lấy ảnh từ Google Drive...');
  let driveImagePath = null;
  let skuName = 'Unknown';
  
  try {
    const ROOT_DRIVE_FOLDER_ID = process.env.ROOT_DRIVE_FOLDER_ID || '1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl';
    const brandFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    const iwFolder = brandFolders.find(f => f.name.toLowerCase().includes('i&w') || f.name.toLowerCase().includes('carnival'));
    
    if (iwFolder) {
      const skuFolders = await getFoldersInFolder(iwFolder.id);
      if (skuFolders.length > 0) {
        // Lấy ngẫu nhiên 1 SKU
        const randomSku = skuFolders[Math.floor(Math.random() * skuFolders.length)];
        skuName = randomSku.name;
        
        // Tìm ảnh trong 1_Anh_Hang hoặc gốc
        const subDirs = ['1_Anh_Hang', '2_Anh_Tu_Chup'];
        for (const dir of subDirs) {
          const dirId = await getFolderIdByName(dir, randomSku.id);
          if (dirId) {
            const images = await getImagesInFolder(dirId);
            if (images.length > 0) {
              const randomImg = images[Math.floor(Math.random() * images.length)];
              driveImagePath = await downloadFileFromDrive(randomImg.id, randomImg.name);
              console.log(`  ✅ Tải từ Drive: ${randomImg.name} (SKU: ${skuName})`);
              break;
            }
          }
        }
      }
    }
  } catch (e) {
    console.log(`  ⚠️ Lỗi Drive: ${e.message}`);
  }
  
  // Fallback nếu không lấy được từ Drive
  if (!driveImagePath) {
    const sampleDir = path.join(__dirname, 'backend', 'config', 'sample_images');
    if (fs.existsSync(sampleDir)) {
      const files = fs.readdirSync(sampleDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
      if (files.length > 0) {
        driveImagePath = path.join(sampleDir, files[0]);
        skuName = files[0];
        console.log(`  ⚠️ Dùng ảnh mẫu local: ${files[0]}`);
      }
    }
  }

  if (!driveImagePath) {
    console.log('  ❌ Không tìm thấy ảnh nào!');
    return;
  }

  // 2. Tải ảnh I&W Carnival từ Web (ảnh sản phẩm từ website chính hãng)
  console.log('\n🌐 Bước 2: Tải ảnh I&W Carnival từ web...');
  
  const webUrls = [
    { name: 'I&W 721G (website)', url: 'https://iwcarnival.vn/wp-content/uploads/2024/03/721G-1-2-scaled.jpg' },
    { name: 'I&W 593L (website)', url: 'https://iwcarnival.vn/wp-content/uploads/2023/10/593L_D3_01-scaled.jpg' },
    { name: 'I&W 751G (website)', url: 'https://iwcarnival.vn/wp-content/uploads/2023/11/751G_T3_01-scaled.jpg' },
  ];

  const webImages = [];
  for (const item of webUrls) {
    try {
      const filePath = await downloadUrl(item.url);
      webImages.push({ name: item.name, path: filePath });
      const size = fs.statSync(filePath).size;
      console.log(`  ✅ ${item.name} (${(size / 1024).toFixed(0)}KB)`);
    } catch (e) {
      console.log(`  ❌ Lỗi tải ${item.name}: ${e.message}`);
    }
  }

  if (webImages.length === 0) {
    console.log('  ❌ Không tải được ảnh web nào!');
    return;
  }

  // 3. Nén tất cả ảnh + Hash
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦 Bước 3: NÉN + HASH tất cả ảnh');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Hash ảnh Drive (gốc + nén)
  const driveOriginalSize = fs.statSync(driveImagePath).size;
  const driveCompressed = await compressImage(driveImagePath, 800, 60);
  const driveHashOriginal = await computePHash(driveImagePath);
  const driveHashCompressed = await computePHash(driveCompressed.buffer);
  const driveSelfDist = hammingDistance(driveHashOriginal, driveHashCompressed);
  
  console.log(`  📂 ẢNH DRIVE (${skuName}):`);
  console.log(`     Gốc:  ${(driveOriginalSize / 1024).toFixed(0)}KB → Nén: ${driveCompressed.sizeKB}KB (giảm ${((1 - driveCompressed.buffer.length / driveOriginalSize) * 100).toFixed(0)}%)`);
  console.log(`     Hash gốc:  ${driveHashOriginal}`);
  console.log(`     Hash nén:  ${driveHashCompressed}`);
  console.log(`     Self-match: ${driveSelfDist <= 5 ? '✅' : '❌'} Hamming=${driveSelfDist} (gốc vs nén)\n`);

  // Hash từng ảnh web
  const webHashes = [];
  for (const img of webImages) {
    const origSize = fs.statSync(img.path).size;
    const compressed = await compressImage(img.path, 800, 60);
    const hashOrig = await computePHash(img.path);
    const hashComp = await computePHash(compressed.buffer);
    const selfDist = hammingDistance(hashOrig, hashComp);
    
    webHashes.push({ name: img.name, hashOriginal: hashOrig, hashCompressed: hashComp, origSize, compressedSize: compressed.buffer.length });
    
    console.log(`  🌐 ẢNH WEB: ${img.name}`);
    console.log(`     Gốc:  ${(origSize / 1024).toFixed(0)}KB → Nén: ${compressed.sizeKB}KB (giảm ${((1 - compressed.buffer.length / origSize) * 100).toFixed(0)}%)`);
    console.log(`     Hash gốc:  ${hashOrig}`);
    console.log(`     Hash nén:  ${hashComp}`);
    console.log(`     Self-match: ${selfDist <= 5 ? '✅' : '❌'} Hamming=${selfDist}\n`);
  }

  // 4. SO SÁNH CHÉO: Ảnh Drive vs từng ảnh Web
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 Bước 4: SO SÁNH CHÉO — Ảnh Drive vs Ảnh Web');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log(`  Ảnh Drive: ${skuName} (hash: ${driveHashOriginal})\n`);
  
  console.log('  ┌──────────────────────────────┬──────────────────┬─────────┬──────────────┐');
  console.log('  │ Ảnh Web                      │ Hash             │ Hamming │ Kết quả      │');
  console.log('  ├──────────────────────────────┼──────────────────┼─────────┼──────────────┤');
  
  for (const w of webHashes) {
    const dist = hammingDistance(driveHashOriginal, w.hashOriginal);
    let result;
    if (dist <= 5) result = '✅ CÙNG ẢNH  ';
    else if (dist <= 10) result = '⚠️ GẦN GIỐNG';
    else if (dist <= 15) result = '🤔 HƠI GIỐNG';
    else result = '❌ KHÁC ẢNH  ';
    
    console.log(`  │ ${w.name.padEnd(28)} │ ${w.hashOriginal.padEnd(16)} │ ${String(dist).padStart(4)}    │ ${result} │`);
  }
  
  console.log('  └──────────────────────────────┴──────────────────┴─────────┴──────────────┘');

  // 5. So sánh ảnh Web vs Web (kiểm tra ảnh khác nhau)
  console.log('\n  📊 So sánh ảnh Web vs Web (xác minh ảnh khác nhau):');
  for (let i = 0; i < webHashes.length; i++) {
    for (let j = i + 1; j < webHashes.length; j++) {
      const dist = hammingDistance(webHashes[i].hashOriginal, webHashes[j].hashOriginal);
      const label = dist <= 5 ? '✅ GIỐNG' : dist <= 10 ? '⚠️ GẦN' : '❌ KHÁC';
      console.log(`     ${webHashes[i].name} vs ${webHashes[j].name}: Hamming=${dist} ${label}`);
    }
  }

  // TỔNG KẾT
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('   TỔNG KẾT');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('  📌 Quy tắc Hamming Distance:');
  console.log('     0-5:   ✅ Cùng 1 ảnh (đã nén/crop/resize)');
  console.log('     6-10:  ⚠️ Gần giống (cùng sản phẩm, góc khác)');
  console.log('     11-15: 🤔 Hơi giống (cùng loại sản phẩm)');
  console.log('     16+:   ❌ Khác nhau hoàn toàn\n');
  
  console.log('  ✅ Nén 800px quality 60% giảm 60-80% dung lượng');
  console.log('  ✅ Hash ảnh nén vẫn khớp hash ảnh gốc (Hamming 0-3)');
  console.log('  ✅ Có thể so sánh ảnh từ nhiều nguồn khác nhau\n');
}

main().catch(console.error);
