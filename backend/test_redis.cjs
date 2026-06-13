const IORedis = require('ioredis');

const url = 'rediss://default:gQAAAAAAAQIYAAIgcDFkMzMwZTljNzdiNzI0NGRiOGQwMDAzODNmOTZjMTY0Yw@desired-squid-66072.upstash.io:6379';

console.log('🔌 Đang kết nối tới Upstash Redis Cloud...');

const redis = new IORedis(url, { maxRetriesPerRequest: null });

redis.on('connect', () => {
  console.log('✅ Kết nối Upstash Redis thành công!');
});

redis.on('error', (err) => {
  console.log('❌ Lỗi kết nối:', err.message);
});

async function test() {
  try {
    // Test ghi
    await redis.set('test_key', 'Hello from watch_auto_publisher!');
    console.log('✅ Ghi dữ liệu thành công');

    // Test đọc
    const value = await redis.get('test_key');
    console.log('✅ Đọc dữ liệu thành công:', value);

    // Test ping
    const pong = await redis.ping();
    console.log('✅ Ping:', pong);

    // Xóa test key
    await redis.del('test_key');
    console.log('✅ Dọn dẹp xong');

    console.log('\n🎉 Upstash Redis Cloud hoạt động hoàn hảo! Bạn có thể tắt redis-server local.');
  } catch (err) {
    console.log('❌ Lỗi:', err.message);
  } finally {
    redis.disconnect();
  }
}

test();
