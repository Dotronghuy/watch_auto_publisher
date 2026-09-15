import express from 'express';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMobileWorkerGateway } from '../mobileWorkerGateway.js';

const testDirectory = await mkdtemp(path.join(tmpdir(), 'zenwatch-mobile-worker-'));
process.env.MOBILE_WORKER_DATABASE_URL = `file:${path.join(testDirectory, 'test.db').replace(/\\/g, '/')}`;
const { mobileLinkPrisma: prisma } = await import('../services/mobileLinkJob.db.js');
const { default: mobileWorkerRouter } = await import('../routes/mobileWorker.routes.js');
const {
  claimNextMobileLinkJob,
  completeMobileLinkJob,
  enqueueMobileLinkJob,
  heartbeatMobileLinkJob,
  retryMobileLinkJob,
} = await import('../services/mobileLinkJob.service.js');
const token = 'codex-mobile-worker-test-token';
const deviceId = 'codex-test-device';
const postId = `codex_mobile_worker_test_${Date.now()}`;
const routePostId = `${postId}_route`;
const retryPostId = `${postId}_retry`;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const testQueue = async () => {
  const unrelatedJobs = await prisma.mobileLinkJob.count({
    where: {
      status: { in: ['PENDING', 'PROCESSING'] },
      postId: { not: { startsWith: 'codex_mobile_worker_test_' } },
    },
  });
  assert(unrelatedJobs === 0, 'refusing to test while real mobile jobs are active');

  const created = await enqueueMobileLinkJob({
    postId,
    postUrl: 'https://www.facebook.com/test/posts/1',
    shopeeUrl: 'https://vn.shp.ee/dEu9ZJKx',
    postText: 'Bài kiểm thử hàng đợi mobile worker',
    contentType: 'post',
  });
  const duplicate = await enqueueMobileLinkJob({
    postId,
    postUrl: 'https://www.facebook.com/test/posts/1',
    shopeeUrl: 'https://vn.shp.ee/dEu9ZJKx',
    postText: 'Bài kiểm thử hàng đợi mobile worker',
    contentType: 'post',
  });
  assert(duplicate.id === created.id, 'idempotent enqueue failed');
  const claimed = await claimNextMobileLinkJob({ deviceId });
  assert(claimed?.id === created.id, 'claim failed');
  assert(
    !(await heartbeatMobileLinkJob({
      jobId: claimed.id,
      deviceId,
      attempt: claimed.attempt + 1,
    })),
    'heartbeat accepted the wrong attempt',
  );
  assert(
    await heartbeatMobileLinkJob({
      jobId: claimed.id,
      deviceId,
      attempt: claimed.attempt,
    }),
    'heartbeat failed',
  );
  const completed = await completeMobileLinkJob({
    jobId: claimed.id,
    deviceId,
    attempt: claimed.attempt,
    status: 'SUCCEEDED',
    message: 'ok',
  });
  assert(completed?.status === 'SUCCEEDED', 'complete failed');
  const duplicateResult = await completeMobileLinkJob({
    jobId: claimed.id,
    deviceId,
    attempt: claimed.attempt,
    status: 'SUCCEEDED',
    message: 'duplicate ok',
  });
  assert(duplicateResult?.status === 'SUCCEEDED', 'idempotent result failed');
  const contradictoryResult = await completeMobileLinkJob({
    jobId: claimed.id,
    deviceId,
    attempt: claimed.attempt,
    status: 'FAILED',
    message: 'late contradictory result',
  });
  assert(contradictoryResult === null, 'contradictory terminal result was accepted');

  const retryCandidate = await enqueueMobileLinkJob({
    postId: retryPostId,
    postUrl: 'https://www.facebook.com/test/posts/3',
    shopeeUrl: 'https://vn.shp.ee/retry-test',
    postText: 'Bài kiểm thử retry mobile worker an toàn',
    contentType: 'post',
  });
  const firstAttempt = await claimNextMobileLinkJob({ deviceId });
  assert(firstAttempt?.id === retryCandidate.id, 'retry candidate claim failed');
  const failed = await completeMobileLinkJob({
    jobId: firstAttempt.id,
    deviceId,
    attempt: firstAttempt.attempt,
    status: 'FAILED',
    message: 'expected test failure',
  });
  assert(failed?.status === 'FAILED', 'failed result was not persisted');

  let enqueueFailure = null;
  try {
    await enqueueMobileLinkJob({
      postId: retryPostId,
      postUrl: retryCandidate.postUrl,
      shopeeUrl: retryCandidate.shopeeUrl,
      postText: retryCandidate.postText,
      contentType: retryCandidate.contentType,
    });
  } catch (error) {
    enqueueFailure = error;
  }
  assert(
    enqueueFailure?.code === 'MOBILE_LINK_JOB_RETRY_REQUIRED',
    'ordinary enqueue silently retried a failed job',
  );

  const retried = await retryMobileLinkJob(retryCandidate.id);
  assert(retried?.status === 'PENDING', 'explicit retry did not return the job to pending');
  const secondAttempt = await claimNextMobileLinkJob({ deviceId });
  assert(secondAttempt?.id === retryCandidate.id, 'retried job was not claimed');
  assert(
    secondAttempt.attempt === firstAttempt.attempt + 1,
    'retry did not create a new fenced attempt',
  );
  assert(
    !(await heartbeatMobileLinkJob({
      jobId: secondAttempt.id,
      deviceId,
      attempt: firstAttempt.attempt,
    })),
    'old attempt heartbeat was accepted after retry',
  );
  const retryCompleted = await completeMobileLinkJob({
    jobId: secondAttempt.id,
    deviceId,
    attempt: secondAttempt.attempt,
    status: 'SUCCEEDED',
    message: 'retry ok',
  });
  assert(retryCompleted?.status === 'SUCCEEDED', 'retried attempt did not complete');
};

