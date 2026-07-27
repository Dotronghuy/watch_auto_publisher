import { publishQueue, connection as redisConnection } from './workers/queue.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { spawn } from 'child_process';
import { syncHashesFromSheets } from './services/image-hash.service.js';
import { runNightlySelfLearning } from './services/self-learning.service.js';
import { readLastSuccessfulRun } from './services/publish-run-state.service.js';
import {
  AUTO_PUBLISH_POLICY_REDIS_KEY,
  AUTO_PUBLISH_POLICY_VERSION,
  buildMissedSlotJobId,
  createAutoPublishJobOptions,
} from './workers/publish-job-policy.js';

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

const readSchedulerSettings = () => {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (error) {
    console.error('Không thể đọc settings.json.', error);
  }
  return {};
};

const getExpectedPublishPatterns = (settings) => {
  if (settings.mode === 'test') {
    const intervalMinutes = parseInt(settings.testInterval, 10) || 5;
    return [`*/${intervalMinutes} * * * *`];
  }

  return (settings.timeSlots || [])
    .filter((timeStr) => timeStr && timeStr.includes(':'))
    .map((timeStr) => {
      const [hour, minute] = timeStr.split(':').map(Number);
      return `${minute} ${hour} * * *`;
    });
};

const redisScheduleMatchesSettings = async (settings) => {
  const expectedPatterns = getExpectedPublishPatterns(settings).sort();
  const repeatableJobs = await publishQueue.getRepeatableJobs();
  const actualPatterns = repeatableJobs
    .filter((job) => job.name === 'autoPublishJob')
    .map((job) => job.pattern)
    .filter(Boolean)
    .sort();

  const patternsMatch = expectedPatterns.length === actualPatterns.length
    && expectedPatterns.every((pattern, index) => pattern === actualPatterns[index]);
  if (!patternsMatch) return false;

  // Ép lịch cũ được tạo lại một lần khi chính sách attempts/backoff thay đổi.
  const storedPolicyVersion = await redisConnection.get(
    AUTO_PUBLISH_POLICY_REDIS_KEY,
  );
  return storedPolicyVersion === AUTO_PUBLISH_POLICY_VERSION;
};

