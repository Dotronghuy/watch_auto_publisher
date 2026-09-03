import crypto from 'crypto';
import express from 'express';
import { verifyToken, requireAdmin } from '../middleware/auth.middleware.js';
import {
  claimNextMobileLinkJob,
  completeMobileLinkJob,
  getMobileLinkJob,
  getMobileLinkQueueStats,
  heartbeatMobileLinkJob,
  listMobileLinkJobs,
  retryMobileLinkJob,
} from '../services/mobileLinkJob.service.js';

const router = express.Router();

const positiveAttempt = (value) => {
  const attempt = Number(value);
  return Number.isInteger(attempt) && attempt > 0 ? attempt : null;
};

const knownJobErrorStatus = (error) => {
  if (error?.code === 'MOBILE_LINK_JOB_VALIDATION') return 400;
  if (
    error?.code === 'MOBILE_LINK_JOB_PAYLOAD_CONFLICT'
    || error?.code === 'MOBILE_LINK_JOB_RETRY_REQUIRED'
  ) return 409;
  return null;
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
    res.json({ job });
  } catch (error) {
    next(error);
  }
});

router.post('/jobs/:jobId/heartbeat', verifyWorkerToken, async (req, res, next) => {
  try {
    const deviceId = String(req.body?.deviceId || '').trim();
    const attempt = positiveAttempt(req.body?.attempt);
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
    if (!attempt) return res.status(400).json({ error: 'attempt must be a positive integer' });

    const updated = await heartbeatMobileLinkJob({
      jobId: req.params.jobId,
      deviceId,
      attempt,
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
    const attempt = positiveAttempt(req.body?.attempt);
    const status = String(req.body?.status || '').trim().toUpperCase();
    const message = String(req.body?.message || '').trim();

    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
    if (!attempt) return res.status(400).json({ error: 'attempt must be a positive integer' });
    if (!['SUCCEEDED', 'FAILED'].includes(status)) {
      return res.status(400).json({ error: 'status must be SUCCEEDED or FAILED' });
    }

    const job = await completeMobileLinkJob({
      jobId: req.params.jobId,
      deviceId,
      attempt,
      status,
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
    const existing = await getMobileLinkJob(req.params.jobId);
    if (!existing) return res.status(404).json({ error: 'Mobile link job not found' });
    const job = await retryMobileLinkJob(req.params.jobId, req.body || {});
    if (!job) {
      return res.status(409).json({
        error: `Only FAILED jobs can be retried; current status is ${existing.status}`,
      });
    }
    res.json({ ok: true, job });
  } catch (error) {
    const status = knownJobErrorStatus(error);
    if (status) return res.status(status).json({ error: error.message });
    next(error);
  }
});

export default router;
