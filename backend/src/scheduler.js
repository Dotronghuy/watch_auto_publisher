import { publishQueue, connection as redisConnection } from './workers/queue.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { spawn } from 'child_process';
import { syncAllCRM } from './services/crm.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, '../config/settings.json');
const heartbeatPath = path.join(__dirname, '../config/.heartbeat');

let isSchedulerRunning = false; // Guard chống gọi scheduler 2 lần đồng thời
let heartbeatInterval = null;

/**
 * Kiểm tra xem đây là "Hot Reload" (sửa code, save file) hay "Cold Start" (server tắt lâu).
 * Nếu file heartbeat được cập nhật trong vòng 30 giây qua → Hot Reload → KHÔNG xóa lịch.
 */
const isHotReload = () => {
  try {
    if (fs.existsSync(heartbeatPath)) {
      const lastBeat = parseInt(fs.readFileSync(heartbeatPath, 'utf8').trim(), 10);
      const elapsed = Date.now() - lastBeat;
      return elapsed < 30000; // Dưới 30 giây = hot reload
    }
  } catch (e) { /* ignore */ }
  return false;
};

/** Ghi nhịp tim mỗi 10 giây để đánh dấu server đang sống */
const startHeartbeat = () => {
  const beat = () => {
    try { fs.writeFileSync(heartbeatPath, String(Date.now()), 'utf8'); } catch (e) { /* ignore */ }
  };
  beat(); // Ghi ngay lập tức
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(beat, 10000);
};

