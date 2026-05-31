import 'dotenv/config';
import express from 'express';
import apiRoutes from './routes/api.routes.js';
import cors from 'cors';
import { startScheduler } from './scheduler.js';
import { trackPostMetrics } from './services/tracking.service.js';
import { startTelegramBot } from './services/telegram.service.js';
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
  if (err.code === 'ECONNRESET' || err.message.includes('ECONNRESET')) {
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

app.get('/', (req, res) => {
  res.send('Watch Auto Publisher API is running!');
});

// Import routes here later
app.use('/api', apiRoutes);
// app.use('/api/drive', driveRoutes);
// app.use('/api/publish', publishRoutes);

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
      console.log('📊 Đang chạy tiến trình quét tương tác bài viết (30 phút/lần)...');
      await trackPostMetrics();
  }, 30 * 60 * 1000); // Mỗi 30 phút
});
