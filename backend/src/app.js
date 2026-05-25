import 'dotenv/config'; // <-- Bắt buộc để trên cùng để nạp .env trước khi import các file khác
import express from 'express';
import cors from 'cors';
import { startScheduler } from './scheduler.js';
import './workers/publish.worker.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Watch Auto Publisher API is running!');
});

// Import routes here later
// app.use('/api/drive', driveRoutes);
// app.use('/api/publish', publishRoutes);

app.listen(PORT, async () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  
  // Khởi động lịch trình đăng bài tự động sau khi server lên
  await startScheduler();
});
