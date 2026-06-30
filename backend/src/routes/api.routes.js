import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import Papa from 'papaparse';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import multer from 'multer';
import { spawn } from 'child_process';
import { startScheduler } from '../scheduler.js';
import { autoPublishRoutine, dryRunRoutine, resetGlobalStop, triggerGlobalStop, getIsRunning, forceResetRunningState, trainImageOnly, trainContentOnly, getToneInstructionText } from '../services/publish.service.js';
import { getProductInfoBySku } from '../services/sheet.service.js';
import { openLoginHelper, generateContentOnChatGPT, generateBackgroundOnChatGPT, analyzeNewSampleImages } from '../services/playwright.service.js';
import { publishQueue } from '../workers/queue.js';
import { recentActivities, addActivity } from '../utils/activity.js';
import { getAllPostedHistory, getTodayEngagement } from '../utils/history.js';
import { trackPostMetrics } from '../services/tracking.service.js';
import logEmitter from '../utils/liveLog.js';
import { getFoldersInFolder, getImagesInFolder, getFolderIdByName, downloadFileFromDrive } from '../services/drive.service.js';
import { initCRMDB, getConversations, getMessagesByConversation, saveMessage, markConversationAsRead, getConversationById, getCustomerProfile, updateCustomerProfile, updateBotPausedStatus } from '../utils/crm.db.js';
import { syncAllCRM, replyCRM } from '../services/crm.service.js';
import { autoTagAllConversations } from '../services/autotag.service.js';
import { syncHashesFromSheets } from '../services/image-hash.service.js';

// Khởi tạo bảng CRM DB nếu chưa có
initCRMDB().then(() => console.log('✅ Đã khởi tạo CRM SQLite DB')).catch(e => console.error('Lỗi CRM DB:', e));

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
const settingsPath = path.join(__dirname, '../../config/settings.json');

const router = express.Router();

// Lưu trữ các client SSE đang kết nối
let clients = [];
let logHistory = [];
let isScanningDrive = false;

// CRM SSE: Realtime push cho CRM Inbox
let crmClients = [];

export const broadcastCRM = (eventType, data) => {
  const payload = JSON.stringify({ type: eventType, data, time: Date.now() });
  crmClients.forEach(client => {
    client.res.write(`data: ${payload}\n\n`);
  });
};

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

// 1b. Dashboard Engagement - Tổng hợp tương tác real-time trong ngày
router.get('/dashboard/engagement', async (req, res) => {
  try {
    const accountId = req.query.accountId || null;
    const engagement = await getTodayEngagement(accountId);
    res.json({ today: engagement });
  } catch (err) {
    console.error('Lỗi lấy engagement:', err);
    res.status(500).json({ error: 'Cannot fetch engagement data' });
  }
});

// 1c. Quét tương tác ngay lập tức (trigger thủ công)
router.post('/dashboard/track-now', async (req, res) => {
  try {
    const accountId = req.query.accountId || null;
    console.log('📊 [Thủ công] Đang quét tương tác bài viết...');
    await trackPostMetrics();
    const engagement = await getTodayEngagement(accountId);
    console.log('✅ [Thủ công] Quét tương tác hoàn tất!');
    res.json({ success: true, today: engagement });
  } catch (err) {
    console.error('Lỗi quét tương tác:', err);
    res.status(500).json({ error: 'Tracking failed' });
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
    await publishQueue.drain(true);
    const active = await publishQueue.getActive();
    for (const job of active) {
      await job.discard();
    }
    console.log('✅ Đã drain queue và discard tất cả active jobs.');
  } catch (e) {
    console.log('⚠️ Không thể drain queue:', e.message);
  }

  // Sau 3 giây nếu routine vẫn chưa tự reset, force reset để tránh kẹt flag
  setTimeout(() => { forceResetRunningState(); }, 3000);

  res.json({ success: true, message: 'Đã dừng toàn bộ ngay lập tức.' });
});

// Reset trạng thái khi bị kẹt mà không cần restart server
router.post('/reset-state', (req, res) => {
  forceResetRunningState();
  console.log('🔄 Đã force reset trạng thái hệ thống.');
  res.json({ success: true, message: 'Đã reset trạng thái. Bạn có thể chạy lại.' });
});

