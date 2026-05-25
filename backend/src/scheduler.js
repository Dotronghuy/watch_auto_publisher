import { publishQueue } from './workers/queue.js';

export const startScheduler = async () => {
  console.log('⏰ Khởi động Scheduler hẹn giờ đăng bài (BullMQ)...');

  // Xóa các job cũ nếu có để tránh trùng lặp
  const repeatableJobs = await publishQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await publishQueue.removeRepeatableByKey(job.key);
  }

  // Lên lịch Job chạy tự động
  await publishQueue.add('autoPublishJob', {}, {
    repeat: { pattern: '* * * * *' } // Mỗi 1 phút (Để test)
  });

  console.log('✅ Đã lên lịch tự động đăng bài qua BullMQ: Mỗi 1 phút 1 bài (Chế độ test).');
};
