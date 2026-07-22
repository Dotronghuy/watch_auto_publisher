import 'dotenv/config';
import express from 'express';
import apiRoutes from './routes/api.routes.js';
import cors from 'cors';
import { startScheduler } from './scheduler.js';
import { trackPostMetrics } from './services/tracking.service.js';
import { startTelegramBot } from './services/telegram.service.js';
import { startFastCRMInboxSync } from './services/crm.service.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import shopeeRoutes from './routes/shopee.routes.js';
import zenwatchRoutes from './routes/zenwatch.routes.js';
import bannerRoutes from './routes/banner.routes.js';
import autofillRoutes from './routes/autofill.routes.js';
// Worker sẽ được khởi động SAU khi scheduler dọn sạch queue
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Bỏ qua các lỗi đứt kết nối mạng rác để không làm bẩn Terminal
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'ECONNRESET' || (err.message && err.message.includes('ECONNRESET')))) {
    // Ignore
    return;
  }
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  if (reason && (reason.code === 'ECONNRESET' || (reason.message && reason.message.includes('ECONNRESET')))) {
    // Ignore
    return;
  }
  console.error('Unhandled Rejection:', reason);
});

// Phục vụ ảnh tạm từ ChatGPT để Live Monitor hiển thị được
// temp_images nằm ở backend/temp_images, từ backend/src/ chỉ cần 1 cấp (..) để lên backend/
app.use('/images', express.static(path.join(__dirname, '../temp_images')));
app.use('/temp_images', express.static(path.join(__dirname, '../temp_images')));

// Import routes here later
app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/webhook', webhookRoutes);
app.use('/api/shopee', shopeeRoutes);
app.use('/api/zenwatch', zenwatchRoutes);
app.use('/api/banner', bannerRoutes);
app.use('/api/autofill', autofillRoutes);
// app.use('/api/drive', driveRoutes);
// app.use('/api/publish', publishRoutes);

// Phục vụ frontend tĩnh (React build)
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

// Chuyển hướng các route không phải API về React để xử lý SPA
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (req.path.startsWith('/images')) return next();
  if (req.path.startsWith('/temp_images')) return next();
  if (req.path.startsWith('/webhook')) return next();
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// Global Express error handler — bắt tất cả lỗi từ route handlers không được catch
app.use((err, req, res, next) => {
  console.error('[Express Error]', err.message || err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

try { startTelegramBot(); } catch (e) { console.error('⚠️ Telegram bot lỗi khi khởi động:', e.message); }

app.listen(PORT, async () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);

  try {
    startFastCRMInboxSync(process.env.CRM_FAST_SYNC_INTERVAL_MS || 2000);
  } catch (error) {
    console.error('⚠️ Không thể khởi động đồng bộ nhanh CRM Inbox:', error.message);
  }

  // 1 & 2. Khởi động Scheduler & Worker (Bọc try-catch để bypass lỗi Redis Upstash Limit)
  try {
    await startScheduler();
    await import('./workers/publish.worker.js');
    console.log('✅ Worker đã khởi động sau khi Scheduler dọn sạch queue.');
  } catch (error) {
    console.error('⚠️ KHÔNG THỂ KẾT NỐI REDIS (Hoặc hết Limit Upstash). Các tính năng Queue đăng bài sẽ tạm ngưng. App vẫn tiếp tục chạy.', error.message);
  }

  // 3. Khởi động Background Job để tracking Metrics
  // TẠM TẮT: Theo yêu cầu để tránh rác terminal
  // setInterval(async () => {
  //   try {
  //     console.log('📊 Đang chạy tiến trình quét tương tác bài viết (5 phút/lần)...');
  //     await trackPostMetrics();
  //   } catch (e) {
  //     console.error('⚠️ Lỗi trackPostMetrics (bỏ qua):', e.message);
  //   }
  // }, 5 * 60 * 1000); // Mỗi 5 phút
});
