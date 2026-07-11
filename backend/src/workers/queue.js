import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const isSimulate = process.argv[1] && process.argv[1].includes('simulate_customers.js');

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  retryStrategy: isSimulate ? () => null : (times) => Math.min(times * 50, 2000)
});

connection.on('error', (err) => {
  if (!isSimulate) {
    console.error('❌ Lỗi kết nối Redis (Vui lòng đảm bảo Redis server đang chạy):', err.message);
  }
});

export { connection };
export const publishQueue = new Queue('publishQueue', { connection });
export const driveSyncQueue = new Queue('driveSyncQueue', { connection });

