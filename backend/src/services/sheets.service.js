import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readJsonFileSync } from '../utils/json-file.js';

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
const SHEET_NAME = 'Sheet1';
const FOCUS_HEADER = 'Tập Trung';

const getSkuValue = (item = {}) => item['Mã SKU'] ?? item['Ma_SKU'] ?? '';
const normalizeSkuKey = (sku) => String(sku ?? '').trim().toUpperCase();
const normalizeFocusValue = (value) => {
  const normalized = String(value ?? '').trim();
  return normalized || '0';
};

const rowsToObjects = (rows = []) => {
  if (rows.length === 0) return [];

  const headers = rows[0];
  return rows.slice(1).map(row => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] ?? '';
    });
    return item;
  });
};

const fetchRawSheetRows = async (spreadsheetId) => {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:H`,
  });
  return response.data.values || [];
};

// Cột "Tập Trung" luôn được gắn theo khóa SKU, không phụ thuộc vị trí dòng.
export const prepareRowsWithFocusBySku = (dataArray = [], currentData = []) => {
  const focusBySku = new Map();

  for (const item of currentData) {
    const skuKey = normalizeSkuKey(getSkuValue(item));
    if (skuKey) {
      focusBySku.set(skuKey, normalizeFocusValue(item[FOCUS_HEADER]));
    }
  }

  return dataArray
    .map(item => {
      const skuKey = normalizeSkuKey(getSkuValue(item));
      const explicitFocus = Object.prototype.hasOwnProperty.call(item, FOCUS_HEADER)
        ? String(item[FOCUS_HEADER] ?? '').trim()
        : '';
      const preservedFocus = skuKey ? focusBySku.get(skuKey) : '';

      return {
        ...item,
        [FOCUS_HEADER]: normalizeFocusValue(explicitFocus || preservedFocus),
      };
    })
    .sort((a, b) => String(getSkuValue(a)).localeCompare(
      String(getSkuValue(b)),
      'en',
      { numeric: true, sensitivity: 'base' },
    ));
};

const getSheetId = () => {
  try {
    const settingsPath = path.join(__dirname, '../../config/settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = readJsonFileSync(settingsPath);
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
    const rows = await fetchRawSheetRows(spreadsheetId);
    if (!rows || rows.length === 0) {
      console.log('Không tìm thấy dữ liệu trong Google Sheet.');
      return [];
    }

    return rowsToObjects(rows);
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

    // 2. Đọc trạng thái hiện tại trước khi ghi để "Tập Trung" luôn đi theo đúng SKU.
    // Nếu bước đọc thất bại, hàm sẽ dừng trước khi thay đổi dữ liệu trên Sheet.
    const currentRows = await fetchRawSheetRows(spreadsheetId);
    const currentData = rowsToObjects(currentRows);
    const preparedData = prepareRowsWithFocusBySku(dataArray, currentData);
    const neededRowCount = preparedData.length + 50; // Dự phòng 50 dòng
    const targetRowCount = Math.max(currentRowCount, neededRowCount);

    if (currentRowCount < neededRowCount) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            updateSheetProperties: {
              properties: {
                sheetId: sheetId,
                gridProperties: { rowCount: neededRowCount }
              },
              fields: "gridProperties.rowCount"
            }
          }]
        }
      });
    }

    // 3. Chuẩn bị rows cho batchUpdate
    const headers = ['Mã SKU', '0_Anh_AVT', '1_Anh_Hang', '2_Anh_Tu_Chup', '3_Video_Doc', '4_Video_Ngang', 'Kết Quả', FOCUS_HEADER];
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
    for (const item of preparedData) {
      const rowCells = [
        getSkuValue(item),
        item['0_Anh_AVT'] || '',
        item['1_Anh_Hang'] || '',
        item['2_Anh_Tu_Chup'] || '',
        item['3_Video_Doc'] || '',
        item['4_Video_Ngang'] || '',
        item['Kết Quả'] || item['Ket_Qua'] || '',
        item[FOCUS_HEADER]
      ].map((val, colIndex) => {
        const stringValue = String(val ?? '');
        let bgColor = { red: 1, green: 1, blue: 1 };
        let fgColor = { red: 0.2, green: 0.2, blue: 0.2 };
        let bold = false;

        if (stringValue === 'OK') {
          bgColor = { red: 0.85, green: 0.93, blue: 0.83 }; // Xanh lá nhạt
          fgColor = { red: 0.1, green: 0.5, blue: 0.1 };
          bold = true;
        } else if (stringValue === 'KHONG CO ANH' || stringValue === 'CO LOI') {
          bgColor = { red: 0.98, green: 0.89, blue: 0.88 }; // Đỏ nhạt
          fgColor = { red: 0.8, green: 0, blue: 0 };
          bold = true;
        } else if (colIndex === 0) {
          bold = true;
        }
        
        return {
          userEnteredValue: { stringValue },
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
          {
            updateCells: {
              range: {
                sheetId: sheetId,
                startRowIndex: 0,
                endRowIndex: targetRowCount,
                startColumnIndex: 0,
                endColumnIndex: 8
              },
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
                endIndex: 8
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

    console.log(`✅ Đã cập nhật và format thành công ${preparedData.length} dòng lên Google Sheets (giữ Tập Trung theo SKU).`);
  } catch (error) {
    console.error('Lỗi khi ghi và format lên Google Sheet:', error.message);
  }
};
