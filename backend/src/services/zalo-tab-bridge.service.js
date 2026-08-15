import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONNECTION_TTL_MS = 45_000;
const PAIRING_TTL_MS = 10 * 60_000;
const DEFAULT_JOB_TIMEOUT_MS = 3 * 60_000;
const MAX_PAIR_FAILURES = 10;
const PAIR_FAILURE_WINDOW_MS = 5 * 60_000;
const DEVICE_STORE_PATH = process.env.ZALO_BRIDGE_DEVICE_STORE
  ? resolve(process.env.ZALO_BRIDGE_DEVICE_STORE)
  : fileURLToPath(new URL('../../config/zalo-bridge-device.json', import.meta.url));

let pairing = null;
let bridgeToken = null;
let connection = null;
let activeJob = null;
let pairFailures = [];
let registeredDevice = null;
const jobWaiters = new Set();
const recentCompletions = new Map();

function bridgeError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function trimText(value, maxLength = 250) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeTargetUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'chat.zalo.me') return null;
    return url.href;
  } catch {
    return null;
  }
}

function hashDeviceSecret(value) {
  return createHash('sha256')
    .update(`zenwatch-zalo-bridge:v1:${String(value || '')}`)
    .digest('hex');
}

function safeEqualHash(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(String(left || '')) || !/^[a-f0-9]{64}$/i.test(String(right || ''))) {
    return false;
  }
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeRegisteredDevice(value) {
  if (!value || value.version !== 1) return null;
  const clientId = trimText(value.clientId, 120);
  const secretHash = String(value.secretHash || '').toLowerCase();
  if (!clientId || !/^[a-f0-9]{64}$/.test(secretHash)) return null;
  return {
    version: 1,
    clientId,
    secretHash,
    createdAt: trimText(value.createdAt, 80) || nowIso(),
    lastUsedAt: trimText(value.lastUsedAt, 80) || null,
  };
}