router.post('/train-image', async (req, res) => {
  try {
    resetGlobalStop();
    const { sku } = req.body || {};
    addActivity('Bắt đầu Train Ảnh (GPT Vision)' + (sku ? ` - SKU: ${sku}` : ''), 'info');
    sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: '🚀 Bắt đầu luồng Train Ảnh...', type: 'info' });
    
    const result = await trainImageOnly(sku);
    res.json(result);
  } catch (err) {
    const isAborted = err.message?.includes('aborted') || err.name === 'AbortError';
    const msg = isAborted ? '⏹️ Train Ảnh bị dừng.' : `❌ Lỗi: ${err.message}`;
    sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: msg, type: isAborted ? 'warning' : 'error' });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/train-content', async (req, res) => {
  try {
    resetGlobalStop();
    addActivity('Bắt đầu Train Content', 'info');
    sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: '📝 Bắt đầu luồng Train Content...', type: 'info' });
    
    const result = await trainContentOnly();
    res.json(result);
  } catch (err) {
    const isAborted = err.message?.includes('aborted') || err.name === 'AbortError';
    const msg = isAborted ? '⏹️ Train Content bị dừng.' : `❌ Lỗi: ${err.message}`;
    sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: msg, type: isAborted ? 'warning' : 'error' });
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4c. DRY RUN — Chạy thử toàn bộ luồng AI nhưng KHÔNG đăng lên MXH
router.post('/dry-run', async (req, res) => {
  resetGlobalStop();
  addActivity('Bắt đầu Dry Run — Kiểm thử AI không đăng MXH', 'info');
  sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: '🧪 Bắt đầu Dry Run — Sẽ không đăng lên Facebook/Instagram...', type: 'highlight' });

  try {
    const result = await dryRunRoutine();
    sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: `✅ Dry Run hoàn thành! SKU: ${result.sku} | ${result.imageCount} ảnh`, type: 'success' });
    addActivity(`Dry Run thành công — SKU: ${result.sku}`, 'success');
    res.json(result);
  } catch (err) {
    const isAborted = err.message?.includes('aborted') || err.name === 'AbortError';
    const msg = isAborted ? '⏹️ Dry Run bị dừng theo yêu cầu.' : `❌ Dry Run thất bại: ${err.message}`;
    const type = isAborted ? 'highlight' : 'error';
    sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: msg, type });
    addActivity(msg, isAborted ? 'warning' : 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4d. Trigger quét Google Drive (chạy ngầm)
router.post('/trigger-scan', (req, res) => {
  if (isScanningDrive) {
    return res.status(400).json({ success: false, message: 'Hệ thống đang trong quá trình quét Drive, vui lòng đợi!' });
  }

  isScanningDrive = true;
  addActivity('Bắt đầu quét Google Drive (Thủ công)', 'info');
  sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: '🚀 Đang khởi tạo tiến trình quét toàn bộ Google Drive...', type: 'info' });

  // Spawn tiến trình con chạy scan_drive.js
  const scriptPath = path.join(__dirname, '../scripts/scan_drive.js');
  const child = spawn('node', [scriptPath], {
    cwd: path.join(__dirname, '../../') // CWD là thư mục backend/
  });

  child.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      // Bắn log trực tiếp lên Live Monitor
      sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'Scanner', message: output, type: 'info' });
    }
  });

  child.stderr.on('data', (data) => {
    const errorOutput = data.toString().trim();
    if (errorOutput) {
      sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'Scanner Error', message: errorOutput, type: 'error' });
    }
  });

  child.on('close', (code) => {
    isScanningDrive = false;
    if (code === 0) {
      sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: '✅ Quá trình quét Drive và cập nhật Sheets hoàn tất thành công!', type: 'success' });
      addActivity('Quét Google Drive hoàn tất', 'success');
    } else {
      sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: `❌ Quá trình quét Drive thất bại (Mã lỗi: ${code})`, type: 'error' });
      addActivity('Quét Google Drive thất bại', 'error');
    }
  });

  res.json({ success: true, message: 'Tiến trình quét Drive đã được kích hoạt ngầm.' });
});

