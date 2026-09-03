import express from 'express';
import { PrismaClient } from '@prisma/client';
import mobileWorkerRouter from '../routes/mobileWorker.routes.js';
import {
  claimNextMobileLinkJob,
  completeMobileLinkJob,
  enqueueMobileLinkJob,
  heartbeatMobileLinkJob,
  retryMobileLinkJob,
} from '../services/mobileLinkJob.service.js';

const prisma = new PrismaClient();
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

const testRoute = async () => {
  process.env.MOBILE_WORKER_TOKEN = token;
  const app = express();
  app.use(express.json());
  app.use('/api/mobile-worker', mobileWorkerRouter);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const { port } = server.address();
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
      postText: 'Bài kiểm thử route mobile worker',
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
    await new Promise((resolve) => server.close(resolve));
  }
};

try {
  await testQueue();
  await testRoute();
  console.log('mobile-worker backend integration: OK');
} finally {
  await prisma.mobileLinkJob.deleteMany({
    where: { postId: { in: [postId, routePostId, retryPostId] } },
  });
  await prisma.$disconnect();
}
