// BullMQ của ứng dụng luôn dùng Redis chạy trên máy này.
// REDIS_URL (Upstash cũ) được giữ trong .env để dự phòng nhưng không còn được dùng.
export const localRedisUrl = process.env.LOCAL_REDIS_URL?.trim()
  || 'redis://127.0.0.1:6379';