// Thử nghiệm Hành Văn AI (SSE Stream)
router.get('/publish/test-tones', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const tones = [
      "Sang trọng, tinh tế", "Gần gũi, đời thường", "Kể chuyện (Storytelling)", 
      "Trực diện, chốt sale", "Kiến thức chuyên gia", "Hài hước, thả thính",
      "Kể chuyện hài, phối đồ", "Phối đồ"
    ];
    const ctas = [
      "Inbox ngay để nhận ưu đãi", "Để lại bình luận để được tư vấn chi tiết",
      "Đừng bỏ lỡ siêu phẩm này", "Nhắn tin cho shop ngay nhé"
    ];

    // Lấy template
    const templatePath = path.join(__dirname, '../../config/gemini-prompt-template.md');
    let promptTemplate = '';
    if (fs.existsSync(templatePath)) promptTemplate = fs.readFileSync(templatePath, 'utf8');

    // Lấy 1 ảnh ngẫu nhiên từ Google Drive của user
    let sampleImgPath = null;
    let skuName = 'SKU-DEMO';
    try {
      const ROOT_DRIVE_FOLDER_ID = process.env.ROOT_DRIVE_FOLDER_ID || '1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl';
      const brandFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
      const iwFolder = brandFolders.find(f => f.name.toLowerCase().includes('i&w carnival') || f.name.toLowerCase().includes('i&w'));
      if (iwFolder) {
        const skuFolders = (await getFoldersInFolder(iwFolder.id)).filter(f => !f.name.toLowerCase().includes('review'));
        if (skuFolders.length > 0) {
          // Lấy ngẫu nhiên 1 SKU
          const randomSkuFolder = skuFolders[Math.floor(Math.random() * skuFolders.length)];
          skuName = randomSkuFolder.name;
          
          // Ưu tiên tìm trong 1_Anh_Hang hoặc 2_Anh_Tu_Chup vì có nhiều chi tiết hơn ảnh AVT
          // Đảo ngẫu nhiên để lấy ngẫu nhiên 1 trong 2 thư mục này trước
          const checkDirs = ['1_Anh_Hang', '2_Anh_Tu_Chup'].sort(() => Math.random() - 0.5);
          for (const dir of checkDirs) {
            const dirId = await getFolderIdByName(dir, randomSkuFolder.id);
            if (dirId) {
              const images = await getImagesInFolder(dirId);
              if (images.length > 0) {
                const randomImg = images[Math.floor(Math.random() * images.length)];
                sampleImgPath = await downloadFileFromDrive(randomImg.id, randomImg.name);
                break;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Lỗi khi lấy ảnh từ Drive cho Test Tones:', err.message);
      // Fallback xuống ảnh ở config nếu lỗi
      const sampleDir = path.join(__dirname, '../../config/sample_images');
      if (fs.existsSync(sampleDir)) {
        const files = fs.readdirSync(sampleDir).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
        if (files.length > 0) sampleImgPath = path.join(sampleDir, files[Math.floor(Math.random() * files.length)]);
      }
    }

    // Lấy context
    let marketingContext = '';
    try {
      const markPath = path.join(__dirname, '../../config/watch-marketing-content.md');
      if (fs.existsSync(markPath)) marketingContext = fs.readFileSync(markPath, 'utf8');
    } catch (e) { }

    let customerContext = '';
    try {
      const custPath = path.join(__dirname, '../../config/customer-persona.md');
      if (fs.existsSync(custPath)) customerContext = fs.readFileSync(custPath, 'utf8');
    } catch (e) { }

    const extraContext = `
${marketingContext ? `[KIẾN THỨC MARKETING NGÀNH ĐỒNG HỒ]\n${marketingContext}\n\n` : ''}
${customerContext ? `[CHÂN DUNG KHÁCH HÀNG]\n${customerContext}\n\n` : ''}`;

    // Lấy template FB
    const fbTemplatePath = path.join(__dirname, '../../config/gemini-prompt-template.md');
    let fbPromptTemplate = '';
    if (fs.existsSync(fbTemplatePath)) fbPromptTemplate = fs.readFileSync(fbTemplatePath, 'utf8');

    // Lấy template IG
    const igTemplatePath = path.join(__dirname, '../../config/ig-prompt-template.md');
    let igPromptTemplate = '';
    if (fs.existsSync(igTemplatePath)) igPromptTemplate = fs.readFileSync(igTemplatePath, 'utf8');
    else igPromptTemplate = fbPromptTemplate;

    // Lấy thông tin sản phẩm
    let productInfoText = '';
    let gender = 'Nam/Nữ';
    try {
      const productInfo = await getProductInfoBySku(skuName);
      if (productInfo) {
        productInfoText = Object.entries(productInfo).map(([k, v]) => `${k}: ${v}`).join('\n');
        
        const skuUpper = skuName.toUpperCase();
        if (/G\d*$|G[^A-Z]|\d+G/.test(skuUpper)) gender = 'Nam (Lịch lãm, nam tính)';
        else if (/L\d*$|L[^A-Z]|\d+L/.test(skuUpper)) gender = 'Nữ (Thanh lịch, quý phái)';
      }
    } catch (e) {
      console.error('Lỗi khi lấy thông tin sản phẩm:', e);
    }

    const prepareTemplate = (template) => {
      if (!template) return '';
      return extraContext + '\n' + template
        .replace(/\{\{SKU\}\}/g, skuName)
        .replace(/\{\{SKU_NAME\}\}/g, skuName)
        .replace(/\{\{GENDER\}\}/g, gender)
        .replace(/\{\{PRODUCT_INFO\}\}/g, productInfoText || 'Không có thông tin chi tiết');
    };

    const baseFbPrompt = fbPromptTemplate ? prepareTemplate(fbPromptTemplate) : `Sản phẩm: Đồng hồ ${skuName}. Hãy viết bài.`;
    const baseIgPrompt = igPromptTemplate ? prepareTemplate(igPromptTemplate) : `Sản phẩm: Đồng hồ ${skuName}. Hãy viết bài.`;

    for (let i = 0; i < tones.length; i++) {
      const tone = tones[i];
      const cta = ctas[Math.floor(Math.random() * ctas.length)];
      const perspective = "Góc nhìn của chuyên gia tư vấn";
      
      const instruction = getToneInstructionText(tone, perspective, cta);

      const fbFinalPrompt = baseFbPrompt + instruction + "\n\n[LƯU Ý QUAN TRỌNG: BẠN PHẢI CHỈ VIẾT NỘI DUNG CHO FACEBOOK DỰA THEO HƯỚNG DẪN TRÊN. BỎ QUA CÁC YÊU CẦU CHO NỀN TẢNG KHÁC. TRẢ VỀ TRỰC TIẾP NỘI DUNG MÀ KHÔNG CẦN TIÊU ĐỀ ## FACEBOOK]";
      const igFinalPrompt = baseIgPrompt + instruction + "\n\n[LƯU Ý QUAN TRỌNG: BẠN PHẢI CHỈ VIẾT NỘI DUNG CHO INSTAGRAM DỰA THEO HƯỚNG DẪN TRÊN. BỎ QUA CÁC YÊU CẦU CHO NỀN TẢNG KHÁC. TRẢ VỀ TRỰC TIẾP NỘI DUNG MÀ KHÔNG CẦN TIÊU ĐỀ ## INSTAGRAM]";

      sendEvent('progress', { index: i + 1, total: tones.length, tone });

      try {
        const fbContent = await generateContentOnChatGPT(fbFinalPrompt, 'fb', sampleImgPath);
        const igContent = await generateContentOnChatGPT(igFinalPrompt, 'ig', sampleImgPath);
        
        const combinedContent = `========== DÀNH CHO FACEBOOK ==========\n${fbContent}\n\n========== DÀNH CHO INSTAGRAM ==========\n${igContent}`;
        sendEvent('result', { index: i + 1, tone, cta, content: combinedContent });
      } catch (e) {
        sendEvent('result', { index: i + 1, tone, cta, content: `Lỗi: ${e.message}` });
      }
    }

    sendEvent('done', { message: 'Hoàn tất' });
  } catch (error) {
    sendEvent('error', { message: error.message });
  } finally {
    res.end();
  }
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

// API Đọc/Ghi Accounts
router.get('/accounts', (req, res) => {
  try {
    const accountsPath = path.join(__dirname, '../../config/accounts.json');
    if (fs.existsSync(accountsPath)) {
      const data = fs.readFileSync(accountsPath, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.json([]);
    }
  } catch (error) {
    res.status(500).json({ error: 'Cannot read accounts.json' });
  }
});

router.post('/accounts', (req, res) => {
  try {
    const accountsPath = path.join(__dirname, '../../config/accounts.json');
    const accounts = req.body;
    fs.writeFileSync(accountsPath, JSON.stringify(accounts, null, 2), 'utf8');
    res.json({ success: true, message: 'Accounts updated' });
  } catch (error) {
    res.status(500).json({ error: 'Cannot update accounts.json' });
  }
});
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

// ─── SAMPLE IMAGES (Ảnh mẫu tham chiếu cho ChatGPT) ───
const SAMPLE_IMAGES_DIR = path.join(__dirname, '../../config/sample_images');
const sampleImgUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }); // max 20MB

// Liệt kê ảnh mẫu
router.get('/sample-images', (req, res) => {
  try {
    if (!fs.existsSync(SAMPLE_IMAGES_DIR)) fs.mkdirSync(SAMPLE_IMAGES_DIR, { recursive: true });
    const validExt = ['.jpg', '.jpeg', '.png', '.webp'];
    const files = fs.readdirSync(SAMPLE_IMAGES_DIR)
      .filter(f => validExt.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const stat = fs.statSync(path.join(SAMPLE_IMAGES_DIR, f));
        return { name: f, size: stat.size, updatedAt: stat.mtime };
      });
    res.json({ files, count: files.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Upload ảnh mẫu
router.post('/sample-images', sampleImgUpload.array('images', 100), (req, res) => {
  if (!fs.existsSync(SAMPLE_IMAGES_DIR)) fs.mkdirSync(SAMPLE_IMAGES_DIR, { recursive: true });
  if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'Không có file nào.' });
  
  const saved = [];
  const errors = [];
  const validExt = ['.jpg', '.jpeg', '.png', '.webp'];
  
  for (const file of req.files) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!validExt.includes(ext)) { errors.push(`${file.originalname}: chỉ chấp nhận ảnh JPG/PNG/WEBP`); continue; }
    try {
      const savePath = path.join(SAMPLE_IMAGES_DIR, file.originalname);
      fs.writeFileSync(savePath, file.buffer);
      saved.push({ name: file.originalname, size: file.size });
      console.log(`📸 [Sample Images] Đã lưu: ${file.originalname}`);
    } catch (e) {
      errors.push(`${file.originalname}: ${e.message}`);
    }
  }
  
  res.json({ success: saved.length > 0, saved, errors, message: `Đã lưu ${saved.length} ảnh mẫu.` });

  // Chạy phân tích ảnh mẫu mới ở background (không block response)
  if (saved.length > 0) {
    analyzeNewSampleImages().catch(e => console.log('⚠️ Lỗi auto-analyze:', e.message));
  }
});

// Xóa 1 ảnh mẫu
router.delete('/sample-images/:filename', (req, res) => {
  const { filename } = req.params;
  if (!filename.match(/\.(jpg|jpeg|png|webp)$/i) || filename.includes('..')) {
    return res.status(400).json({ message: 'Tên file không hợp lệ.' });
  }
  try {
    const filePath = path.join(SAMPLE_IMAGES_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File không tồn tại.' });
    fs.unlinkSync(filePath);
    res.json({ success: true, message: `Đã xóa ${filename}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Phân tích ảnh mẫu thủ công → Sinh prompt vào .md
router.post('/analyze-samples', async (req, res) => {
  try {
    sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: '📸 Bắt đầu phân tích ảnh mẫu mới để sinh prompt...', type: 'highlight' });
    const result = await analyzeNewSampleImages();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// DELETE-PROMPT: Xóa bối cảnh xấu + "mắng" AI
// ═══════════════════════════════════════════════════════════
router.post('/delete-prompt', async (req, res) => {
  try {
    const { promptText } = req.body;
    if (!promptText) return res.status(400).json({ success: false, message: 'Thiếu promptText' });

    const promptGuidePath = path.join(__dirname, '../../config/gpt_image_prompt.md');
    if (!fs.existsSync(promptGuidePath)) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy file gpt_image_prompt.md' });
    }

    let content = fs.readFileSync(promptGuidePath, 'utf8');
    
    // Tìm block chứa prompt (từ ### TITLE → đến --- tiếp theo)
    const lines = content.split('\n');
    let startIdx = -1;
    let endIdx = -1;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(promptText.substring(0, 80))) {
        // Tìm ngược lên ### header
        for (let j = i; j >= 0; j--) {
          if (lines[j].trim().startsWith('###')) {
            startIdx = j;
            break;
          }
        }
        // Tìm xuôi xuống --- (hoặc ### tiếp theo)
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() === '---' || lines[j].trim().startsWith('###')) {
            endIdx = lines[j].trim() === '---' ? j + 1 : j;
            break;
          }
        }
        if (endIdx === -1) endIdx = lines.length;
        break;
      }
    }

    let deletedSection = '';
    if (startIdx >= 0 && endIdx > startIdx) {
      deletedSection = lines.slice(startIdx, endIdx).join('\n');
      lines.splice(startIdx, endIdx - startIdx);
      fs.writeFileSync(promptGuidePath, lines.join('\n'), 'utf8');
      console.log(`🗑️ Đã xóa block prompt từ dòng ${startIdx + 1} → ${endIdx} trong gpt_image_prompt.md`);
    } else {
      console.log('⚠️ Không tìm thấy block prompt khớp, tiếp tục gửi feedback cho AI...');
    }

    // Gửi tin nhắn "mắng" AI qua ChatGPT
    const scoldPrompt = `[HỆ THỐNG CẢNH BÁO]:
Bối cảnh/scene dưới đây vừa bị LOẠI BỎ bởi người dùng vì chất lượng kém hoặc không phù hợp:
"${promptText.substring(0, 300)}"

Lý do: Ảnh tạo ra từ bối cảnh này bị đánh giá là KHÔNG ĐẠT TIÊU CHUẨN (giả trân, góc chụp xấu, tỉ lệ sai, hoặc không phù hợp phong cách luxury).

TUYỆT ĐỐI KHÔNG sử dụng lại bối cảnh này hoặc các bối cảnh tương tự trong tương lai.
Chỉ cần trả lời ngắn gọn: "Đã ghi nhận và loại bỏ bối cảnh này khỏi danh sách!"`;
    
    try {
      await generateContentOnChatGPT(scoldPrompt, 'image_feedback', null);
      console.log('✅ Đã gửi cảnh báo cho AI về bối cảnh bị loại.');
    } catch (aiErr) {
      console.log(`⚠️ Lỗi khi gửi feedback cho AI (không nghiêm trọng): ${aiErr.message}`);
    }

    sendLogToClients({ 
      time: new Date().toLocaleTimeString(), 
      sender: 'System', 
      message: `🗑️ Đã đào thải 1 bối cảnh xấu khỏi prompt guide và nhắc nhở AI!`, 
      type: 'highlight' 
    });

    res.json({ success: true, message: 'Đã xóa prompt và gửi cảnh báo cho AI', deletedLines: endIdx - startIdx });

  } catch (err) {
    console.error('❌ Lỗi delete-prompt:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// FEEDBACK-PROMPT: Nhận xét + yêu cầu AI vẽ lại ảnh
// ═══════════════════════════════════════════════════════════
const feedbackUpload = multer({ 
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../../temp_images');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `feedback_ref_${Date.now()}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 20 * 1024 * 1024 }
});

router.post('/feedback-prompt', feedbackUpload.single('referenceImage'), async (req, res) => {
  try {
    const { promptText, feedbackText } = req.body;
    if (!promptText) return res.status(400).json({ success: false, message: 'Thiếu promptText' });

    sendLogToClients({ 
      time: new Date().toLocaleTimeString(), 
      sender: 'System', 
      message: `💬 Đang gửi nhận xét cho AI và yêu cầu vẽ lại ảnh...`, 
      type: 'highlight' 
    });

    // Tạo feedback prompt cho ChatGPT
    const feedbackMsg = `[PHẢN HỒI TỪ NGƯỜI DÙNG]:
Ảnh được tạo từ prompt sau bị chê:
"${promptText.substring(0, 400)}"

Nhận xét của người dùng: "${feedbackText || 'Không đạt yêu cầu, cần cải thiện'}"

YÊU CẦU:
1. Ghi nhớ phản hồi này để KHÔNG lặp lại lỗi tương tự.
2. Tạo lại 1 ảnh mới với bối cảnh tương tự nhưng đã sửa theo nhận xét.
3. Giữ nguyên chiếc đồng hồ 100% như gốc, chỉ thay đổi bối cảnh/góc chụp.`;

    // Nếu có ảnh tham chiếu, dùng generateBackgroundOnChatGPT
    // Nếu không, dùng generateContentOnChatGPT với image_feedback
    let newImageUrl = null;

    if (req.file) {
      // Có ảnh tham chiếu → gửi ảnh + prompt cho GPT-4 Vision
      console.log(`📤 Có ảnh tham chiếu: ${req.file.filename}`);
      const refImagePath = req.file.path;
      
      const generatedPaths = await generateBackgroundOnChatGPT(
        refImagePath,
        [{ prompt: feedbackMsg, sampleImage: refImagePath }],
        null,   // no abort signal
        null,   // no sample
        false,  // continue existing session
        []      // no extra images
      );
      
      if (generatedPaths && generatedPaths.length > 0) {
        // Trả về file path → convert sang URL
        const filename = path.basename(generatedPaths[0]);
        newImageUrl = `http://localhost:3000/temp_images/${filename}`;
      }
    } else {
      // Không có ảnh tham chiếu → gửi text feedback
      const generatedPaths = await generateBackgroundOnChatGPT(
        null,
        [{ prompt: feedbackMsg }],
        null,
        null,
        false,
        []
      );
      
      if (generatedPaths && generatedPaths.length > 0) {
        const filename = path.basename(generatedPaths[0]);
        newImageUrl = `http://localhost:3000/temp_images/${filename}`;
      }
    }

    sendLogToClients({ 
      time: new Date().toLocaleTimeString(), 
      sender: 'GPT-4 Vision', 
      message: newImageUrl ? '✅ AI đã tiếp thu nhận xét và sinh ảnh mới!' : '⚠️ AI đã tiếp thu nhưng chưa sinh được ảnh mới.', 
      type: newImageUrl ? 'success' : 'warning',
      image: newImageUrl || undefined 
    });

    res.json({ success: true, message: 'Đã gửi feedback cho AI', newImageUrl });

  } catch (err) {
    console.error('❌ Lỗi feedback-prompt:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// CRM ENDPOINTS (INBOX & COMMENTS)
// ============================================================

router.get('/crm/avatar/:accountId/:senderId', async (req, res) => {
  const { accountId, senderId } = req.params;
  try {
    const accountsFile = path.join(__dirname, '../../config/accounts.json');
    if (fs.existsSync(accountsFile)) {
      const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
      const acc = accounts.find(a => a.id === accountId && a.status === 'active');
      if (acc && acc.fbAccessToken) {
        const fbRes = await axios.default.get(`https://graph.facebook.com/v21.0/${senderId}?fields=profile_pic&access_token=${acc.fbAccessToken}`);
        if (fbRes.data && fbRes.data.profile_pic) {
          return res.redirect(fbRes.data.profile_pic);
        }
      }
    }
  } catch (e) {
    console.error(`Không thể lấy avatar cho ${senderId}`);
  }
  // Fallback avatar
  const fallbackName = req.query.name || senderId;
  res.redirect(`https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=random`);
});

router.get('/crm/conversations', async (req, res) => {
  try {
    const data = await getConversations();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/crm/conversations/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await getMessagesByConversation(id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRM SSE Endpoint — Realtime push
router.get('/crm/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  crmClients.push(newClient);

  res.write(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`);

  req.on('close', () => {
    crmClients = crmClients.filter(c => c.id !== clientId);
  });
});

router.post('/crm/sync', async (req, res) => {
  try {
    sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'CRM', message: 'Đang đồng bộ dữ liệu từ FB/IG...', type: 'info' });
    await syncAllCRM();
    sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'CRM', message: '✅ Đồng bộ CRM hoàn tất', type: 'success' });
    
    // Push realtime update to all CRM clients
    const conversations = await getConversations();
    
    // Auto-tag: phân tích tin nhắn và tự động gắn tags
    try {
      await autoTagAllConversations(conversations);
      sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'CRM', message: '🏷️ Auto-Tag hoàn tất', type: 'info' });
    } catch(e) {
      console.error('Lỗi Auto-Tag:', e.message);
    }
    
    broadcastCRM('conversations_updated', conversations);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TEMPORARY ENDPOINT TO FIX EXISTING BAD TAGS
router.post('/crm/fix-tags', async (req, res) => {
  try {
    const sqlite3 = (await import('sqlite3')).default;
    const path = await import('path');
    const dbPath = path.resolve(__dirname, '../../data/crm.sqlite');
    
    await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbPath);
      db.run('UPDATE customers SET tags = "[]"', [], (err) => {
        db.close();
        if (err) reject(err);
        else resolve();
      });
    });
    const conversations = await getConversations();
    await autoTagAllConversations(conversations);
    broadcastCRM('conversations_updated', await getConversations());
    res.json({ success: true, message: 'Tags cleared and rebuilt!' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/crm/reply', async (req, res) => {
  try {
    const { conversationId, targetId, message, type } = req.body;
    const result = await replyCRM(targetId, message, type, conversationId);
    
    // Lưu vào DB ở local ngay lập tức
    // Push message to CRM SSE clients instantly
    broadcastCRM('new_message', { conversationId, message: { id: 'msg_' + Date.now(), conversation_id: conversationId, message, is_from_page: 1, created_time: new Date().toISOString() } });

    await saveMessage(
      'msg_' + Date.now(), 
      conversationId, 
      message, 
      true, 
      new Date().toISOString()
    );

    res.json({ success: true, data: result });
  } catch (err) {
    require('fs').appendFileSync('error_log.txt', new Date().toISOString() + ' - Reply Error: ' + err.message + '\n');
    res.status(500).json({ error: err.message });
  }
});

// Đánh dấu đã đọc + gửi mark_seen cho FB/IG
router.post('/crm/conversations/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 1. Đánh dấu đã đọc trong DB
    await markConversationAsRead(id);
    
    // 2. Gửi mark_seen chỉ khi tin nhắn trong vòng 24h (chính sách Facebook)
    const conv = await getConversationById(id);
    if (conv && conv.type === 'inbox' && conv.sender_id) {
      const updatedAt = new Date(conv.updated_at);
      const hoursSinceUpdate = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
      
      // Chỉ gửi mark_seen nếu tin nhắn cuối trong vòng 24h
      if (hoursSinceUpdate <= 24) {
        const accountsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../config/accounts.json');
        let accounts = [];
        try { accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')); } catch(e) {}
        const acc = accounts.find(a => a.id === conv.account_id);
        
        if (acc) {
          const token = conv.platform === 'instagram' 
            ? (acc.igAccessToken || acc.fbAccessToken) 
            : acc.fbAccessToken;
          
          if (token) {
            try {
              await axios.post(`https://graph.facebook.com/v21.0/me/messages`, {
                recipient: { id: conv.sender_id },
                sender_action: 'mark_seen'
              }, {
                params: { access_token: token }
              });
              console.log(`✅ Đã gửi mark_seen cho ${conv.sender_name} (${conv.platform})`);
            } catch (apiErr) {
              // Bỏ qua — không ảnh hưởng chức năng
            }
          }
        }
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CRM Profile Endpoints ---

router.get('/crm/customers/:id', async (req, res) => {
  try {
    const profile = await getCustomerProfile(req.params.id);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/crm/customers/:id', async (req, res) => {
  try {
    await updateCustomerProfile(req.params.id, req.body);
    const updatedProfile = await getCustomerProfile(req.params.id);
    res.json(updatedProfile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cập nhật trạng thái Bot (Pause/Resume)
router.post('/crm/conversations/:id/bot-mode', async (req, res) => {
  try {
    const { id } = req.params;
    const { isPaused } = req.body;
    await updateBotPausedStatus(id, isPaused);
    res.json({ success: true, bot_paused: isPaused ? 1 : 0 });
    // Push update to FE
    const conversations = await getConversations();
    broadcastCRM('conversations_updated', conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint đồng bộ ảnh từ Google Sheets (Lớp 2 AI)
router.post('/crm/bot/sync-images', async (req, res) => {
  try {
    // Trả về response ngay để không bị timeout
    res.json({ success: true, message: 'Đang chạy đồng bộ ngầm...' });
    // Chạy ngầm
    syncHashesFromSheets();
  } catch (err) {
    console.error('Lỗi API sync-images:', err);
  }
});

export default router;
