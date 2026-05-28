import { publishQueue } from './workers/queue.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, './config/settings.json');

export const startScheduler = async () => {
  console.log('⏰ Khởi động Scheduler hẹn giờ đăng bài theo Khung Giờ Vàng (BullMQ)...');

  // Đọc cấu hình settings.json
  let settings = { timeSlots: ["08:00", "11:30", "20:00"] };
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {
    console.error('Không thể đọc settings.json, dùng mặc định.', e);
  }

  // Xóa toàn bộ các job cũ đang chạy
  const repeatableJobs = await publishQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await publishQueue.removeRepeatableByKey(job.key);
  }
  
  // Dọn dẹp sạch sẽ các job đang bị kẹt trong hàng đợi (từ các lần test trước)
  try {
    await publishQueue.drain(true);
  } catch (e) {
    console.log('Không có job cũ cần dọn dẹp.');
  }

  // Lên lịch Job chạy tự động cho từng Khung giờ
  const timeSlots = settings.timeSlots || [];
  
  if (timeSlots.length === 0) {
     console.log('⚠️ Không có khung giờ nào được cài đặt! Hệ thống Auto sẽ TẠM NGƯNG.');
     return;
  }

  for (const timeStr of timeSlots) {
    const [hour, minute] = timeStr.split(':');
    // Định dạng Cron: Phút Giờ * * *
    const cronPattern = `${minute} ${hour} * * *`;
    
    await publishQueue.add('autoPublishJob', {}, {
      repeat: { pattern: cronPattern }
    });
    console.log(`✅ Đã lên lịch đăng bài cho Khung giờ: ${timeStr} (Cron: ${cronPattern})`);
  }

  console.log(`✅ Đã lên lịch thành công tổng cộng ${timeSlots.length} khung giờ đăng bài mỗi ngày.`);
};
