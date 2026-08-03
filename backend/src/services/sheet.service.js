import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readJsonFileSync } from '../utils/json-file.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRIMARY_KEYFILEPATH = path.join(__dirname, '../config/credentials.json');
const LEGACY_KEYFILEPATH = path.join(__dirname, '../../config/credentials.json');
const KEYFILEPATH = fs.existsSync(PRIMARY_KEYFILEPATH) ? PRIMARY_KEYFILEPATH : LEGACY_KEYFILEPATH;
const DEFAULT_CATALOG_SHEET_ID = '1y2U9cuBNTT6SoHNHsHycLqVlwVM9yjvsSp6Nq2DPwxo';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const PRODUCT_SHEET_RANGE = 'A:AL';
const normalizeHeader = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('vi-VN')
  .replace(/\s+/g, ' ');
const normalizeSku = (value) => String(value || '').trim().toLocaleUpperCase('vi-VN');
const SHOPEE_LINK_HEADERS = new Set([
  'link shopee',
  'link shoppe',
  'shopee link',
  'url shopee',
  'link sản phẩm shopee',
]);

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});

const sheets = google.sheets({ version: 'v4', auth });

const getSheetId = () => {
  try {
    const settingsPath = path.join(__dirname, '../../config/settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = readJsonFileSync(settingsPath);
      if (settings.catalogSheetId) return settings.catalogSheetId;
    }
  } catch (e) {}
  return process.env.CATALOG_SHEET_ID || DEFAULT_CATALOG_SHEET_ID;
};

export const getShopeeLinkFromProductInfo = (productInfo) => {
  if (!productInfo || typeof productInfo !== 'object') return '';

  for (const [header, value] of Object.entries(productInfo)) {
    if (SHOPEE_LINK_HEADERS.has(normalizeHeader(header))) {
      return String(value || '').trim();
    }
  }
  return '';
};

export const getProductInfoBySku = async (sku) => {
  try {
    console.log(`Đang tra cứu thông tin SKU ${sku} trên Google Sheets...`);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: getSheetId(),
      // Link shoppe đang nằm ở cột AL trong tab Products.
      range: PRODUCT_SHEET_RANGE,
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) {
      console.log('Không tìm thấy dữ liệu trong bảng tính.');
      return null;
    }

    const headers = rows[0];
    const skuIndex = headers.findIndex(
      (header) => normalizeHeader(header) === normalizeHeader('Mã sản phẩm'),
    );
    
    if (skuIndex === -1) {
      console.log('Không tìm thấy cột "Mã sản phẩm" trong Sheet.');
      return null;
    }

    // Tìm dòng có SKU tương ứng
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (normalizeSku(row[skuIndex]) === normalizeSku(sku)) {
        const productInfo = {};
        headers.forEach((header, index) => {
          if (header && row[index]) {
            productInfo[header] = row[index];
          }
        });
        console.log(`✅ Đã lấy thành công thông tin cho SKU ${sku} từ Sheet!`);
        return productInfo;
      }
    }
    
    console.log(`⚠️ Không tìm thấy SKU ${sku} trong Sheet.`);
    return null;
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.error(`❌ [PRODUCTS] Không đọc được Sheet ${getSheetId()}: ${detail}`);
    return null;
  }
};

