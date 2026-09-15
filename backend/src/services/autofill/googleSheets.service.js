import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export const ALL_BRANDS_VALUE = '__ALL__';

export function normalizeBrandValue(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('vi-VN');
}

export function findBrandHeader(headerValues = []) {
  const acceptedHeaders = new Set(['thuong hieu', 'nhan hieu', 'brand']);
  return headerValues.find((header) => acceptedHeaders.has(normalizeBrandValue(header))) || null;
}

export function readBrandFromRow(row, brandHeader = null) {
  if (!row) return '';
  const candidateHeaders = [
    brandHeader,
    'Thương hiệu',
    'thương hiệu',
    'Nhãn hiệu',
    'Brand',
    'brand',
  ].filter(Boolean);

  for (const header of candidateHeaders) {
    const value = row.get?.(header);
    if (String(value || '').trim()) return String(value).trim();
  }
  return '';
}

export function collectDistinctBrands(rows, brandHeader = null) {
  const canonicalBrands = new Map();
  for (const row of rows || []) {
    const brand = readBrandFromRow(row, brandHeader);
    const normalized = normalizeBrandValue(brand);
    if (normalized && !canonicalBrands.has(normalized)) canonicalBrands.set(normalized, brand);
  }

  return [...canonicalBrands.values()].sort((left, right) => (
    left.localeCompare(right, 'vi', { sensitivity: 'base' })
  ));
}

export function filterRowsByBrand(rows, selectedBrand, brandHeader = null) {
  if (selectedBrand === ALL_BRANDS_VALUE) return [...(rows || [])];
  const selectedBrandKey = normalizeBrandValue(selectedBrand);
  if (!selectedBrandKey) return [];
  return (rows || []).filter((row) => (
    normalizeBrandValue(readBrandFromRow(row, brandHeader)) === selectedBrandKey
  ));
}

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

export async function getAvailableBrands(sheetUrl, credentials) {
  const doc = await connectToSheet(sheetUrl, credentials);
  const sheet = doc.sheetsByIndex[0];
  if (!sheet) throw new Error('Google Sheet không có tab dữ liệu đầu tiên.');

  await sheet.loadHeaderRow();
  const brandHeader = findBrandHeader(sheet.headerValues);
  if (!brandHeader) {
    throw new Error('Không tìm thấy cột "Thương hiệu" trong tab đầu tiên của Google Sheet.');
  }

  const rows = await sheet.getRows();
  return {
    brands: collectDistinctBrands(rows, brandHeader),
    totalRows: rows.length,
    sheetTitle: sheet.title,
    brandHeader,
  };
}

/**
 * Trích xuất Spreadsheet ID từ URL Google Sheets
 */
function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}
