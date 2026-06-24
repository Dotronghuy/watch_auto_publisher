import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { runAutoFill, stopAutoFill } from '../services/autofill/autofill.service.js';

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
  const credPath = path.join(__dirname, '../config/credentials.json');
  const excelPath = path.join(UPLOAD_DIR, 'excel_prices.xlsx');
  
  res.json({ 
    isRunning,
    hasCredentials: fs.existsSync(credPath),
    hasExcel: fs.existsSync(excelPath)
  });
});

router.post('/upload', upload.fields([{ name: 'credentials', maxCount: 1 }, { name: 'excel', maxCount: 1 }]), (req, res) => {
  res.json({ success: true, message: 'Upload thành công!' });
});

router.post('/start', async (req, res) => {
  if (isRunning) return res.json({ success: false, message: 'Tool đang chạy, vui lòng đợi...' });

  const { sheetUrl, aiTone } = req.body;
  if (!sheetUrl) return res.json({ success: false, message: 'Thiếu URL Google Sheets' });

  const credentialsPath = path.join(__dirname, '../config/credentials.json');
  if (!fs.existsSync(credentialsPath)) {
    return res.json({ success: false, message: 'Chưa cấu hình file credentials.json trong backend/src/config' });
  }
  
  const excelPath = path.join(UPLOAD_DIR, 'excel_prices.xlsx');
  const config = { sheetUrl, aiTone, credentialsPath, excelPath };

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