export const updateProductPostInfo = async (sku, postId) => {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: getSheetId(),
      range: 'A:C', // Mã sản phẩm nằm ở cột C
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) return;

    const skuIndex = rows[0].indexOf('Mã sản phẩm');
    if (skuIndex === -1) return;

    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] && rows[i][skuIndex] === sku) {
        rowIndex = i + 1; // Google Sheets bắt đầu từ dòng 1
        break;
      }
    }

    if (rowIndex !== -1) {
      // 1. Viết tiêu đề nếu chưa có (Ghi vào 2 cột AI và AJ)
      await sheets.spreadsheets.values.update({
        spreadsheetId: getSheetId(),
        range: 'AI1:AJ1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Post ID', 'Ngày đăng']] }
      });

      // 2. Viết dữ liệu vào đúng dòng
      const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      await sheets.spreadsheets.values.update({
        spreadsheetId: getSheetId(),
        range: `AI${rowIndex}:AJ${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[postId, now]] }
      });

      console.log(`✅ Đã cập nhật lịch sử đăng bài (Post ID, Ngày đăng) cho SKU ${sku} lên Google Sheets.`);
    }
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.error(`❌ [PRODUCTS] Không ghi được lịch sử vào Sheet ${getSheetId()}: ${detail}`);
  }
};

export const getAllProductsPostInfo = async () => {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: getSheetId(),
      range: 'A:AK',
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) return [];

    const headers = rows[0];
    const skuIndex = headers.indexOf('Mã sản phẩm');
    const postIdIndex = headers.indexOf('Post ID');
    const dateIndex = headers.indexOf('Ngày đăng');
    let cycleIndex = headers.indexOf('Chu kỳ đăng (phút)');

    if (skuIndex === -1) return [];

    // Tự động tạo cột Chu kỳ đăng nếu chưa có
    if (cycleIndex === -1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: getSheetId(),
        range: 'AK1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Chu kỳ đăng (phút)']] }
      });
      cycleIndex = 36; // Cột AK
    }

    const products = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[skuIndex]) {
        products.push({
          rowIndex: i + 1,
          sku: row[skuIndex],
          postId: postIdIndex !== -1 ? row[postIdIndex] : null,
          postDate: dateIndex !== -1 ? row[dateIndex] : null,
          cycleMinutes: cycleIndex !== -1 && row[cycleIndex] ? parseInt(row[cycleIndex], 10) : 2880, // Mặc định 2 ngày (2880 phút)
        });
      }
    }
    return products;
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.error(`❌ [PRODUCTS] Không lấy được lịch sử đăng từ Sheet ${getSheetId()}: ${detail}`);
    return [];
  }
};

export const getAllProductsWithImages = async () => {
  try {
    const catalogPath = path.join(__dirname, '../../data/catalog.json');
    if (!fs.existsSync(catalogPath)) return [];
    
    const catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const products = [];
    
    for (const prod of catalogData) {
      if (prod['Mã sản phẩm'] && (prod['imageUrl'] || prod['Link ảnh sản phẩm'])) {
        products.push({
          sku: prod['Mã sản phẩm'],
          imageUrl: prod['imageUrl'] || prod['Link ảnh sản phẩm']
        });
      }
    }
    return products;
  } catch (error) {
    console.error('Lỗi khi đọc ảnh từ catalog.json:', error.message);
    return [];
  }
};

export const syncProductCatalog = async () => {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: getSheetId(),
      range: PRODUCT_SHEET_RANGE,
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) return false;

    const headers = rows[0];
    const skuIndex = headers.indexOf('Mã sản phẩm');
    const nameIndex = headers.indexOf('Tên sản phẩm');
    const colorIndex = headers.indexOf('Màu mặt số');
    const strapIndex = headers.indexOf('Chất liệu dây');
    const styleIndex = headers.indexOf('Lấy cảm hứng từ');
    const brandIndex = headers.indexOf('Thương hiệu');
    const descIndex = headers.indexOf('Mô tả ngắn');
    const style2Index = headers.indexOf('Phong cách');
    const caseIndex = headers.indexOf('Chất liệu vỏ');

    if (skuIndex === -1 || nameIndex === -1) return false;

    const catalog = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[skuIndex] && row[nameIndex]) {
        const prod = {};
        for (let j = 0; j < headers.length; j++) {
          if (headers[j] && row[j]) {
            prod[headers[j]] = row[j];
          }
        }
        // Đảm bảo có imageUrl để tương thích nếu cột Tên là Ảnh sản phẩm/Ảnh/Video
        const imageHeader = headers.find(h => h && h.toLowerCase().includes('ảnh'));
        if (imageHeader && row[headers.indexOf(imageHeader)]) {
          prod.imageUrl = row[headers.indexOf(imageHeader)];
        } else if (row[4]) {
          prod.imageUrl = row[4]; // Fallback cột E
        }
        catalog.push(prod);
      }
    }

    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(path.join(dataDir, 'catalog.json'), JSON.stringify(catalog, null, 2), 'utf8');
    console.log(`✅ Đã đồng bộ ${catalog.length} sản phẩm vào catalog.json`);
    return true;
  } catch (error) {
    console.error('Lỗi khi đồng bộ Product Catalog:', error.message);
    return false;
  }
};

export const clearExpiredPostInfo = async (rowIndices) => {
  if (!rowIndices || rowIndices.length === 0) return;
  try {
    const data = rowIndices.map(rowIndex => ({
      range: `AI${rowIndex}:AJ${rowIndex}`,
      values: [['', '']]
    }));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSheetId(),
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: data
      }
    });
    console.log(`✅ Đã dọn dẹp ngày đăng trên Sheets cho ${rowIndices.length} SKU (đã hết cooldown nhưng ko bốc trúng).`);
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.error(`❌ [PRODUCTS] Không xóa được lịch sử hết hạn trên Sheet ${getSheetId()}: ${detail}`);
  }
};
