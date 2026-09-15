import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { runAutoFill, stopAutoFill } from '../services/autofill/autofill.service.js';
import {
  ALL_BRANDS_VALUE,
  getAvailableBrands,
} from '../services/autofill/googleSheets.service.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UPLOAD_DIR = path.join(__dirname, '../../uploads/autofill');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    if (file.fieldname === 'credentials') cb(null, 'credentials.json');
    else if (file.fieldname === 'excel') cb(null, 'excel_prices.xlsx');
    else cb(null, file.originalname);
  }
});
const upload = multer({ storage });
const configuredCredentialsPath = path.join(__dirname, '../config/credentials.json');
const uploadedCredentialsPath = path.join(UPLOAD_DIR, 'credentials.json');
const GOOGLE_SHEET_URL_PATTERN = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/;

function getCredentialsPath() {
  if (fs.existsSync(configuredCredentialsPath)) return configuredCredentialsPath;
  if (fs.existsSync(uploadedCredentialsPath)) return uploadedCredentialsPath;
  return null;
}

let isRunning = false;
const sseClients = new Set();

function broadcastLog(msg) {
  const data = JSON.stringify({ msg, time: new Date().toLocaleTimeString('vi-VN') });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
  console.log(msg);
}

function broadcastStatus(status) {
  const data = JSON.stringify({ status });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

router.get('/log-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  sseClients.add(res);
  const currentStatus = isRunning ? 'running' : 'idle';
  res.write(`data: ${JSON.stringify({ status: currentStatus })}\n\n`);

  req.on('close', () => sseClients.delete(res));
});

router.get('/status', (req, res) => {
  const excelPath = path.join(UPLOAD_DIR, 'excel_prices.xlsx');
  
  res.json({ 
    isRunning,
    hasCredentials: Boolean(getCredentialsPath()),
    hasExcel: fs.existsSync(excelPath),
    engine: 'playwright-dual-ai'
  });
});

router.post('/upload', upload.fields([{ name: 'credentials', maxCount: 1 }, { name: 'excel', maxCount: 1 }]), (req, res) => {
  res.json({ success: true, message: 'Upload thành công!' });
});

router.post('/brands', async (req, res) => {
  const { sheetUrl } = req.body || {};
  if (!sheetUrl) {
    return res.status(400).json({ success: false, message: 'Thiếu URL Google Sheets' });
  }
  if (!GOOGLE_SHEET_URL_PATTERN.test(sheetUrl)) {
    return res.status(400).json({ success: false, message: 'URL Google Sheets không hợp lệ' });
  }

  const credentialsPath = getCredentialsPath();
  if (!credentialsPath) {
    return res.status(400).json({
      success: false,
      message: 'Chưa cấu hình file credentials.json trong backend/src/config',
    });
  }

  try {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const result = await getAvailableBrands(sheetUrl, credentials);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: `Không tải được danh sách thương hiệu: ${error.message}`,
    });
  }
});

router.post('/start', async (req, res) => {
  if (isRunning) return res.json({ success: false, message: 'Tool đang chạy, vui lòng đợi...' });

  const { sheetUrl, aiTone } = req.body;
  const selectedBrand = String(req.body?.selectedBrand || '').trim();
  if (!sheetUrl) return res.status(400).json({ success: false, message: 'Thiếu URL Google Sheets' });
  if (!GOOGLE_SHEET_URL_PATTERN.test(sheetUrl)) {
    return res.status(400).json({ success: false, message: 'URL Google Sheets không hợp lệ' });
  }
  if (!selectedBrand) {
    return res.status(400).json({
      success: false,
      message: 'Hãy chọn thương hiệu cần cào trước khi bắt đầu.',
    });
  }
  if (selectedBrand !== ALL_BRANDS_VALUE && selectedBrand.length > 120) {
    return res.status(400).json({ success: false, message: 'Tên thương hiệu không hợp lệ.' });
  }

  const credentialsPath = getCredentialsPath();
  if (!credentialsPath) {
    return res.status(400).json({ success: false, message: 'Chưa cấu hình file credentials.json trong backend/src/config' });
  }
  
  const excelPath = path.join(UPLOAD_DIR, 'excel_prices.xlsx');
  const allowedTones = ['Chuyên nghiệp', 'Thu hút (Engaging)', 'Kỹ thuật', 'Thuyết phục'];
  const config = {
    sheetUrl,
    aiTone: allowedTones.includes(aiTone) ? aiTone : 'Thu hút (Engaging)',
    selectedBrand,
    credentialsPath,
    excelPath,
  };

  res.json({ success: true, message: 'Bắt đầu chạy...' });

  isRunning = true;
  broadcastStatus('running');

  try {
    await runAutoFill(config, broadcastLog);
  } catch (err) {
    broadcastLog(`❌ LỖI NGHIÊM TRỌNG: ${err.message}`);
  } finally {
    isRunning = false;
    broadcastStatus('done');
  }
});

router.post('/stop', (req, res) => {
  if (!isRunning) return res.json({ success: false, message: 'Tool không đang chạy.' });
  stopAutoFill();
  res.json({ success: true, message: 'Đang dừng tool...' });
});

export default router;