const testLegacyReelDestination = async () => {
  const legacy = await prisma.mobileLinkJob.create({ data: {
    postId: '101_8001',
    postUrl: 'https://www.facebook.com/reel/8001',
    shopeeUrl: 'https://shopee.vn/product/1/9',
    postText: '',
    contentType: 'reel',
  } });
  const claimed = await claimNextMobileLinkJob({ deviceId });
  assert(claimed?.id === legacy.id, 'exact legacy Reel was quarantined');
  assert(claimed.postUrl === legacy.postUrl, 'claim rewrote an exact legacy Reel URL');
  const reclaimed = await claimNextMobileLinkJob({ deviceId });
  assert(reclaimed?.id === legacy.id && reclaimed.postUrl === legacy.postUrl
    && reclaimed.attempt === claimed.attempt, 'redelivery changed an active Reel payload');
  await completeMobileLinkJob({
    jobId: claimed.id, deviceId, attempt: claimed.attempt,
    status: 'SUCCEEDED', message: 'legacy route compatibility ok',
  });
};

const testOptionalCaptionJobs = async () => {
  let objectId = 901;
  for (const contentType of ['post', 'reel']) {
    for (const postText of [undefined, null, '', ' \n\t ']) {
      objectId += 1;
      const payload = {
        postId: `101_${objectId}`,
        postUrl: contentType === 'post'
          ? `https://www.facebook.com/101/posts/${objectId}`
          : `https://www.facebook.com/reel/${objectId}`,
        shopeeUrl: 'https://shopee.vn/product/1/9',
        contentType,
        ...(postText === undefined ? {} : { postText }),
      };
      const created = await enqueueMobileLinkJob(payload);
      assert(created.postText === '', 'optional caption was not normalized');
      const first = await claimNextMobileLinkJob({ deviceId: 'caption-optional-device' });
      assert(first?.id === created.id, 'missing/blank caption prevented claiming a direct URL');

      let conflict = null;
      try { await enqueueMobileLinkJob({ ...payload, postText: 'Changed optional metadata' }); }
      catch (error) { conflict = error; }
      assert(conflict?.code === 'MOBILE_LINK_JOB_PAYLOAD_CONFLICT',
        'optional caption change bypassed claimed payload immutability');
      assert(!(await heartbeatMobileLinkJob({
        jobId: first.id, deviceId: 'wrong-device', attempt: first.attempt,
      })), 'captionless job lost device ownership protection');

      await completeMobileLinkJob({
        jobId: first.id, deviceId: first.deviceId, attempt: first.attempt,
        status: 'FAILED', message: 'expected optional-caption retry test',
      });
      const retried = await retryMobileLinkJob(first.id);
      assert(retried?.status === 'PENDING' && retried.postText === '',
        'missing/blank caption prevented explicit retry');
      const second = await claimNextMobileLinkJob({ deviceId: 'caption-optional-device' });
      assert(second?.id === first.id && second.attempt === first.attempt + 1,
        'captionless retry did not create a fenced attempt');
      await completeMobileLinkJob({
        jobId: second.id, deviceId: second.deviceId, attempt: second.attempt,
        status: 'SUCCEEDED', message: 'optional caption is supported',
      });
    }
  }
  // Legacy nullable database rows must remain runnable without a metadata repair.
  const legacy = await prisma.mobileLinkJob.create({ data: {
    postId: '101_999',
    postUrl: 'https://www.facebook.com/101/posts/999',
    shopeeUrl: 'https://shopee.vn/product/1/9',
    postText: null,
    contentType: 'post',
  } });
  const claimed = await claimNextMobileLinkJob({ deviceId: 'caption-legacy-device' });
  assert(claimed?.id === legacy.id, 'legacy null caption was quarantined');
  const repeated = await claimNextMobileLinkJob({ deviceId: 'caption-legacy-device' });
  assert(repeated?.id === claimed.id && repeated.attempt === claimed.attempt,
    'legacy null caption prevented active job recovery');
  await completeMobileLinkJob({
    jobId: claimed.id, deviceId: claimed.deviceId, attempt: claimed.attempt,
    status: 'FAILED', message: 'expected legacy retry test',
  });
  const retried = await retryMobileLinkJob(legacy.id);
  assert(retried?.status === 'PENDING' && retried.postText === '',
    'legacy null caption prevented retry without repair');
  const finalAttempt = await claimNextMobileLinkJob({ deviceId: 'caption-legacy-device' });
  await completeMobileLinkJob({
    jobId: finalAttempt.id, deviceId: finalAttempt.deviceId, attempt: finalAttempt.attempt,
    status: 'SUCCEEDED', message: 'legacy optional caption completed',
  });
  console.log('mobile-worker optional captions: post/video enqueue, claim, retry, legacy null, immutable payload and ownership OK');
};

