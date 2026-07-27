import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { localRedisUrl } from '../config/redis.config.js';
import { createAutoPublishJobOptions } from './publish-job-policy.js';

const isSimulate = process.argv[1] && process.argv[1].includes('simulate_customers.js');

const connection = new IORedis(localRedisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy: isSimulate ? () => null : (times) => Math.min(times * 50, 2000)
});

connection.on('error', (err) => {
  if (!isSimulate) {
    console.error('❌ Lỗi kết nối Redis (Vui lòng đảm bảo Redis server đang chạy):', err.message);
  }
});

connection.on('ready', () => {
  if (!isSimulate) console.log('✅ Đã kết nối Redis local tại 127.0.0.1:6379.');
});

export { connection };
export const publishQueue = new Queue('publishQueue', {
  connection,
  defaultJobOptions: createAutoPublishJobOptions(),
});
export const driveSyncQueue = new Queue('driveSyncQueue', { connection });
