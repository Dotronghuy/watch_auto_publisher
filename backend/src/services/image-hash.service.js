import sharp from 'sharp';
import axios from 'axios';
import { saveImageHash, getAllImageHashes, clearImageHashesBySource } from '../utils/crm.db.js';
import { getAllProductsWithImages, syncProductCatalog } from './sheet.service.js';

// --- PHẦN 1: HASHING ---

/**
 * Tính toán Perceptual Hash (aHash) từ Buffer
 * Trả về chuỗi nhị phân 64-bit
 */
export const computeHashFromBuffer = async (imageBuffer) => {
  try {
    // 1. Đưa về kích thước 8x8, grayscale
    const { data } = await sharp(imageBuffer)
      .resize(8, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 2. Tính giá trị trung bình
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    const avg = sum / data.length;

    // 3. Tạo chuỗi nhị phân 64 bit (1 nếu >= avg, 0 nếu < avg)
    let hash = '';
    for (let i = 0; i < data.length; i++) {
      hash += data[i] >= avg ? '1' : '0';
    }

    return hash;
  } catch (error) {
    console.error('Lỗi khi tính hash từ buffer:', error.message);
    return null;
  }
};

/**
 * Tải ảnh từ URL và tính hash
 */
export const computeHashFromUrl = async (url) => {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    return await computeHashFromBuffer(buffer);
  } catch (error) {
    console.error(`Lỗi tải ảnh từ URL để tính hash (${url}):`, error.message);
    return null;
  }
};

/**
 * Tính Hamming Distance giữa 2 chuỗi nhị phân
 * Distance = 0 -> Giống nhau hoàn toàn
 * Distance <= 5 -> Rất giống nhau (chấp nhận được)
 */
export const getHammingDistance = (hash1, hash2) => {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return 64; // Max distance
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  return distance;
};

// --- PHẦN 2: TÌM KIẾM ---

/**
 * Tìm SKU khớp với ảnh dựa vào các hash đã lưu trong DB
 * threshold = 5 (cho phép khác tối đa 5 pixel trên 64 pixel)
 */
export const findMatchingSku = async (targetHash, threshold = 5) => {
  if (!targetHash) return null;
  const allHashes = await getAllImageHashes();
  
  let bestMatch = null;
  let minDistance = 65;

  for (const item of allHashes) {
    const dist = getHammingDistance(targetHash, item.hash);
    if (dist <= threshold && dist < minDistance) {
      minDistance = dist;
      bestMatch = item;
    }
  }

  if (bestMatch) {
    console.log(`✅ Tìm thấy ảnh khớp! SKU: ${bestMatch.product_sku}, Distance: ${minDistance}`);
    return bestMatch.product_sku;
  }
  
  return null;
};

// --- PHẦN 3: ĐỒNG BỘ (SYNC) ---

/**
 * Tải tất cả ảnh từ Google Sheets, tính hash và lưu DB
 */
export const syncHashesFromSheets = async () => {
  console.log('🔄 Bắt đầu đồng bộ ảnh từ Google Sheets (Lớp 2)...');
  try {
    const products = await getAllProductsWithImages();
    if (!products || products.length === 0) {
      console.log('⚠️ Không tìm thấy sản phẩm nào có ảnh trong Sheets.');
      return;
    }

    // Đồng bộ Product Catalog (SKU, Name) cho AI Lớp 3
    await syncProductCatalog();

    // Xóa hash cũ từ Sheets để đồng bộ lại
    await clearImageHashesBySource('sheet');
    
    let successCount = 0;
    
    // Tải và tính hash từng ảnh
    for (const product of products) {
      if (!product.imageUrl) continue;
      
      try {
        const hash = await computeHashFromUrl(product.imageUrl);
        if (hash) {
          await saveImageHash(hash, product.sku, 'sheet');
          successCount++;
        }
      } catch (err) {
        console.error(`⚠️ Bỏ qua SKU ${product.sku} do lỗi xử lý ảnh.`);
      }
    }
    
    console.log(`✅ Đồng bộ xong! Đã lưu hash cho ${successCount}/${products.length} sản phẩm từ Sheets.`);
  } catch (error) {
    console.error('❌ Lỗi đồng bộ ảnh từ Sheets:', error.message);
  }
};
