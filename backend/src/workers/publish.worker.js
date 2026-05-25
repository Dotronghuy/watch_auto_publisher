import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { autoPublishRoutine } from '../services/publish.service.js';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

export const worker = new Worker('publishQueue', async job => {
  if (job.name === 'autoPublishJob') {
    console.log(`[Worker] Bắt đầu xử lý Job Đăng bài tự động (ID: ${job.id})`);
    await autoPublishRoutine();
  }
}, { connection });

worker.on('completed', job => {
  console.log(`[Worker] Job ${job.id} đã hoàn thành thành công!`);
});

worker.on('failed', (job, err) => {
  console.log(`[Worker] Job ${job.id} thất bại: ${err.message}`);
});