const testRecovery = async () => {
  const legacy = await prisma.mobileLinkJob.create({ data: {
    postId: `${postId}_legacy`,
    postUrl: 'https://www.facebook.com/test/posts/4',
    shopeeUrl: 'https://shopee.vn/product/1/4',
    postText: null,
    contentType: 'video',
  } });
  const payload = {
    postId: `${postId}_recovery`,
    postUrl: 'https://www.facebook.com/test/posts/5',
    shopeeUrl: 'https://shopee.vn/product/1/5',
    postText: 'Bài kiểm thử phục hồi kết nối đúng lượt xử lý',
    contentType: 'post',
  };
  const queued = await enqueueMobileLinkJob(payload);
  const first = await claimNextMobileLinkJob({ deviceId: 'recovery-one' });
  assert(first?.id === queued.id, 'invalid legacy job blocked the valid queue');
  assert((await prisma.mobileLinkJob.findUnique({ where: { id: legacy.id } })).status === 'FAILED',
    'invalid legacy job was not quarantined');
  const repeated = await claimNextMobileLinkJob({ deviceId: 'recovery-one' });
  assert(repeated.id === first.id && repeated.attempt === first.attempt,
    'lost claim response caused a duplicate attempt');

  let conflict = null;
  try { await enqueueMobileLinkJob({ ...payload, shopeeUrl: 'https://shopee.vn/product/2/9' }); }
  catch (error) { conflict = error; }
  assert(conflict?.code === 'MOBILE_LINK_JOB_PAYLOAD_CONFLICT',
    'processing payload was changed while Android was using it');

  await prisma.mobileLinkJob.update({
    where: { id: first.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) },
  });
  const second = await claimNextMobileLinkJob({ deviceId: 'recovery-two' });
  assert(second.id === first.id && second.attempt === first.attempt + 1,
    'expired lease did not create a new attempt');
  assert(!(await heartbeatMobileLinkJob({ jobId: first.id, deviceId: 'recovery-one', attempt: first.attempt })),
    'expired device retained ownership');
  assert(await completeMobileLinkJob({ jobId: first.id, deviceId: 'recovery-one', attempt: first.attempt,
    status: 'SUCCEEDED', message: 'stale success' }) === null, 'stale success overwrote the current attempt');
  await completeMobileLinkJob({ jobId: second.id, deviceId: 'recovery-two', attempt: second.attempt,
    status: 'SUCCEEDED', message: 'recovered' });
  console.log('mobile-worker recovery: legacy queue, lost claim response, expired lease, stale result OK');
};

