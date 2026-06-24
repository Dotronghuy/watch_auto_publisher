import xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';

/**
 * Đọc file Excel Sapo và tạo Map giá theo SKU
 * @param {string} filePath - Đường dẫn tới file Excel Sapo
 * @returns {Map<string, {salePrice: number, originalPrice: number}>}
 */
export function buildPriceMap(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[Excel] Không tìm thấy file Excel tại: ${filePath}`);
    return new Map();
  }

  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Chuyển về JSON với header tự động (dòng 1 là header)
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length > 0) {
    console.log(`[Excel] ℹ️ Các cột trong file Excel Sapo: ${Object.keys(rows[0]).join(', ')}`);
  }

  const priceMap = new Map();

  for (const row of rows) {
    // Tìm cột SKU và cột giá
    const sku = (
      row['Mã SKU*'] || row['Mã SKU'] || row['SKU'] || ''
    ).toString().trim();

    if (!sku) continue;

    // Giá bán lẻ (Sale price) và Giá niêm yết (Original price)
    const salePrice = parsePrice(
      row['PL_Giá bán lẻ'] || row['Giá bán lẻ'] || 0
    );
    const originalPrice = parsePrice(
      row['PL_Giá niêm yết'] || row['Giá niêm yết'] || salePrice
    );

    priceMap.set(sku, { salePrice, originalPrice });
  }

  console.log(`[Excel] Đã đọc ${priceMap.size} SKU từ file Sapo.`);
  return priceMap;
}

function parsePrice(val) {
  if (!val) return 0;
  const str = val.toString().replace(/[.,\s]/g, '').replace(/\D/g, '');
  return parseInt(str) || 0;
}
