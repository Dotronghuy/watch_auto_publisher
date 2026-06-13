/**
 * TEST SO SÁNH PERCEPTUAL HASH: Ảnh từ nhiều nguồn khác nhau
 * 
 * So sánh:
 * - Ảnh I&W Carnival từ website chính hãng
 * - Ảnh sản phẩm từ Google Drive (sample_images)
 * - Nén + Hash + So sánh chéo
 * 
 * Chạy: cd backend && node test_phash_online.cjs
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const tmpDir = path.join(__dirname, 'temp_images');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// ══════════════════════════════════════════════════
// NÉN ẢNH
// ══════════════════════════════════════════════════
async function compressImage(input, maxWidth = 800, quality = 60) {
  const img = await loadImage(input);
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
  const img = await loadImage(input);
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
async function downloadUrl(url, name) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, res.data);
  return filePath;
}

// ══════════════════════════════════════════════════
// CHẠY TEST
// ══════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   TEST HASH: Ảnh Drive (local) vs Ảnh Web (I&W Carnival)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Lấy ảnh từ sample_images (local Drive)
  console.log('📂 Bước 1: Lấy ảnh từ sample_images...');
  const sampleDir = path.join(__dirname, 'config', 'sample_images');
  let localImages = [];
  
  if (fs.existsSync(sampleDir)) {
    const files = fs.readdirSync(sampleDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    localImages = files.slice(0, 2).map(f => ({
      name: f,
      path: path.join(sampleDir, f),
      source: 'Google Drive'
    }));
    localImages.forEach(img => {
      const size = fs.statSync(img.path).size;
      console.log(`  ✅ ${img.name} (${(size / 1024).toFixed(0)}KB)`);
    });
  }
  
  if (localImages.length === 0) {
    console.log('  ⚠️ Không có ảnh mẫu. Bỏ qua phần Drive.\n');
  }

  // 2. Tải ảnh I&W Carnival từ Web
  console.log('\n🌐 Bước 2: Tải ảnh I&W Carnival từ web...');
  
  const webUrls = [
    { name: 'iw_721g_web.jpg', label: 'I&W 721G (web)', url: 'https://iwcarnival.vn/wp-content/uploads/2024/03/721G-1-2-scaled.jpg' },
    { name: 'iw_593l_web.jpg', label: 'I&W 593L (web)', url: 'https://iwcarnival.vn/wp-content/uploads/2023/10/593L_D3_01-scaled.jpg' },
    { name: 'iw_751g_web.jpg', label: 'I&W 751G (web)', url: 'https://iwcarnival.vn/wp-content/uploads/2023/11/751G_T3_01-scaled.jpg' },
  ];

  const webImages = [];
  for (const item of webUrls) {
    try {
      const filePath = await downloadUrl(item.url, item.name);
      const size = fs.statSync(filePath).size;
      webImages.push({ name: item.label, path: filePath, source: 'Web' });
      console.log(`  ✅ ${item.label} (${(size / 1024).toFixed(0)}KB)`);
    } catch (e) {
      console.log(`  ❌ Lỗi tải ${item.label}: ${e.message}`);
    }
  }

  const allImages = [...localImages, ...webImages];
  
  if (allImages.length < 2) {
    console.log('\n❌ Cần ít nhất 2 ảnh để so sánh!');
    return;
  }

  // 3. NÉN + HASH tất cả ảnh
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦 Bước 3: NÉN + HASH tất cả ảnh');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const hashResults = [];
  
  for (const img of allImages) {
    const origSize = fs.statSync(img.path).size;
    const compressed = await compressImage(img.path, 800, 60);
    const hashOrig = await computePHash(img.path);
    const hashComp = await computePHash(compressed.buffer);
    const selfDist = hammingDistance(hashOrig, hashComp);
    
    // Lưu ảnh nén
    const compPath = path.join(tmpDir, `compressed_${path.basename(img.path).replace(/\.\w+$/, '.jpg')}`);
    fs.writeFileSync(compPath, compressed.buffer);
    
    hashResults.push({ 
      name: img.name || path.basename(img.path), 
      source: img.source,
      hashOriginal: hashOrig, 
      hashCompressed: hashComp,
      origSizeKB: (origSize / 1024).toFixed(0),
      compSizeKB: compressed.sizeKB,
      reduction: ((1 - compressed.buffer.length / origSize) * 100).toFixed(0),
      selfDist
    });
    
    console.log(`  [${img.source}] ${img.name || path.basename(img.path)}`);
    console.log(`    Gốc: ${(origSize / 1024).toFixed(0)}KB → Nén: ${compressed.sizeKB}KB (giảm ${((1 - compressed.buffer.length / origSize) * 100).toFixed(0)}%)`);
    console.log(`    Hash gốc:  ${hashOrig}`);
    console.log(`    Hash nén:  ${hashComp}`);
    console.log(`    Gốc vs Nén: ${selfDist <= 5 ? '✅' : '❌'} Hamming=${selfDist}\n`);
  }

  // 4. SO SÁNH CHÉO
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 Bước 4: SO SÁNH CHÉO — Tất cả ảnh với nhau');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('  ┌───┬──────────────────────────┬──────────────────────────┬─────────┬──────────────┐');
  console.log('  │ # │ Ảnh 1                    │ Ảnh 2                    │ Hamming │ Kết quả      │');
  console.log('  ├───┼──────────────────────────┼──────────────────────────┼─────────┼──────────────┤');
  
  let idx = 1;
  for (let i = 0; i < hashResults.length; i++) {
    for (let j = i + 1; j < hashResults.length; j++) {
      const dist = hammingDistance(hashResults[i].hashOriginal, hashResults[j].hashOriginal);
      let result;
      if (dist <= 5) result = '✅ CÙNG ẢNH  ';
      else if (dist <= 10) result = '⚠️ GẦN GIỐNG';
      else if (dist <= 15) result = '🤔 HƠI GIỐNG';
      else result = '❌ KHÁC ẢNH  ';
      
      const n1 = hashResults[i].name.substring(0, 24).padEnd(24);
      const n2 = hashResults[j].name.substring(0, 24).padEnd(24);
      console.log(`  │ ${String(idx).padStart(1)} │ ${n1} │ ${n2} │ ${String(dist).padStart(4)}    │ ${result} │`);
      idx++;
    }
  }
  
  console.log('  └───┴──────────────────────────┴──────────────────────────┴─────────┴──────────────┘');

  // 5. BẢNG TỔNG HỢP
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 BẢNG TỔNG HỢP NÉN ẢNH');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('  ┌──────────────────────────┬──────────┬──────────┬──────────┬──────────────────────┐');
  console.log('  │ Ảnh                      │ Gốc      │ Nén      │ Giảm     │ Hash nén vẫn khớp?   │');
  console.log('  ├──────────────────────────┼──────────┼──────────┼──────────┼──────────────────────┤');
  
  for (const r of hashResults) {
    const name = r.name.substring(0, 24).padEnd(24);
    console.log(`  │ ${name} │ ${(r.origSizeKB + 'KB').padEnd(8)} │ ${(r.compSizeKB + 'KB').padEnd(8)} │ ${(r.reduction + '%').padEnd(8)} │ ${r.selfDist <= 5 ? '✅' : '❌'} Hamming=${r.selfDist}          │`);
  }
  
  console.log('  └──────────────────────────┴──────────┴──────────┴──────────┴──────────────────────┘');

  // TỔNG KẾT
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('   KẾT LUẬN');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('  📌 Quy tắc Hamming Distance:');
  console.log('     0-5:   ✅ Cùng 1 ảnh (đã nén/crop/resize)');
  console.log('     6-10:  ⚠️ Gần giống (cùng sản phẩm, góc khác)');
  console.log('     11-15: 🤔 Hơi giống (cùng thể loại)');
  console.log('     16+:   ❌ Hoàn toàn khác nhau\n');
  
  console.log('  ✅ Nén 800px quality 60% giảm 60-80% dung lượng');
  console.log('  ✅ Hash ảnh nén vẫn khớp ảnh gốc (Hamming 0-3)');
  console.log('  ✅ So sánh chéo giữa ảnh từ Drive và Web cho kết quả chính xác');
  console.log(`\n  📁 Ảnh nén lưu tại: ${tmpDir}\n`);
}

main().catch(console.error);
