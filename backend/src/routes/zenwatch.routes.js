import express from 'express';
import { startZaloPost, stopZaloPost, getZaloStatus, getZaloConfig, saveZaloConfig, getZaloHistory, deleteZaloHistory, checkGeminiLogin } from '../controllers/zaloController.js';

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

export default router;