const testConcurrentClaims = async () => {
  for (const suffix of ['one', 'two']) {
    await enqueueMobileLinkJob({
      postId: `${postId}_concurrent_${suffix}`,
      postUrl: 'https://www.facebook.com/test/posts/6',
      shopeeUrl: 'https://shopee.vn/product/1/6',
      postText: 'Bài kiểm thử hai điện thoại nhận tác vụ đồng thời',
      contentType: 'post',
    });
  }
  const claims = await Promise.all(['concurrent-one', 'concurrent-two'].map((deviceId) =>
    claimNextMobileLinkJob({ deviceId })));
  assert(claims.every(Boolean), 'concurrent claim unexpectedly lost an available job');
  assert(new Set(claims.map((job) => job.id)).size === 2, 'two devices claimed the same job');
  for (const job of claims) {
    await completeMobileLinkJob({ jobId: job.id, deviceId: job.deviceId, attempt: job.attempt,
      status: 'SUCCEEDED', message: 'concurrent claim ok' });
  }
  console.log('mobile-worker concurrent claims: OK');
};

const testRoute = async () => {
  process.env.MOBILE_WORKER_TOKEN = token;
  const app = express();
  app.use(express.json());
  app.use('/api/mobile-worker', mobileWorkerRouter);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const gateway = createMobileWorkerGateway({ token, targetPort: server.address().port });
  await new Promise((resolve, reject) => {
    gateway.once('error', reject);
    gateway.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = gateway.address();
    const baseUrl = `http://127.0.0.1:${port}/api/mobile-worker`;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(response.status === 200, `health returned ${response.status}`);
    const body = await response.json();
    assert(body.ok === true, 'health payload is not ok');

    const queued = await enqueueMobileLinkJob({
      postId: routePostId,
      postUrl: 'https://www.facebook.com/test/posts/2',
      shopeeUrl: 'https://shopee.vn/product/1/3',
      contentType: 'post',
    });
    const routeDeviceId = 'codex-route-device';
    const nextResponse = await fetch(
      `${baseUrl}/jobs/next?deviceId=${encodeURIComponent(routeDeviceId)}`,
      { headers },
    );
    assert(nextResponse.status === 200, `next returned ${nextResponse.status}`);
    const nextBody = await nextResponse.json();
    assert(nextBody.job?.id === queued.id, 'route claimed the wrong job');
    assert(nextBody.job.postText === '', 'route rejected or changed an absent optional caption');
    assert(nextBody.job.postText === queued.postText && nextBody.job.shopeeUrl === queued.shopeeUrl &&
      nextBody.job.contentType === queued.contentType, 'gateway changed the immutable job payload');
    const attempt = nextBody.job?.attempt;
    assert(Number.isInteger(attempt) && attempt > 0, 'route did not return a valid attempt');

    const missingAttemptResponse = await fetch(`${baseUrl}/jobs/${queued.id}/heartbeat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceId: routeDeviceId }),
    });
    assert(missingAttemptResponse.status === 400, 'route accepted a heartbeat without attempt');

    const wrongAttemptResponse = await fetch(`${baseUrl}/jobs/${queued.id}/heartbeat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceId: routeDeviceId, attempt: attempt + 1 }),
    });
    assert(wrongAttemptResponse.status === 409, 'route accepted the wrong attempt');

    const heartbeatResponse = await fetch(`${baseUrl}/jobs/${queued.id}/heartbeat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceId: routeDeviceId, attempt }),
    });
    assert(heartbeatResponse.status === 200, 'route heartbeat failed');

    const resultResponse = await fetch(`${baseUrl}/jobs/${queued.id}/result`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        deviceId: routeDeviceId,
        attempt,
        status: 'SUCCEEDED',
        message: 'route ok',
      }),
    });
    assert(resultResponse.status === 200, 'route result failed');
  } finally {
    await new Promise((resolve) => gateway.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
};

try {
  for (const migration of [
    '../../prisma/migrations/20260724102500_add_mobile_link_jobs/migration.sql',
    '../../prisma/migrations/20260825050000_add_mobile_link_job_context/migration.sql',
  ]) {
    const sql = await readFile(new URL(migration, import.meta.url), 'utf8');
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }
  await testQueue();
  await testLegacyReelDestination();
  await testOptionalCaptionJobs();
  await testRecovery();
  await testConcurrentClaims();
  await testRoute();
  console.log('mobile-worker backend integration: OK');
} finally {
  await prisma.$disconnect();
  await rm(testDirectory, { recursive: true, force: true });
}