export const startScheduler = async (isSettingsUpdate = false) => {
  if (isSchedulerRunning) {
    console.log('⚠️ Scheduler đang chạy, bỏ qua lần gọi thứ 2.');
    return;
  }
  isSchedulerRunning = true;

  // === PHÂN BIỆT HOT RELOAD vs COLD START ===
  // QUAN TRỌNG: Phải check TRƯỚC khi ghi heartbeat mới
  const hotReload = isSettingsUpdate ? false : isHotReload();

  // Bắt đầu ghi nhịp tim (sau khi đã check)
  startHeartbeat();

  console.log('⏰ Khởi động Scheduler hẹn giờ đăng bài theo Khung Giờ Vàng (BullMQ)...');

  if (hotReload) {
    // HOT RELOAD: Server vừa restart do sửa code → KHÔNG XÓA LỊCH
    // Các repeatable jobs vẫn còn nguyên trong Redis, Worker mới sẽ tự pick up
    console.log('🔥 [Hot Reload] Phát hiện server vừa restart nhanh (do sửa code). GIỮ NGUYÊN toàn bộ lịch đăng bài trong Redis!');

    // Redis local có thể vừa khởi động mới hoặc mất dữ liệu trong lúc server restart.
    // Không được chỉ tin heartbeat: luôn đối chiếu cron thật trong Redis với settings.
    const settings = readSchedulerSettings();
    let scheduleIsValid = false;
    try {
      scheduleIsValid = await redisScheduleMatchesSettings(settings);
    } catch (error) {
      console.warn('⚠️ Không kiểm tra được lịch trong Redis:', error.message);
    }

    if (!scheduleIsValid) {
      console.log('🔧 [Tự sửa lịch] Redis đang trống hoặc sai khung giờ. Đang tạo lại lịch từ settings.json...');
      isSchedulerRunning = false;
      await startScheduler(true);
      return;
    }

    console.log('✅ [Hot Reload] Đã xác minh lịch trong Redis khớp settings.json.');
  } else {
    // COLD START or SETTINGS UPDATE: Xóa lịch cũ và tạo lịch mới
    if (isSettingsUpdate) {
      console.log('⚙️ [Settings Update] Đang cập nhật lịch đăng bài mới...');
      try {
        const repeatableJobs = await publishQueue.getRepeatableJobs();
        for (const job of repeatableJobs) {
          await publishQueue.removeRepeatableByKey(job.key);
        }
        console.log('🧹 Đã gỡ bỏ các lịch đăng bài cũ (giữ nguyên job đang chạy).');
      } catch (e) {
        console.log('⚠️ Lỗi khi gỡ lịch cũ:', e.message);
      }
    } else {
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
    }

    // Đọc cấu hình settings.json
    const settings = readSchedulerSettings();

    // Chỉ tạo lịch mới khi Cold Start
    if (settings.mode === 'test') {
      const intervalMinutes = parseInt(settings.testInterval) || 5;
      const cronPattern = `*/${intervalMinutes} * * * *`;
      await publishQueue.add('autoPublishJob', {}, createAutoPublishJobOptions({
        repeat: { pattern: cronPattern, tz: 'Asia/Ho_Chi_Minh' }
      }));
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

        await publishQueue.add('autoPublishJob', {}, createAutoPublishJobOptions({
          repeat: { pattern: cronPattern, tz: 'Asia/Ho_Chi_Minh' }
        }));
        console.log(`✅ Đã lên lịch đăng bài cho Khung giờ: ${timeStr} (Cron: ${cronPattern})`);
      }

      console.log(`✅ Đã lên lịch thành công tổng cộng ${timeSlots.length} khung giờ đăng bài mỗi ngày.`);

      // --- CƠ CHẾ CHẠY BÙ (CATCH-UP) --- Dùng Redis Cloud để đồng bộ giữa các máy
      try {
        const now = new Date();
        // Chỉ timestamp của một lần đăng THÀNH CÔNG mới được tính là last_run.
        const lastRunTime = await readLastSuccessfulRun(redisConnection);

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
            const missedSlot = missedSlots[i];
            await publishQueue.add(
              'autoPublishJob',
              {
                catchUp: true,
                missedTime: missedSlot.time,
                missedTimestamp: missedSlot.timestamp,
              },
              createAutoPublishJobOptions({
                delay: 10000 + (i * 30000),
                jobId: buildMissedSlotJobId(missedSlot.timestamp),
              }),
            );
            console.log(`  📌 Đã lên lịch chạy bù cho khung ${missedSlots[i].time} (delay ${10 + i * 30}s)`);
          }
        }
      } catch (e) {
        console.error('Lỗi khi kiểm tra catch-up chạy bù:', e);
      }
    }

    try {
      await redisConnection.set(
        AUTO_PUBLISH_POLICY_REDIS_KEY,
        AUTO_PUBLISH_POLICY_VERSION,
      );
    } catch (error) {
      console.warn('⚠️ Không lưu được phiên bản chính sách retry/backoff:', error.message);
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

  // --- THÊM: Hẹn giờ Tự học ban đêm (Self-Learning AI) tự động lúc 2:00 sáng ---
  if (global.learningCronJob) {
    global.learningCronJob.stop();
  }
  global.learningCronJob = cron.schedule('0 2 * * *', () => {
    console.log('⏰ Bắt đầu tiến trình Tự học ban đêm của AI (Lịch định kỳ: 2:00 sáng)...');
    const scriptPath = path.join(__dirname, './scripts/learn_from_chats.js');
    const child = spawn('node', [scriptPath], {
      cwd: path.join(__dirname, '../')
    });
    child.stdout.on('data', data => console.log(`[Self-Learning]: ${data.toString().trim()}`));
    child.stderr.on('data', data => console.error(`[Self-Learning Error]: ${data.toString().trim()}`));
    child.on('close', code => console.log(`[Self-Learning] Kết thúc với mã ${code}`));
  });
  console.log('✅ Đã lên lịch AI Tự học (Self-Learning) lúc 02:00 sáng mỗi ngày.');

  // --- THÊM: Hẹn giờ đồng bộ Lớp 2 Chatbot (Google Sheets Images) tự động lúc 3:00 sáng ---
  if (global.hashCronJob) {
    global.hashCronJob.stop();
  }
  global.hashCronJob = cron.schedule('0 3 * * *', () => {
    console.log('⏰ Bắt đầu đồng bộ ảnh Google Sheets cho Chatbot (Lịch định kỳ: 3:00 sáng)...');
    syncHashesFromSheets().catch(e => console.error('Lỗi syncHashesFromSheets:', e));
  });
  console.log('✅ Đã lên lịch Sync Ảnh Google Sheets lúc 03:00 sáng mỗi ngày.');

  isSchedulerRunning = false; // Reset để cho phép gọi lại khi user thay đổi settings
};
