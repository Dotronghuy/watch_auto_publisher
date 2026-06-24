import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

/**
 * Kết nối Google Sheets từ Service Account credentials
 */
export async function connectToSheet(sheetUrl, credentials) {
  const spreadsheetId = extractSheetId(sheetUrl);
  if (!spreadsheetId) throw new Error('URL Google Sheets không hợp lệ');

  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });

  const doc = new GoogleSpreadsheet(spreadsheetId, auth);
  await doc.loadInfo();
  return doc;
}

/**
 * Trích xuất Spreadsheet ID từ URL Google Sheets
 */
function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}
