import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

export const publishQueue = new Queue('publishQueue', { connection });
export const driveSyncQueue = new Queue('driveSyncQueue', { connection });
