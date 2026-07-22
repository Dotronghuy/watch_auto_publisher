import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dùng cùng file credentials với Google Drive, Products Sheet và màn hình cài đặt.
// Bản cũ từng đọc nhầm backend/config nên máy chỉ có file đã upload ở src/config sẽ lỗi riêng SKU_STATUS.
const PRIMARY_KEYFILEPATH = path.join(__dirname, '../config/credentials.json');
const LEGACY_KEYFILEPATH = path.join(__dirname, '../../config/credentials.json');
const KEYFILEPATH = fs.existsSync(PRIMARY_KEYFILEPATH) ? PRIMARY_KEYFILEPATH : LEGACY_KEYFILEPATH;
const DEFAULT_SKU_STATUS_SHEET_ID = '1tWg6zzAw6F9_2vlvOFfPy_2tV88xFGPB-4f5NvbwS_M';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});

const sheets = google.sheets({ version: 'v4', auth });

const getSheetId = () => {
  try {
    const settingsPath = path.join(__dirname, '../../config/settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.skuStatusSheetId) return settings.skuStatusSheetId;
      if (settings.googleSheetId) return settings.googleSheetId; // Tương thích cấu hình cũ
    }
  } catch (e) {
    console.error('Lỗi lấy Google Sheet ID:', e.message);
  }
  return process.env.SKU_STATUS_SHEET_ID || DEFAULT_SKU_STATUS_SHEET_ID;
};

// Đọc dữ liệu từ Google Sheet
export const readFromSheet = async () => {
  const spreadsheetId = getSheetId();
  if (!spreadsheetId) {
    console.log('Chưa cấu hình Google Sheet ID. Debug ID:', getSheetId());
    return [];
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A:H', // 8 cột: A-G + H (Tập Trung)
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log('Không tìm thấy dữ liệu trong Google Sheet.');
      return [];
    }

    const headers = rows[0];
    const data = rows.slice(1).map(row => {
      let obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });

    return data;
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.error(`❌ [SKU_STATUS] Không đọc được Sheet ${spreadsheetId}: ${detail}`);
    return [];
  }
};

// Ghi dữ liệu lên Google Sheet
export const writeToSheet = async (dataArray) => {
  const spreadsheetId = getSheetId();
  if (!spreadsheetId) {
    console.log('Chưa cấu hình Google Sheet ID.');
    return;
  }

  try {
    // 1. Lấy sheetId của Sheet1
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === 'Sheet1') || spreadsheet.data.sheets[0];
    const sheetId = sheet.properties.sheetId;
    const currentRowCount = sheet.properties.gridProperties.rowCount || 1000;
    const neededRowCount = dataArray.length + 50; // Dự phòng 50 dòng

    // 2. Xóa sạch dữ liệu cũ
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Sheet1!A:G',
    });

    // 3. Chuẩn bị rows cho batchUpdate
    const headers = ['Mã SKU', '0_Anh_AVT', '1_Anh_Hang', '2_Anh_Tu_Chup', '3_Video_Doc', '4_Video_Ngang', 'Kết Quả'];
    const rows = [];

    // Header
    const headerCells = headers.map(header => ({
      userEnteredValue: { stringValue: header },
      userEnteredFormat: {
        backgroundColor: { red: 0.25, green: 0.32, blue: 0.71 }, // Màu xanh dương đậm
        textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE"
      }
    }));
    rows.push({ values: headerCells });

    // Data
    for (const item of dataArray) {
      const rowCells = [
        item['Mã SKU'] || item['Ma_SKU'] || '',
        item['0_Anh_AVT'] || '',
        item['1_Anh_Hang'] || '',
        item['2_Anh_Tu_Chup'] || '',
        item['3_Video_Doc'] || '',
        item['4_Video_Ngang'] || '',
        item['Kết Quả'] || item['Ket_Qua'] || ''
      ].map((val, colIndex) => {
        let bgColor = { red: 1, green: 1, blue: 1 };
        let fgColor = { red: 0.2, green: 0.2, blue: 0.2 };
        let bold = false;

        if (val === 'OK') {
          bgColor = { red: 0.85, green: 0.93, blue: 0.83 }; // Xanh lá nhạt
          fgColor = { red: 0.1, green: 0.5, blue: 0.1 };
          bold = true;
        } else if (val === 'KHONG CO ANH' || val === 'CO LOI') {
          bgColor = { red: 0.98, green: 0.89, blue: 0.88 }; // Đỏ nhạt
          fgColor = { red: 0.8, green: 0, blue: 0 };
          bold = true;
        } else if (colIndex === 0) {
          bold = true;
        }
        
        return {
          userEnteredValue: { stringValue: val },
          userEnteredFormat: {
            backgroundColor: bgColor,
            textFormat: { foregroundColor: fgColor, bold: bold },
            horizontalAlignment: colIndex === 0 ? "LEFT" : "CENTER",
            verticalAlignment: "MIDDLE",
            borders: {
              bottom: { style: "SOLID", color: { red: 0.9, green: 0.9, blue: 0.9 } }
            }
          }
        };
      });
      rows.push({ values: rowCells });
    }

    // 4. Gửi batchUpdate
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          ...(currentRowCount < neededRowCount ? [{
            updateSheetProperties: {
              properties: {
                sheetId: sheetId,
                gridProperties: { rowCount: neededRowCount }
              },
              fields: "gridProperties.rowCount"
            }
          }] : []),
          {
            updateCells: {
              start: { sheetId: sheetId, rowIndex: 0, columnIndex: 0 },
              rows: rows,
              fields: "userEnteredValue,userEnteredFormat"
            }
          },
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: sheetId,
                dimension: "COLUMNS",
                startIndex: 0,
                endIndex: 7
              }
            }
          },
          {
            updateSheetProperties: {
              properties: {
                sheetId: sheetId,
                gridProperties: { frozenRowCount: 1 }
              },
              fields: "gridProperties.frozenRowCount"
            }
          }
        ]
      }
    });

    console.log(`✅ Đã cập nhật và format thành công ${dataArray.length} dòng lên Google Sheets.`);
  } catch (error) {
    console.error('Lỗi khi ghi và format lên Google Sheet:', error.message);
  }
};
