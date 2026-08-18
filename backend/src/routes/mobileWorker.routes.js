import crypto from 'crypto';
import express from 'express';
import { verifyToken, requireAdmin } from '../middleware/auth.middleware.js';
import {
  claimNextMobileLinkJob,
  completeMobileLinkJob,
  getMobileLinkQueueStats,
  heartbeatMobileLinkJob,
  listMobileLinkJobs,
  retryMobileLinkJob,
} from '../services/mobileLinkJob.service.js';
import { getPostMetricById } from '../utils/history.js';

const router = express.Router();

export const mobileJobContentType = (job, metric) => {
  const platform = String(metric?.platform || '').trim().toLowerCase();
  if (platform.includes('reel')) return 'reel';
  return /\/(?:reel|reels|videos|watch)\/|watch\?v=|video\.php|fb\.watch\//i.test(
    String(job?.postUrl || ''),
  ) ? 'reel' : 'post';
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const verifyWorkerToken = (req, res, next) => {
  const expected = String(process.env.MOBILE_WORKER_TOKEN || '').trim();
  if (!expected) {
    return res.status(503).json({
      error: 'MOBILE_WORKER_TOKEN is not configured on the server',
    });
  }

  const authorization = String(req.headers.authorization || '');
  const supplied = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : String(req.headers['x-mobile-worker-token'] || '').trim();

  if (!safeEqual(expected, supplied)) {
    return res.status(401).json({ error: 'Invalid mobile worker token' });
  }
  next();
};

router.get('/health', verifyWorkerToken, async (req, res, next) => {
  try {
    res.json({
      ok: true,
      serverTime: new Date().toISOString(),
      queue: await getMobileLinkQueueStats(),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/jobs/next', verifyWorkerToken, async (req, res, next) => {
  try {
    const deviceId = String(req.query.deviceId || '').trim();
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

    const job = await claimNextMobileLinkJob({ deviceId });
    if (!job) return res.status(204).end();
    const metric = await getPostMetricById(job.postId);
    res.json({
      job: {
        ...job,
        postText: String(metric?.content || ''),
        contentType: mobileJobContentType(job, metric),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/jobs/:jobId/heartbeat', verifyWorkerToken, async (req, res, next) => {
  try {
    const deviceId = String(req.body?.deviceId || '').trim();
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

    const updated = await heartbeatMobileLinkJob({
      jobId: req.params.jobId,
      deviceId,
    });
    if (!updated) return res.status(409).json({ error: 'Job is not owned by this device' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/jobs/:jobId/result', verifyWorkerToken, async (req, res, next) => {
  try {
    const deviceId = String(req.body?.deviceId || '').trim();
    const status = String(req.body?.status || '').trim().toUpperCase();
    const message = String(req.body?.message || '').trim();

    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
    if (!['SUCCEEDED', 'FAILED'].includes(status)) {
      return res.status(400).json({ error: 'status must be SUCCEEDED or FAILED' });
    }

    const job = await completeMobileLinkJob({
      jobId: req.params.jobId,
      deviceId,
      success: status === 'SUCCEEDED',
      message,
    });
    if (!job) return res.status(409).json({ error: 'Job is not active for this device' });
    res.json({ ok: true, job });
  } catch (error) {
    next(error);
  }
});

router.get('/jobs', verifyToken, requireAdmin, async (req, res, next) => {
  try {
    res.json({ jobs: await listMobileLinkJobs(req.query.limit) });
  } catch (error) {
    next(error);
  }
});

router.post('/jobs/:jobId/retry', verifyToken, requireAdmin, async (req, res, next) => {
  try {
    res.json({ ok: true, job: await retryMobileLinkJob(req.params.jobId) });
  } catch (error) {
    next(error);
  }
});

export default router;
