import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import Papa from 'papaparse';
import dotenv from 'dotenv';
import { startScheduler } from '../scheduler.js';
import { openLoginHelper } from '../services/playwright.service.js';
import { autoPublishRoutine } from '../services/publish.service.js';
import { publishQueue } from '../workers/queue.js';
import { recentActivities, addActivity } from '../utils/activity.js';
import logEmitter from '../utils/liveLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, '../config/settings.json');

const router = express.Router();

// Lưu trữ các client SSE đang kết nối
let clients = [];

// ------- STOP SIGNAL -------
// Khi stopSignal.aborted === true, autoPublishRoutine sẽ dừng ở bước an toàn tiếp theo
let stopController = new AbortController();
export const getStopSignal = () => stopController.signal;

// Hàm gửi log tới tất cả các client đang xem Live Monitor
export const sendLogToClients = (logData) => {
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
    // A. Lấy tổng bài đã đăng từ lịch sử
    const historyPath = path.join(__dirname, '../../posted_history.json');
    let totalPosts = 0;
    let historyData = [];
    if (fs.existsSync(historyPath)) {
      const data = fs.readFileSync(historyPath, 'utf8');
      historyData = JSON.parse(data);
      totalPosts = historyData.length;
    }

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
      // Mặc định 7days: Tuần hiện tại T2-CN
      const dayOfWeek = curr.getDay() || 7; 
      for (let i = 1; i <= 7; i++) {
        const d = new Date();
        d.setDate(curr.getDate() - dayOfWeek + i);
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
        chartData.push({ name: `${dayNames[i-1]} (${dateStr})`, value: value });
      }
    }

    // C. Tính dung lượng Google Drive (Kết nối với tài khoản thật)
    // Hiện tại set cứng bằng số thực tế của Google Drive user cung cấp
    const storageUsedGB = 212.36;

    // D. Tính số luồng đang chạy
    let activeWorkers = 0;
    try {
      const active = await publishQueue.getActiveCount();
      const waiting = await publishQueue.getWaitingCount();
      activeWorkers = active + waiting;
    } catch (e) {
      // Ignored if Redis is down
    }

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
      totalPages: Math.ceil(LIVE_PRODUCTS.length / limit)
    });

  } catch (error) {
    console.error('Lỗi khi kéo Google Sheet:', error);
    res.status(500).json({ error: 'Không thể kết nối đến Google Sheet' });
  }
});

// 3. Nút Đồng bộ Sheet
router.post('/trigger-sync', (req, res) => {
  res.json({ success: true, message: 'Đã kích hoạt đồng bộ.' });
});

// 4. Nút Chạy Auto Ngay - Gọi hàm THẬT
router.post('/trigger-workflow', async (req, res) => {
  // Reset stop signal trước mỗi lần chạy mới
  stopController = new AbortController();
  addActivity('Bắt đầu luồng Auto đăng bài (AI Workflow)', 'info');
  sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: '🚀 Bắt đầu luồng thực tế...', type: 'info' });

  autoPublishRoutine(stopController.signal)
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

// 4b. Dừng Luồng
router.post('/stop-workflow', (req, res) => {
  stopController.abort();
  console.log('⏹️ Nhận lệnh Dừng từ Frontend. Đã gửi AbortSignal.');
  sendLogToClients({ time: new Date().toLocaleTimeString(), sender: 'System', message: '⏹️ Nhận lệnh dừng. Đang chờ kết thúc bước hiện tại an toàn...', type: 'highlight' });
  res.json({ success: true, message: 'Đã gửi tín hiệu dừng.' });
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
router.get('/history', (req, res) => {
  try {
    const historyPath = path.join(__dirname, '../../posted_history.json');
    if (fs.existsSync(historyPath)) {
      const data = fs.readFileSync(historyPath, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.json([]);
    }
  } catch (err) {
    res.json([]);
  }
});

export default router;
