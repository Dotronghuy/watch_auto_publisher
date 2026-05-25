import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEYFILEPATH = path.join(__dirname, '../config/credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

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
