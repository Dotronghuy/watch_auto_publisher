import 'dotenv/config';
import { Worker } from 'bullmq';
import { autoPublishRoutine, resetGlobalStop } from '../services/publish.service.js';
import {
  hasSuccessfulPublishResult,
  markLastSuccessfulRun,
} from '../services/publish-run-state.service.js';
import { connection, publishQueue } from './queue.js';
import { buildRecoveryJob } from './publish-job-policy.js';

export const worker = new Worker('publishQueue', async job => {
  if (job.name === 'autoPublishJob') {
    console.log(`[Worker] Bắt đầu xử lý Job Đăng bài tự động (ID: ${job.id})`);
    resetGlobalStop();
    const result = await autoPublishRoutine();

    if (!hasSuccessfulPublishResult(result)) {
      throw new Error('Job kết thúc nhưng không có nền tảng nào xác nhận đăng thành công.');
    }

    try {
      const state = await markLastSuccessfulRun(connection);
      const warnings = state.warnings.length > 0
        ? ` Cảnh báo: ${state.warnings.join('; ')}`
        : '';
      console.log(`[Worker] Đã cập nhật last_run sau khi đăng thành công.${warnings}`);
    } catch (stateError) {
      // Không retry một bài đã đăng thành công chỉ vì lỗi lưu timestamp,
      // nếu không có thể tạo bài trùng trên nền tảng.
      console.error(`[Worker] Bài đã đăng nhưng không thể cập nhật last_run: ${stateError.message}`);
    }

    return result;
  }
}, { 
  connection,
  lockDuration: 600000 // 10 minutes (600,000 ms)
});

worker.on('completed', job => {
  console.log(`[Worker] Job ${job.id} đã hoàn thành thành công!`);
});

worker.on('failed', async (job, err) => {
  console.log(`[Worker] Job ${job?.id || 'không xác định'} thất bại: ${err.message}`);

  const recoveryJob = buildRecoveryJob(job, err);
  if (!recoveryJob) return;

  try {
    const queuedJob = await publishQueue.add(
      recoveryJob.name,
      recoveryJob.data,
      recoveryJob.options,
    );
    console.log(
      `[Worker] Đã tạo job bù ${queuedJob.id} sau khi job ${job.id} hết số lần thử.`,
    );
  } catch (queueError) {
    console.error(`[Worker] Không tạo được job bù cho ${job.id}: ${queueError.message}`);
  }
});
