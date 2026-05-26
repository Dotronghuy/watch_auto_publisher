import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEYFILEPATH = path.join(__dirname, '../config/credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = '1y2U9cuBNTT6SoHNHsHycLqVlwVM9yjvsSp6Nq2DPwxo';

export const getProductInfoBySku = async (sku) => {
  try {
    console.log(`Đang tra cứu thông tin SKU ${sku} trên Google Sheets...`);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A:AH', // Lấy từ cột A đến AH theo như ảnh cung cấp
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) {
      console.log('Không tìm thấy dữ liệu trong bảng tính.');
      return null;
    }

    const headers = rows[0];
    const skuIndex = headers.indexOf('Mã sản phẩm');
    
    if (skuIndex === -1) {
      console.log('Không tìm thấy cột "Mã sản phẩm" trong Sheet.');
      return null;
    }

    // Tìm dòng có SKU tương ứng
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[skuIndex] === sku) {
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
    console.error('Lỗi khi đọc Google Sheets:', error.message);
    return null;
  }
};

export const updateProductPostInfo = async (sku, postId) => {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
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
        spreadsheetId: SPREADSHEET_ID,
        range: 'AI1:AJ1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Post ID', 'Ngày đăng']] }
      });

      // 2. Viết dữ liệu vào đúng dòng
      const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `AI${rowIndex}:AJ${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[postId, now]] }
      });

      console.log(`✅ Đã cập nhật lịch sử đăng bài (Post ID, Ngày đăng) cho SKU ${sku} lên Google Sheets.`);
    }
  } catch (error) {
    console.error('Lỗi khi ghi lịch sử vào Google Sheets:', error.message);
  }
};

export const getAllProductsPostInfo = async () => {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
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
        spreadsheetId: SPREADSHEET_ID,
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
          cycleMinutes: cycleIndex !== -1 && row[cycleIndex] ? parseInt(row[cycleIndex], 10) : 5, // Mặc định 5 phút
        });
      }
    }
    return products;
  } catch (error) {
    console.error('Lỗi khi lấy thông tin post từ Sheets:', error.message);
    return [];
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
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: data
      }
    });
    console.log(`✅ Đã dọn dẹp ngày đăng trên Sheets cho ${rowIndices.length} SKU (đã hết cooldown nhưng ko bốc trúng).`);
  } catch (error) {
    console.error('Lỗi khi xóa lịch sử hết hạn trên Sheets:', error.message);
  }
};
