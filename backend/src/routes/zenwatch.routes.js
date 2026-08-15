import express from 'express';
import { startZaloPost, stopZaloPost, getZaloStatus, getZaloConfig, saveZaloConfig, getZaloHistory, deleteZaloHistory, checkGeminiLogin } from '../controllers/zaloController.js';
import {
  completeZaloBridgeJob,
  createZaloBridgePairing,
  disconnectZaloBridge,
  enrollZaloBridgeDevice,
  getNextZaloBridgeJob,
  getZaloBridgeStatus,
  heartbeatZaloBridge,
  pairZaloBridge,
  requireLocalZaloBridge,
  resumeZaloBridge,
} from '../controllers/zaloBridgeController.js';

const router = express.Router();

// Zalo Tool Control
router.post('/zalo/start', startZaloPost);
router.post('/zalo/stop', stopZaloPost);
router.get('/zalo/status', getZaloStatus);

// Zalo Config CRUD
router.get('/zalo/config', getZaloConfig);
router.post('/zalo/config', saveZaloConfig);

// Zalo Post History
router.get('/zalo/history', getZaloHistory);
router.delete('/zalo/history/:id', deleteZaloHistory);

// Gemini login check
router.get('/zalo/check-gemini', checkGeminiLogin);

// Zalo Web tab bridge — chỉ cho phép extension trên chính máy này
router.use('/zalo/bridge', requireLocalZaloBridge);
router.get('/zalo/bridge/status', getZaloBridgeStatus);
router.post('/zalo/bridge/pairing-code', createZaloBridgePairing);
router.post('/zalo/bridge/pair', pairZaloBridge);
router.post('/zalo/bridge/device', enrollZaloBridgeDevice);
router.post('/zalo/bridge/resume', resumeZaloBridge);
router.post('/zalo/bridge/heartbeat', heartbeatZaloBridge);
router.get('/zalo/bridge/jobs/next', getNextZaloBridgeJob);
router.post('/zalo/bridge/jobs/:jobId/complete', completeZaloBridgeJob);
router.post('/zalo/bridge/disconnect', disconnectZaloBridge);

export default router;
