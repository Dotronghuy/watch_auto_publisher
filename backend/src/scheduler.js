import { publishQueue } from './workers/queue.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, './config/settings.json');

let isSchedulerRunning = false; // Guard chống gọi scheduler 2 lần đồng thời

export const startScheduler = async () => {
  if (isSchedulerRunning) {
    console.log('⚠️ Scheduler đang chạy, bỏ qua lần gọi thứ 2.');
    return;
  }
  isSchedulerRunning = true;

  console.log('⏰ Khởi động Scheduler hẹn giờ đăng bài theo Khung Giờ Vàng (BullMQ)...');

  // Đọc cấu hình settings.json — KHÔNG dùng giá trị mặc định
  let settings = {};
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {
    console.error('Không thể đọc settings.json.', e);
  }

  // === XÓA SẠCH TOÀN BỘ REDIS — NUCLEAR OPTION ===
  try {
    // BƯỚC 0: Obliterate — xóa tất cả mọi thứ trong queue (kể cả active jobs từ phiên trước)
    // Đây là cách duy nhất đảm bảo các job repeat: cũ không sống sót qua server restart
    await publishQueue.obliterate({ force: true });
    console.log('🧹 Đã obliterate toàn bộ queue (xóa kể cả active jobs cũ).');
  } catch (e) {
    // Nếu obliterate thất bại (ví dụ lỗi Redis), thử các bước thủ công
    try {
      const repeatableJobs = await publishQueue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        await publishQueue.removeRepeatableByKey(job.key);
      }
      await publishQueue.drain(true);
      await publishQueue.clean(0, 1000, 'delayed');
      await publishQueue.clean(0, 1000, 'wait');
      await publishQueue.clean(0, 1000, 'failed');
      await publishQueue.clean(0, 1000, 'completed');
      console.log('🧹 Đã dọn sạch toàn bộ job cũ trong hàng đợi (fallback).');
    } catch (e2) {
      console.log('⚠️ Lỗi khi dọn dẹp queue:', e2.message);
    }
  }

  if (settings.mode === 'test') {
    const intervalMinutes = parseInt(settings.testInterval) || 5;
    const cronPattern = `*/${intervalMinutes} * * * *`;
    await publishQueue.add('autoPublishJob', {}, {
      repeat: { pattern: cronPattern }
    });
    console.log(`✅ [Chế Độ TEST] Đã lên lịch tự động đăng bài mỗi ${intervalMinutes} phút (Cron: ${cronPattern})`);
  } else {
    // Chế độ Đăng Thật
    const timeSlots = settings.timeSlots || [];

    if (timeSlots.length === 0) {
      console.log('⚠️ Không có khung giờ nào được cài đặt! Hệ thống Auto sẽ TẠM NGƯNG cho đến khi bạn thêm khung giờ.');
      isSchedulerRunning = false; // Reset để lần sau vào Settings save vẫn gọi được
      return;
    }

    for (const timeStr of timeSlots) {
      if (!timeStr || !timeStr.includes(':')) continue;
      const [hour, minute] = timeStr.split(':');
      const cronPattern = `${parseInt(minute)} ${parseInt(hour)} * * *`;

      await publishQueue.add('autoPublishJob', {}, {
        repeat: { pattern: cronPattern }
      });
      console.log(`✅ Đã lên lịch đăng bài cho Khung giờ: ${timeStr} (Cron: ${cronPattern})`);
    }

    console.log(`✅ Đã lên lịch thành công tổng cộng ${timeSlots.length} khung giờ đăng bài mỗi ngày.`);
  }

  isSchedulerRunning = false; // Reset để cho phép gọi lại khi user thay đổi settings
};
