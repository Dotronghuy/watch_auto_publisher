import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import Papa from 'papaparse';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import multer from 'multer';
import { startScheduler } from '../scheduler.js';
import { autoPublishRoutine, resetGlobalStop, triggerGlobalStop, getIsRunning } from '../services/publish.service.js';
import { getProductInfoBySku } from '../services/sheet.service.js';
import { openLoginHelper } from '../services/playwright.service.js';
import { publishQueue } from '../workers/queue.js';
import { recentActivities, addActivity } from '../utils/activity.js';
import { getAllPostedHistory } from '../utils/history.js';
import logEmitter from '../utils/liveLog.js';

// Cache dung lượng Drive (cache 10 phút)
let driveStorageCache = { usedGB: 0, limitGB: 0, updatedAt: 0 };
const DRIVE_CACHE_TTL = 10 * 60 * 1000;

// Hàm lấy dung lượng tổng tài khoản Google Drive qua OAuth2
const getOAuth2DriveStorage = async () => {
  // Lấy token từ .env hoặc từ file oauth2_token.json
  const refreshToken = process.env.DRIVE_REFRESH_TOKEN;
  
  // Sửa lỗi đường dẫn: __dirname ở đây là backend/src/routes, nên phải lùi 2 cấp (../../) để ra backend/
  const tokenPath = path.join(__dirname, '../../config/oauth2_token.json');
  const credPath = path.join(__dirname, '../../config/oauth2_credentials.json');

  if (!refreshToken && !fs.existsSync(tokenPath)) {
    console.warn('⚠️ Không tìm thấy refresh token trong .env và file', tokenPath);
    return null;
  }

  try {
    let clientId, clientSecret;
    if (fs.existsSync(credPath)) {
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      const c = creds.installed || creds.web;
      clientId = c.client_id;
      clientSecret = c.client_secret;
    } else {
      // Dùng env vars nếu có
      clientId = process.env.GOOGLE_CLIENT_ID;
      clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    }
    if (!clientId) return null;

    const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3333');
    const token = refreshToken
      ? { refresh_token: refreshToken }
      : JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    oAuth2Client.setCredentials(token);

    const drive = google.drive({ version: 'v3', auth: oAuth2Client });
    const about = await drive.about.get({ fields: 'storageQuota' });
    const q = about.data.storageQuota;

    return {
      usedGB: parseFloat((parseInt(q.usage || '0') / 1024 / 1024 / 1024).toFixed(2)),
      limitGB: q.limit ? parseFloat((parseInt(q.limit) / 1024 / 1024 / 1024).toFixed(0)) : 0,
    };
  } catch (err) {
    console.warn('⚠️ OAuth2 Drive quota error:', err.message);
    return null;
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, '../config/settings.json');

const router = express.Router();

// Lưu trữ các client SSE đang kết nối
let clients = [];
let logHistory = [];

// ------- STOP SIGNAL -------
// Khi stopSignal.aborted === true, autoPublishRoutine sẽ dừng ở bước an toàn tiếp theo

// Hàm gửi log tới tất cả các client đang xem Live Monitor
export const sendLogToClients = (logData) => {
  logHistory.push(logData);
  if (logHistory.length > 300) logHistory.shift(); // Giữ tối đa 300 sự kiện gần nhất
  clients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(logData)}\n\n`);
  });
};

// Kết nối logEmitter với SSE ngay khi module được tải
logEmitter.on('log', (logData) => {
  sendLogToClients(logData);
});

// 1. Dashboard Stats
router.get('/dashboard', async (req, res) => {
  try {
    // A. Lấy tổng bài đã đăng từ lịch sử (đọc từ SQLite DB)
    const historyData = await getAllPostedHistory();
    const totalPosts = historyData.length;

    // B. Tính biểu đồ dựa vào tham số timeRange
    const timeRange = req.query.timeRange || '7days';
    const curr = new Date();
    let chartData = [];
    const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

    if (timeRange === 'today') {
      let value = 0;
      historyData.forEach(item => {
        const itemDate = new Date(item.timestamp);
        if (itemDate.getDate() === curr.getDate() && itemDate.getMonth() === curr.getMonth() && itemDate.getFullYear() === curr.getFullYear()) value++;
      });
      const dayStr = dayNames[(curr.getDay() || 7) - 1];
      const dateStr = `${curr.getDate().toString().padStart(2, '0')}/${(curr.getMonth() + 1).toString().padStart(2, '0')}`;
      chartData.push({ name: `${dayStr} (${dateStr})`, value });
    } else if (timeRange === 'yesterday') {
      const y = new Date(curr);
      y.setDate(y.getDate() - 1);
      let value = 0;
      historyData.forEach(item => {
        const itemDate = new Date(item.timestamp);
        if (itemDate.getDate() === y.getDate() && itemDate.getMonth() === y.getMonth() && itemDate.getFullYear() === y.getFullYear()) value++;
      });
      const dayStr = dayNames[(y.getDay() || 7) - 1];
      const dateStr = `${y.getDate().toString().padStart(2, '0')}/${(y.getMonth() + 1).toString().padStart(2, '0')}`;
      chartData.push({ name: `${dayStr} (${dateStr})`, value });
    } else if (timeRange === 'this_month' || timeRange === 'last_month') {
      const targetMonth = timeRange === 'this_month' ? curr.getMonth() : (curr.getMonth() - 1 + 12) % 12;
      const targetYear = timeRange === 'this_month' ? curr.getFullYear() : (curr.getMonth() === 0 ? curr.getFullYear() - 1 : curr.getFullYear());
      
      const counts = [0, 0, 0, 0, 0, 0, 0]; // T2-CN
      historyData.forEach(item => {
        const itemDate = new Date(item.timestamp);
        if (itemDate.getMonth() === targetMonth && itemDate.getFullYear() === targetYear) {
          const idx = (itemDate.getDay() || 7) - 1;
          counts[idx]++;
        }
      });
      for (let i = 0; i < 7; i++) {
        chartData.push({ name: dayNames[i], value: counts[i] });
      }
    } else {
      // Mặc định 7days: 7 ngày gần nhất (bao gồm hôm nay)
      for (let i = 6; i >= 0; i--) {
        const d = new Date(curr);
        d.setDate(curr.getDate() - i);
        const dayOfWeek = d.getDay();
        const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        
        let value = 0;
        historyData.forEach(item => {
          const itemDate = new Date(item.timestamp);
          if (itemDate.getDate() === d.getDate() && 
              itemDate.getMonth() === d.getMonth() && 
              itemDate.getFullYear() === d.getFullYear()) {
            value++;
          }
        });
        chartData.push({ name: `${dayNames[(dayOfWeek || 7) - 1]} (${dateStr})`, value: value });
      }
    }

    // C. Lấy dung lượng THẬT tổng tài khoản Google Drive (giống số hiển thị trên drive.google.com)
    let storageUsedGB = 0;
    let storageLimitGB = 0;
    try {
      const now = Date.now();
      if (now - driveStorageCache.updatedAt > DRIVE_CACHE_TTL) {
        const result = await Promise.race([
          getOAuth2DriveStorage(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))
        ]);
        if (result) {
          driveStorageCache = { usedGB: result.usedGB, limitGB: result.limitGB, updatedAt: now };
          console.log(`✅ Drive quota: ${result.usedGB} GB / ${result.limitGB} GB`);
        }
      }
      storageUsedGB = driveStorageCache.usedGB;
      storageLimitGB = driveStorageCache.limitGB;
    } catch (driveErr) {
      console.warn('⚠️ Không lấy được Drive quota:', driveErr.message);
    }


    // D. Trạng thái luồng đang chạy — dùng flag in-process (chính xác ngay lập tức)
    const activeWorkers = getIsRunning() ? 1 : 0;
    // E. Đọc cài đặt kết nối mạng xã hội
    let connectedSocials = { facebook: true, instagram: true, threads: false, tiktok: false };
    if (fs.existsSync(settingsPath)) {
      const settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settingsData.connectedSocials) {
        connectedSocials = settingsData.connectedSocials;
      }
    }
    const connectedCount = Object.values(connectedSocials).filter(Boolean).length;

    res.json({
      activeWorkflows: activeWorkers,
      totalPosts: totalPosts,
      successRate: 100, // Hardcode 100% Opt vì hiện chưa có cơ chế log bài lỗi
      storageUsed: storageUsedGB,
      storageLimit: storageLimitGB,
      chartData: chartData,
      socialHealth: { connected: connectedCount, total: 4, platforms: connectedSocials },
      dbHealth: 100,
      recentActivities: recentActivities.slice().reverse()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Cannot fetch stats' });
  }
});

// 2. Lấy danh sách sản phẩm (Kéo trực tiếp từ Google Sheet THẬT)
router.get('/products', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const search = req.query.search ? req.query.search.toLowerCase() : '';
    const start = (page - 1) * limit;

    // Lấy dữ liệu trực tiếp từ file Google Sheet của sếp (Định dạng CSV để dễ parse)
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/1y2U9cuBNTT6SoHNHsHycLqVlwVM9yjvsSp6Nq2DPwxo/export?format=csv&id=1y2U9cuBNTT6SoHNHsHycLqVlwVM9yjvsSp6Nq2DPwxo&gid=0';
    const response = await axios.get(sheetUrl);
    
    // Sử dụng PapaParse để xử lý triệt để lỗi dòng mới (enter) nằm trong cột mô tả
    const parsed = Papa.parse(response.data, { header: true, skipEmptyLines: true });
    
    const LIVE_PRODUCTS = [];
    
    parsed.data.forEach((row, i) => {
      // Dùng tên cột (Header) hoặc lấy theo thứ tự Index nếu Header bị lỗi font
      const vals = Object.values(row);
      const name = row['Tên sản phẩm'] || vals[1];
      const sku = row['Mã sản phẩm'] || vals[2];
      const brand = row['Thương hiệu'] || vals[3];

      if (name) {
        const skuTrimmed = sku ? sku.trim() : `SKU-${i+1}`;
        const nameTrimmed = name.trim();

        // Lọc tìm kiếm
        if (search) {
          if (!nameTrimmed.toLowerCase().includes(search) && !skuTrimmed.toLowerCase().includes(search)) {
            return;
          }
        }

        LIVE_PRODUCTS.push({
          id: (i + 1).toString(),
          name: nameTrimmed,
          sku: skuTrimmed,
          brand: brand ? brand.trim() : 'Cadisen',
          status: 'Chờ đăng'
        });
      }
    });
    
    const end = start + limit;
    const data = LIVE_PRODUCTS.slice(start, end);
    
    res.json({
      data,
      total: LIVE_PRODUCTS.length,
      page,
      limit,
      totalPages: Math.ceil(LIVE_PRODUCTS.length / limit),
      syncedAt: new Date().toISOString() // Thời điểm thực tế lấy dữ liệu từ Sheet
    });

  } catch (error) {
    console.error('Lỗi khi kéo Google Sheet:', error);
    res.status(500).json({ error: 'Không thể kết nối đến Google Sheet' });
  }
});

// 3. Nút Đồng bộ Sheet
router.post('/trigger-sync', (req, res) => {
  res.json({ success: true, message: 'Đã kích hoạt đồng bộ.', syncedAt: new Date().toISOString() });
});

// 4. Nút Chạy Auto Ngay - Gọi hàm THẬT
router.post('/trigger-workflow', async (req, res) => {
  // Reset stop signal trước mỗi lần chạy mới
  resetGlobalStop();
  addActivity('Bắt đầu luồng Auto đăng bài (AI Workflow)', 'info');
  sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: '🚀 Bắt đầu luồng thực tế...', type: 'info' });

  autoPublishRoutine()
    .then(() => {
      sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: '✅ Luồng kết thúc thành công!', type: 'success' });
      addActivity('Luồng Auto kết thúc thành công', 'success');
    })
    .catch((err) => {
      const isAborted = err.message?.includes('aborted') || err.name === 'AbortError';
      const msg = isAborted ? '⏹️ Luồng đã bị dừng theo yêu cầu.' : `❌ Lỗi luồng: ${err.message}`;
      const type = isAborted ? 'highlight' : 'error';
      sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: msg, type });
      addActivity(msg, isAborted ? 'warning' : 'error');
    });

  res.json({ success: true, message: 'Luồng thật đã được khởi động!' });
});

// 4b. Dừng Luồng NGAY LẬP TỨC (Abrupt Stop)
router.post('/stop-workflow', async (req, res) => {
  triggerGlobalStop(); // Phát tín hiệu abort ngay lập tức
  console.log('⏹️ Nhận lệnh DỪNG NGAY từ Frontend. Đang hủy toàn bộ...');
  sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: '⏹️ Đã nhận lệnh DỪNG. Hủy toàn bộ tiến trình ngay lập tức!', type: 'error' });

  // Xóa sạch tất cả job đang chờ trong hàng đợi BullMQ
  try {
    await publishQueue.drain(true); // Drain: hủy tất cả job đang chờ (waiting + delayed)
    const active = await publishQueue.getActive();
    for (const job of active) {
      await job.discard(); // Đánh dấu job đang chạy là thất bại ngay
    }
    console.log('✅ Đã drain queue và discard tất cả active jobs.');
  } catch (e) {
    console.log('⚠️ Không thể drain queue:', e.message);
  }

  res.json({ success: true, message: 'Đã dừng toàn bộ ngay lập tức.' });
});

// 5. Server-Sent Events (SSE) Endpoint cho Live Monitor
router.get('/logs/stream', (req, res) => {
  // Header cho SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Thêm client vào danh sách
  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  // Gửi lịch sử log cũ trước (nếu có)
  if (logHistory.length > 0) {
    res.write(`data: ${JSON.stringify({ type: 'history', logs: logHistory })}\n\n`);
  }

  // Gửi tin nhắn khởi tạo
  res.write(`data: ${JSON.stringify({ time: new Date().toLocaleTimeString(), sender: 'System', message: 'Đã kết nối Live Monitor. Đang chờ sự kiện...', type: 'info' })}\n\n`);

  // Xóa client khi đóng kết nối
  req.on('close', () => {
    clients = clients.filter(client => client.id !== clientId);
  });
});

// API Đọc / Ghi file .env
router.get('/env', (req, res) => {
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const parsed = dotenv.parse(content);
      res.json(parsed);
    } else {
      res.json({});
    }
  } catch (error) {
    res.status(500).json({ error: 'Cannot read .env' });
  }
});

router.post('/env', (req, res) => {
  try {
    const envPath = path.join(__dirname, '../../.env');
    const updates = req.body;
    
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf8');
      for (const [key, value] of Object.entries(updates)) {
        if (!value) continue; 
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(content)) {
          content = content.replace(regex, `${key}=${value}`);
        } else {
          content += `\n${key}=${value}`;
        }
      }
      fs.writeFileSync(envPath, content);
      dotenv.config({ path: envPath, override: true });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: '.env not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Cannot update .env' });
  }
});

// API Đăng nhập thủ công AI (Mở Browser có giao diện)
router.post('/ai/reset-profile', async (req, res) => {
  const { provider } = req.body;
  if (!['chatgpt', 'gemini'].includes(provider)) {
    return res.status(400).json({ error: 'Provider không hợp lệ' });
  }

  try {
    // Không await toàn bộ tiến trình để frontend đỡ timeout, 
    // thực tế Playwright chờ user tắt thì có thể lâu. 
    // Tuy nhiên hàm API thường có timeout 2 phút, ta sẽ cứ await
    // Nếu quá 2 phút, user sẽ dùng màn hình cmd của Node để biết kết quả
    await openLoginHelper(provider);
    res.json({ success: true, message: 'Đã hoàn tất đăng nhập' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Đọc Cấu hình (Lịch Đăng)
router.get('/settings', (req, res) => {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(data);
      // Ensure connectedSocials exists
      if (!settings.connectedSocials) {
        settings.connectedSocials = { facebook: true, instagram: true, threads: false, tiktok: false };
      }
      res.json(settings);
    } else {
      res.json({ 
        timeSlots: ["08:00", "11:30", "20:00"], 
        igDelay: 10, 
        delayUnit: "minutes",
        connectedSocials: { facebook: true, instagram: true, threads: false, tiktok: false }
      });
    }
  } catch (e) {
    res.status(500).json({ error: 'Cannot read settings' });
  }
});

// 7. Lưu Cấu hình & Khởi động lại Scheduler
router.post('/settings', async (req, res) => {
  try {
    const newSettings = req.body;
    let currentSettings = {};
    if (fs.existsSync(settingsPath)) {
      currentSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }

    const mergedSettings = { ...currentSettings, ...newSettings };
    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
    
    // Khởi động lại Scheduler để áp dụng Khung giờ vàng mới (nếu có update)
    await startScheduler();
    
    if (newSettings.timeSlots) {
      sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: `✅ Đã cập nhật lại lịch đăng bài (${newSettings.timeSlots.join(', ')}). Hệ thống đếm ngược đã khởi động lại.`, type: 'success' });
    }
    
    res.json({ success: true, message: 'Settings saved' });
  } catch (e) {
    res.status(500).json({ error: 'Cannot save settings' });
  }
});

// 8. API lấy Lịch sử đăng bài (Cho trang Lịch)
router.get('/history', async (req, res) => {
  try {
    const historyData = await getAllPostedHistory();
    res.json(historyData);
  } catch (err) {
    res.json([]);
  }
});
// 9. Upload file .md — Tách riêng theo node, hỗ trợ nhiều file mỗi node
const mdUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // max 5MB mỗi file

// Liệt kê các file .md hiện có của từng node
router.get('/prompt-md-files/:nodeId', (req, res) => {
  const { nodeId } = req.params;
  const validNodes = ['gpt', 'gemini'];
  if (!validNodes.includes(nodeId)) return res.status(400).json({ message: 'nodeId không hợp lệ' });

  try {
    const configDir = path.join(__dirname, '../../config');
    const nodePrefix = nodeId === 'gpt' ? 'gpt_' : 'gemini_';
    // Liệt kê tất cả file .md trong config thuộc node đó (theo prefix)
    const nodeFileMap = {
      gpt: ['gpt_image_prompt.md'],
      gemini: ['gemini-prompt-template.md', 'watch-marketing-content.md', 'customer-persona.md']
    };
    const expectedFiles = nodeFileMap[nodeId];
    const files = expectedFiles
      .filter(f => fs.existsSync(path.join(configDir, f)))
      .map(f => {
        const stat = fs.statSync(path.join(configDir, f));
        return { name: f, size: stat.size, updatedAt: stat.mtime };
      });
    res.json({ files });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Upload 1 hoặc nhiều file .md vào node
router.post('/upload-prompt-md/:nodeId', mdUpload.array('mdFiles', 10), async (req, res) => {
  const { nodeId } = req.params;
  const validNodes = ['gpt', 'gemini'];
  if (!validNodes.includes(nodeId)) return res.status(400).json({ message: 'nodeId không hợp lệ' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'Không có file nào được gửi lên.' });

  const configDir = path.join(__dirname, '../../config');
  const saved = [];
  const errors = [];

  for (const file of req.files) {
    if (!file.originalname.endsWith('.md')) {
      errors.push(`${file.originalname}: chỉ chấp nhận .md`);
      continue;
    }
    try {
      // Lưu file bằng tên gốc vào thư mục config
      const savePath = path.join(configDir, file.originalname);
      fs.writeFileSync(savePath, file.buffer);
      console.log(`📄 [Upload/${nodeId}] Đã lưu: ${file.originalname} (${file.size} bytes)`);
      saved.push({ name: file.originalname, size: file.size });
    } catch (e) {
      errors.push(`${file.originalname}: ${e.message}`);
    }
  }

  res.json({
    success: saved.length > 0,
    saved,
    errors,
    message: `Đã lưu ${saved.length} file${errors.length ? `, ${errors.length} lỗi` : ''}.`
  });
});

// Xoá 1 file .md khỏi node
router.delete('/prompt-md-files/:nodeId/:filename', (req, res) => {
  const { nodeId, filename } = req.params;
  const validNodes = ['gpt', 'gemini'];
  // Danh sách file cốt lõi không được xoá
  const coreFiles = ['gpt_image_prompt.md', 'gemini-prompt-template.md'];

  if (!validNodes.includes(nodeId)) return res.status(400).json({ message: 'nodeId không hợp lệ' });
  if (coreFiles.includes(filename)) return res.status(403).json({ message: `File "${filename}" là file cốt lõi, không thể xoá qua UI.` });
  if (!filename.endsWith('.md') || filename.includes('..')) return res.status(400).json({ message: 'Tên file không hợp lệ.' });

  try {
    const filePath = path.join(__dirname, '../../config', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File không tồn tại.' });
    fs.unlinkSync(filePath);
    console.log(`🗑️ [Delete/${nodeId}] Đã xoá: ${filename}`);
    res.json({ success: true, message: `Đã xoá ${filename}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
