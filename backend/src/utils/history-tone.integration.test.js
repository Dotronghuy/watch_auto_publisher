import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-tone-history-'));
process.env.POSTED_HISTORY_DB_FILE = path.join(tempDir, 'history.db');

const history = await import('./history.js');

try {
  await history.addPostMetric('facebook', 'test-post-1', 'SKU-TEST', 'Caption test', {
    toneId: 'TONE-05',
    toneName: 'Thực Dụng Sang Trọng',
    perspectiveId: 'PERSPECTIVE-02',
    perspective: 'Góc nhìn chuyên gia',
    ctaId: 'CTA-01',
    cta: 'Gửi ảnh cổ tay.',
    promptVersion: 'tone-engine-v2.0',
    accountId: 'account-test'
  });
  await history.updatePostMetrics('test-post-1', 10, 2, 1);

  const recent = await history.getRecentContentSelections(5, 'account-test');
  assert.equal(recent.length, 1);
  assert.equal(recent[0].tone_id, 'TONE-05');

  const performance = await history.getTonePerformance(30, 'account-test');
  assert.equal(performance.length, 1);
  assert.equal(performance[0].posts, 1);
  assert.equal(performance[0].score, 17);
  assert.equal(performance[0].averageScore, 17);

  console.log('✅ Tone history integration tests passed');
} finally {
  await history.closeHistoryDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