function loadRegisteredDevice() {
  try {
    return normalizeRegisteredDevice(JSON.parse(readFileSync(DEVICE_STORE_PATH, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    console.warn('[ZaloBridge] Không đọc được đăng ký thiết bị đã lưu:', error?.message || error);
    return null;
  }
}

function persistRegisteredDevice(device) {
  try {
    mkdirSync(dirname(DEVICE_STORE_PATH), { recursive: true });
    writeFileSync(DEVICE_STORE_PATH, `${JSON.stringify(device, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (error) {
    throw bridgeError(
      `Không lưu được đăng ký Zalo Bridge: ${error?.message || error}`,
      'DEVICE_STORE_FAILED',
      500,
    );
  }
}

function registerDevice(clientId) {
  const deviceSecret = randomBytes(32).toString('hex');
  const now = nowIso();
  const device = {
    version: 1,
    clientId,
    secretHash: hashDeviceSecret(deviceSecret),
    createdAt: registeredDevice?.createdAt || now,
    lastUsedAt: now,
  };
  persistRegisteredDevice(device);
  registeredDevice = device;
  return deviceSecret;
}

function revokeRegisteredDevice() {
  registeredDevice = null;
  try {
    unlinkSync(DEVICE_STORE_PATH);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[ZaloBridge] Không xóa được đăng ký thiết bị:', error?.message || error);
    }
  }
}

function validateConnectionTarget({ tabId, url }) {
  const targetUrl = normalizeTargetUrl(url);
  if (!targetUrl) {
    throw bridgeError('Chỉ được kết nối tab https://chat.zalo.me/.', 'INVALID_ZALO_TAB');
  }
  const normalizedTabId = Number(tabId);
  if (!Number.isInteger(normalizedTabId) || normalizedTabId < 0) {
    throw bridgeError('Tab Zalo không hợp lệ.', 'INVALID_TAB_ID');
  }
  return { targetUrl, tabId: normalizedTabId };
}

function establishConnection({ clientId, tabId, title, targetUrl }, now = Date.now()) {
  bridgeToken = randomBytes(32).toString('hex');
  connection = {
    clientId,
    tabId,
    title: trimText(title || 'Zalo Web'),
    url: targetUrl,
    connectedAt: now,
    lastSeenAt: now,
  };
  return {
    token: bridgeToken,
    connection: getZaloTabBridgeStatus().target,
  };
}

registeredDevice = loadRegisteredDevice();

function cleanupPairFailures(now = Date.now()) {
  pairFailures = pairFailures.filter((timestamp) => now - timestamp < PAIR_FAILURE_WINDOW_MS);
}

function isPairingActive(now = Date.now()) {
  return Boolean(pairing && pairing.expiresAt > now);
}

function isConnectionFresh(now = Date.now()) {
  if (!connection || !bridgeToken) return false;
  return now - connection.lastSeenAt <= CONNECTION_TTL_MS;
}

function clearRecentCompletions() {
  while (recentCompletions.size > 20) {
    const firstKey = recentCompletions.keys().next().value;
    recentCompletions.delete(firstKey);
  }
}

function wakeJobWaiters() {
  for (const wake of jobWaiters) wake();
  jobWaiters.clear();
}

function claimActiveJob() {
  if (!activeJob || activeJob.status !== 'queued') return null;
  activeJob.status = 'claimed';
  activeJob.claimedAt = Date.now();
  return {
    id: activeJob.id,
    createdAt: activeJob.createdAt,
    ...activeJob.payload,
  };
}

function settleActiveJob(job, outcome, value) {
  if (!activeJob || activeJob.id !== job.id) return;
  activeJob = null;
  clearTimeout(job.timer);
  if (job.signal && job.abortHandler) {
    job.signal.removeEventListener('abort', job.abortHandler);
  }
  recentCompletions.set(job.id, {
    success: outcome === 'resolve',
    completedAt: nowIso(),
  });
  clearRecentCompletions();
  wakeJobWaiters();
  if (outcome === 'resolve') job.resolve(value);
  else job.reject(value);
}

export function isLoopbackAddress(address) {
  const normalized = String(address || '').trim().toLowerCase().split('%')[0];
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1'
    || normalized === '::ffff:7f00:1';
}

export function createZaloBridgePairingCode() {
  const code = String(randomInt(100_000, 1_000_000));
  pairing = {
    code,
    createdAt: Date.now(),
    expiresAt: Date.now() + PAIRING_TTL_MS,
  };
  pairFailures = [];
  return {
    code,
    expiresAt: new Date(pairing.expiresAt).toISOString(),
  };
}

export function pairZaloTabBridge({ code, clientId, tabId, title, url }) {
  const now = Date.now();
  cleanupPairFailures(now);
  if (pairFailures.length >= MAX_PAIR_FAILURES) {
    throw bridgeError('Thử mã kết nối quá nhiều lần. Hãy tạo mã mới.', 'PAIR_RATE_LIMITED', 429);
  }

  if (!isPairingActive(now) || String(code || '') !== pairing.code) {
    pairFailures.push(now);
    throw bridgeError('Mã kết nối không đúng hoặc đã hết hạn.', 'INVALID_PAIRING_CODE', 401);
  }

  const target = validateConnectionTarget({ tabId, url });
  const normalizedClientId = trimText(clientId || randomUUID(), 120);
  const deviceSecret = registerDevice(normalizedClientId);
  const session = establishConnection({
    clientId: normalizedClientId,
    tabId: target.tabId,
    title,
    targetUrl: target.targetUrl,
  }, now);
  pairing = null;
  pairFailures = [];

  return {
    ...session,
    deviceSecret,
  };
}

export function enrollZaloBridgeDevice(token) {
  authenticateZaloBridgeToken(token);
  if (!connection) {
    throw bridgeError('Zalo Bridge chưa được kết nối.', 'BRIDGE_NOT_CONNECTED', 409);
  }
  return {
    clientId: connection.clientId,
    deviceSecret: registerDevice(connection.clientId),
  };
}

export function resumeZaloTabBridge({ clientId, deviceSecret, tabId, title, url }) {
  const now = Date.now();
  cleanupPairFailures(now);
  if (pairFailures.length >= MAX_PAIR_FAILURES) {
    throw bridgeError('Thử tự kết nối lại quá nhiều lần. Hãy tạo mã mới.', 'RESUME_RATE_LIMITED', 429);
  }

  const normalizedClientId = trimText(clientId, 120);
  const suppliedHash = hashDeviceSecret(deviceSecret);
  if (!registeredDevice
    || !normalizedClientId
    || normalizedClientId !== registeredDevice.clientId
    || !safeEqualHash(suppliedHash, registeredDevice.secretHash)) {
    pairFailures.push(now);
    throw bridgeError(
      'Đăng ký tự kết nối Zalo Bridge không hợp lệ. Hãy tạo mã kết nối mới.',
      'INVALID_DEVICE_CREDENTIAL',
      401,
    );
  }

  const target = validateConnectionTarget({ tabId, url });
  registeredDevice = {
    ...registeredDevice,
    lastUsedAt: nowIso(),
  };
  persistRegisteredDevice(registeredDevice);
  pairFailures = [];
  return establishConnection({
    clientId: normalizedClientId,
    tabId: target.tabId,
    title,
    targetUrl: target.targetUrl,
  }, now);
}

export function authenticateZaloBridgeToken(token) {
  if (!bridgeToken || !token || token !== bridgeToken) {
    throw bridgeError('Token Zalo Bridge không hợp lệ.', 'INVALID_BRIDGE_TOKEN', 401);
  }
  return true;
}

export function touchZaloTabBridge(token) {
  authenticateZaloBridgeToken(token);
  if (!connection) {
    throw bridgeError('Zalo Bridge chưa được kết nối.', 'BRIDGE_NOT_CONNECTED', 409);
  }
  connection.lastSeenAt = Date.now();
  return getZaloTabBridgeStatus();
}

export function disconnectZaloTabBridge(token) {
  authenticateZaloBridgeToken(token);
  if (activeJob) {
    const job = activeJob;
    settleActiveJob(
      job,
      'reject',
      bridgeError('Extension đã ngắt kết nối tab Zalo Web.', 'BRIDGE_DISCONNECTED', 409),
    );
  }
  bridgeToken = null;
  connection = null;
  revokeRegisteredDevice();
  wakeJobWaiters();
}

export function getZaloTabBridgeStatus() {
  const now = Date.now();
  const connected = isConnectionFresh(now);
  return {
    connected,
    connectionState: connected ? 'connected' : connection ? 'stale' : 'disconnected',
    lastSeenAt: connection ? new Date(connection.lastSeenAt).toISOString() : null,
    target: connection ? {
      clientId: connection.clientId,
      tabId: connection.tabId,
      title: connection.title,
      url: connection.url,
      connectedAt: new Date(connection.connectedAt).toISOString(),
    } : null,
    pairing: {
      active: isPairingActive(now),
      expiresAt: isPairingActive(now) ? new Date(pairing.expiresAt).toISOString() : null,
    },
    autoReconnectAvailable: Boolean(registeredDevice),
    activeJob: activeJob ? {
      id: activeJob.id,
      status: activeJob.status,
      groupName: activeJob.payload.groupName,
      createdAt: activeJob.createdAt,
    } : null,
  };
}

export async function waitForNextZaloTabJob(token, { waitMs = 20_000, signal } = {}) {
  touchZaloTabBridge(token);
  const immediateJob = claimActiveJob();
  if (immediateJob) return immediateJob;

  const boundedWaitMs = Math.max(0, Math.min(Number(waitMs) || 0, 25_000));
  if (boundedWaitMs === 0 || signal?.aborted) return null;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      jobWaiters.delete(finish);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, boundedWaitMs);
    jobWaiters.add(finish);
    signal?.addEventListener('abort', finish, { once: true });
  });

  touchZaloTabBridge(token);
  return claimActiveJob();
}

export function dispatchZaloTabJob(payload, { signal, timeoutMs = DEFAULT_JOB_TIMEOUT_MS } = {}) {
  if (!isConnectionFresh()) {
    throw bridgeError(
      'Chưa kết nối tab Zalo Web. Hãy mở extension ZenWatch Zalo Tab Bridge và kết nối lại.',
      'BRIDGE_NOT_CONNECTED',
      409,
    );
  }
  if (activeJob) {
    throw bridgeError('Zalo Bridge đang xử lý một lệnh khác.', 'BRIDGE_BUSY', 409);
  }
  if (signal?.aborted) {
    throw bridgeError('Đã dừng.', 'JOB_ABORTED', 499);
  }

  const groupName = trimText(payload?.groupName, 300);
  const content = String(payload?.content || '');
  const filePaths = Array.isArray(payload?.filePaths)
    ? payload.filePaths.map((filePath) => String(filePath || '')).filter(Boolean)
    : [];
  if (!groupName) throw bridgeError('Thiếu tên nhóm Zalo.', 'INVALID_JOB');
  if (!content.trim()) throw bridgeError('Thiếu nội dung bài Zalo.', 'INVALID_JOB');
  if (filePaths.length === 0) throw bridgeError('Không có ảnh để đăng Zalo.', 'INVALID_JOB');

  return new Promise((resolve, reject) => {
    const job = {
      id: randomUUID(),
      status: 'queued',
      createdAt: nowIso(),
      payload: {
        productId: trimText(payload?.productId, 120),
        groupName,
        content,
        filePaths,
      },
      resolve,
      reject,
      signal,
      abortHandler: null,
      timer: null,
    };

    job.abortHandler = () => {
      settleActiveJob(job, 'reject', bridgeError('Đã dừng.', 'JOB_ABORTED', 499));
    };
    job.timer = setTimeout(() => {
      settleActiveJob(
        job,
        'reject',
        bridgeError(`Tab Zalo không phản hồi sau ${Math.round(timeoutMs / 1000)} giây.`, 'JOB_TIMEOUT', 504),
      );
    }, Math.max(10_000, Number(timeoutMs) || DEFAULT_JOB_TIMEOUT_MS));
    signal?.addEventListener('abort', job.abortHandler, { once: true });
    activeJob = job;
    wakeJobWaiters();
  });
}

export function completeZaloTabJob(token, jobId, result = {}) {
  touchZaloTabBridge(token);
  const normalizedJobId = trimText(jobId, 120);
  if (!activeJob || activeJob.id !== normalizedJobId) {
    if (recentCompletions.has(normalizedJobId)) return recentCompletions.get(normalizedJobId);
    throw bridgeError('Job Zalo không còn hiệu lực hoặc đã hết hạn.', 'UNKNOWN_JOB', 409);
  }

  const job = activeJob;
  if (result.success === true) {
    const completion = {
      success: true,
      groupName: job.payload.groupName,
      detail: trimText(result.detail || 'Đã gửi qua tab Zalo Web', 500),
      completedAt: nowIso(),
    };
    settleActiveJob(job, 'resolve', completion);
    return completion;
  }

  const message = trimText(result.error || 'Extension không thể gửi bài Zalo.', 800);
  const error = bridgeError(message, 'EXTENSION_JOB_FAILED', 502);
  settleActiveJob(job, 'reject', error);
  return { success: false, error: message };
}

export function resetZaloTabBridgeForTests({ preserveRegisteredDevice = false } = {}) {
  pairing = null;
  bridgeToken = null;
  connection = null;
  pairFailures = [];
  recentCompletions.clear();
  if (preserveRegisteredDevice) registeredDevice = loadRegisteredDevice();
  else revokeRegisteredDevice();
  wakeJobWaiters();
  if (activeJob) {
    const job = activeJob;
    activeJob = null;
    clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.abortHandler);
    job.reject(bridgeError('Test reset.', 'TEST_RESET'));
  }
}
