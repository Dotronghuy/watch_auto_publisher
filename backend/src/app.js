import 'dotenv/config';
import express from 'express';
import apiRoutes from './routes/api.routes.js';
import cors from 'cors';
import { startScheduler } from './scheduler.js';
import { trackPostMetrics } from './services/tracking.service.js';
import { startTelegramBot } from './services/telegram.service.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import shopeeRoutes from './routes/shopee.routes.js';
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

startTelegramBot();

app.listen(PORT, async () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);

  // 1. Scheduler dọn sạch Redis trước
  await startScheduler();

  // 2. Chỉ sau khi scheduler đã dọn sạch xong mới khởi động Worker
  // Tránh Worker pick up job stalled cũ từ phiên trước
  await import('./workers/publish.worker.js');
  console.log('✅ Worker đã khởi động sau khi Scheduler dọn sạch queue.');

  // 3. Khởi động Background Job để tracking Metrics
  setInterval(async () => {
    console.log('📊 Đang chạy tiến trình quét tương tác bài viết (5 phút/lần)...');
    await trackPostMetrics();
  }, 5 * 60 * 1000); // Mỗi 5 phút
});
