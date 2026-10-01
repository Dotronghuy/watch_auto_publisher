import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Dùng DB tạm để không đụng vào posted_history.db đang chạy thật.
const tmpDb = path.join(os.tmpdir(), `history-eff-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.POSTED_HISTORY_DB_FILE = tmpDb;

const history = await import('./history.js');

test.after(async () => {
  await history.closeHistoryDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDb + suffix); } catch (e) {}
  }
});

test('getSkuPerformance xếp hạng SKU theo điểm tương tác có trọng số', async () => {
  await history.addPostMetric('facebook', 'p-sku-a-1', 'SKU-A', 'caption', {});
  await history.addPostMetric('instagram', 'p-sku-b-1', 'SKU-B', 'caption', {});
  await history.addPostMetric('facebook', 'p-sku-a-2', 'SKU-A', 'caption', {});
  await history.updatePostMetrics('p-sku-a-1', 10, 2, 1); // 10 + 4 + 3 = 17
  await history.updatePostMetrics('p-sku-b-1', 20, 0, 0); // 20
  await history.updatePostMetrics('p-sku-a-2', 0, 1, 0);  // 2

  const rows = await history.getSkuPerformance(30);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sku, 'SKU-B');
  assert.equal(rows[1].sku, 'SKU-A');
  assert.equal(rows[0].score, 20);
  assert.equal(rows[1].score, 19);
  assert.equal(rows[1].posts, 2);
  assert.equal(rows[1].averageScore, 9.5);
});

test('getHourPerformance gộp tương tác theo giờ địa phương', async () => {
  const rows = await history.getHourPerformance(30);
  assert.equal(rows.length, 24);
  const bucket = rows[new Date().getHours()];
  assert.equal(bucket.posts, 3);
  assert.equal(bucket.likes, 30);
  assert.equal(bucket.comments, 3);
  assert.equal(bucket.shares, 1);
  assert.equal(bucket.score, 39);
  assert.equal(rows.filter(r => r.posts > 0).length, 1);
});

test('getSkuPerformance/getHourPerformance clamp số ngày về [1, 365]', async () => {
  const skus = await history.getSkuPerformance(9999);
  assert.ok(Array.isArray(skus));
  assert.ok(skus.length >= 1);
  const hours = await history.getHourPerformance(0);
  assert.equal(hours.length, 24);
});