export const startScheduler = async () => {
  if (isSchedulerRunning) {
    console.log('⚠️ Scheduler đang chạy, bỏ qua lần gọi thứ 2.');
    return;
  }
  isSchedulerRunning = true;

  // === PHÂN BIỆT HOT RELOAD vs COLD START ===
  // QUAN TRỌNG: Phải check TRƯỚC khi ghi heartbeat mới
  const hotReload = isHotReload();

  // Bắt đầu ghi nhịp tim (sau khi đã check)
  startHeartbeat();

  console.log('⏰ Khởi động Scheduler hẹn giờ đăng bài theo Khung Giờ Vàng (BullMQ)...');

  if (hotReload) {
    // HOT RELOAD: Server vừa restart do sửa code → KHÔNG XÓA LỊCH
    // Các repeatable jobs vẫn còn nguyên trong Redis, Worker mới sẽ tự pick up
    console.log('🔥 [Hot Reload] Phát hiện server vừa restart nhanh (do sửa code). GIỮ NGUYÊN toàn bộ lịch đăng bài trong Redis!');
  } else {
    // COLD START: Server tắt lâu → Xóa sạch và tạo lịch mới
    console.log('❄️ [Cold Start] Phát hiện server khởi động lạnh. Đang dọn sạch lịch cũ và tạo mới...');
    try {
      await publishQueue.obliterate({ force: true });
      console.log('🧹 Đã obliterate toàn bộ queue (xóa kể cả active jobs cũ).');
    } catch (e) {
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

    // Đọc cấu hình settings.json
    let settings = {};
    try {
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
    } catch (e) {
      console.error('Không thể đọc settings.json.', e);
    }

    // Chỉ tạo lịch mới khi Cold Start
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
        isSchedulerRunning = false;
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

      // --- CƠ CHẾ CHẠY BÙ (CATCH-UP) --- Dùng Redis Cloud để đồng bộ giữa các máy
      try {
        const now = new Date();
        let lastRunTime = 0;
        
        // Đọc last_run từ Redis Cloud (đồng bộ giữa máy công ty & máy nhà)
        try {
          const redisLastRun = await redisConnection.get('last_run_timestamp');
          if (redisLastRun) lastRunTime = parseInt(redisLastRun, 10);
        } catch (redisErr) {
          // Fallback: đọc từ file local nếu Redis lỗi
          const lastRunPath = path.join(__dirname, '../config/last_run.json');
          if (fs.existsSync(lastRunPath)) {
            const lastRunData = JSON.parse(fs.readFileSync(lastRunPath, 'utf8'));
            lastRunTime = lastRunData.timestamp || 0;
          }
        }

        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        let missedSlots = [];

        for (const timeStr of timeSlots) {
          if (!timeStr || !timeStr.includes(':')) continue;
          const [hour, minute] = timeStr.split(':').map(Number);
          const slotMinutes = hour * 60 + minute;

          // Nếu khung giờ này đã qua trong NGÀY HÔM NAY
          if (slotMinutes <= currentMinutes) {
            const slotDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
            const slotTimestamp = slotDate.getTime();
            
            // Kiểm tra xem thời điểm chạy gần nhất có TRƯỚC khung giờ này không
            if (lastRunTime < (slotTimestamp - 120000)) {
              missedSlots.push({ time: timeStr, timestamp: slotTimestamp });
            }
          }
        }

        if (missedSlots.length > 0) {
          console.log(`⚡ Phát hiện bị lỡ ${missedSlots.length} khung giờ: ${missedSlots.map(s => s.time).join(', ')}. Đang kích hoạt chạy bù...`);
          // Chạy bù cho TỪNG khung giờ bị lỡ, cách nhau 30 giây
          for (let i = 0; i < missedSlots.length; i++) {
            await publishQueue.add('autoPublishJob', { catchUp: true, missedTime: missedSlots[i].time }, { delay: 10000 + (i * 30000) });
            console.log(`  📌 Đã lên lịch chạy bù cho khung ${missedSlots[i].time} (delay ${10 + i * 30}s)`);
          }
          
          // Cập nhật last_run lên Redis Cloud + file local (backup)
          const latestMissed = missedSlots[missedSlots.length - 1].timestamp;
          try {
            await redisConnection.set('last_run_timestamp', String(latestMissed));
          } catch (e) { /* ignore */ }
          const lastRunPath = path.join(__dirname, '../config/last_run.json');
          fs.writeFileSync(lastRunPath, JSON.stringify({ timestamp: latestMissed }), 'utf8');
        }
      } catch (e) {
        console.error('Lỗi khi kiểm tra catch-up chạy bù:', e);
      }
    }
  }

  // --- THÊM: Hẹn giờ quét Google Drive tự động lúc 2:00 sáng mỗi ngày ---
  // Hủy các cron job cũ nếu startScheduler được gọi lại
  if (global.driveCronJob) {
    global.driveCronJob.stop();
  }
  
  global.driveCronJob = cron.schedule('0 2 * * *', () => {
    console.log('⏰ Bắt đầu quét Google Drive tự động (Lịch định kỳ: 2:00 sáng)...');
    try {
      const scriptPath = path.join(__dirname, './scripts/scan_drive.js');
      const child = spawn('node', [scriptPath], {
        cwd: path.join(__dirname, '../')
      });
      child.stdout.on('data', data => console.log(`[Auto-Scan]: ${data.toString().trim()}`));
      child.stderr.on('data', data => console.error(`[Auto-Scan Error]: ${data.toString().trim()}`));
      child.on('close', code => console.log(`[Auto-Scan] Kết thúc với mã ${code}`));
    } catch (e) {
      console.error('Lỗi khi chạy quét Google Drive tự động:', e.message);
    }
  });
  console.log('✅ Đã lên lịch Auto-Scan Google Drive lúc 02:00 sáng mỗi ngày.');

  // --- THÊM: Hẹn giờ đồng bộ CRM định kỳ 5 phút ---
  if (!global.crmInterval) {
    global.crmInterval = setInterval(async () => {
      try {
        console.log('🔄 Đang đồng bộ CRM ngầm...');
        await syncAllCRM();
      } catch (e) {
        console.error('Lỗi khi đồng bộ CRM ngầm:', e.message);
      }
    }, 5 * 60 * 1000);
    console.log('✅ Đã khởi động luồng đồng bộ CRM ngầm mỗi 5 phút.');
  }

  isSchedulerRunning = false; // Reset để cho phép gọi lại khi user thay đổi settings
};
