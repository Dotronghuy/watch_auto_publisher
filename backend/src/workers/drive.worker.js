import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { localRedisUrl } from '../config/redis.config.js';

const connection = new IORedis(localRedisUrl);

const worker = new Worker('driveSyncQueue', async job => {
  console.log(`Processing drive sync job: ${job.id}`);
  // Logic to sync drive
}, { connection });

worker.on('completed', job => {
  console.log(`${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`${job.id} has failed with ${err.message}`);
});
