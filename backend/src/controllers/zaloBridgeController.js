import {
  authenticateZaloBridgeToken,
  completeZaloTabJob,
  createZaloBridgePairingCode,
  disconnectZaloTabBridge,
  enrollZaloBridgeDevice as enrollZaloBridgeDeviceService,
  getZaloTabBridgeStatus,
  isLoopbackAddress,
  pairZaloTabBridge,
  resumeZaloTabBridge,
  touchZaloTabBridge,
  waitForNextZaloTabJob,
} from '../services/zalo-tab-bridge.service.js';

function getBearerToken(req) {
  const authorization = String(req.get('authorization') || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function sendBridgeError(res, error) {
  const status = Number(error?.status) || 500;
  res.status(status).json({
    error: error?.message || 'Zalo Bridge error',
    code: error?.code || 'BRIDGE_ERROR',
  });
}

export function requireLocalZaloBridge(req, res, next) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return res.status(403).json({
      error: 'Zalo Tab Bridge chỉ chấp nhận kết nối từ máy tính này.',
      code: 'LOOPBACK_ONLY',
    });
  }
  next();
}

export function getZaloBridgeStatus(req, res) {
  res.json(getZaloTabBridgeStatus());
}

export function createZaloBridgePairing(req, res) {
  res.json(createZaloBridgePairingCode());
}

export function pairZaloBridge(req, res) {
  try {
    const result = pairZaloTabBridge(req.body || {});
    res.json(result);
  } catch (error) {
    sendBridgeError(res, error);
  }
}

export function enrollZaloBridgeDevice(req, res) {
  try {
    res.json(enrollZaloBridgeDeviceService(getBearerToken(req)));
  } catch (error) {
    sendBridgeError(res, error);
  }
}

export function resumeZaloBridge(req, res) {
  try {
    res.json(resumeZaloTabBridge(req.body || {}));
  } catch (error) {
    sendBridgeError(res, error);
  }
}

export async function getNextZaloBridgeJob(req, res) {
  const abortController = new AbortController();
  const abortIfDisconnected = () => {
    if (!res.writableEnded) abortController.abort();
  };
  req.once('aborted', abortIfDisconnected);
  res.once('close', abortIfDisconnected);

  try {
    const token = getBearerToken(req);
    authenticateZaloBridgeToken(token);
    const job = await waitForNextZaloTabJob(token, {
      waitMs: req.query.waitMs,
      signal: abortController.signal,
    });
    if (res.writableEnded || res.destroyed) return;
    if (!job) return res.status(204).end();
    res.json({ job });
  } catch (error) {
    if (abortController.signal.aborted || res.headersSent) return;
    sendBridgeError(res, error);
  } finally {
    req.removeListener('aborted', abortIfDisconnected);
    res.removeListener('close', abortIfDisconnected);
  }
}

export function completeZaloBridgeJob(req, res) {
  try {
    const token = getBearerToken(req);
    const result = completeZaloTabJob(token, req.params.jobId, req.body || {});
    res.json(result);
  } catch (error) {
    sendBridgeError(res, error);
  }
}

export function disconnectZaloBridge(req, res) {
  try {
    disconnectZaloTabBridge(getBearerToken(req));
    res.json({ success: true });
  } catch (error) {
    sendBridgeError(res, error);
  }
}

export function heartbeatZaloBridge(req, res) {
  try {
    res.json(touchZaloTabBridge(getBearerToken(req)));
  } catch (error) {
    sendBridgeError(res, error);
  }
}
