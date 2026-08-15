import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testDirectory = mkdtempSync(join(tmpdir(), 'zenwatch-zalo-bridge-'));
const deviceStorePath = join(testDirectory, 'device.json');
process.env.ZALO_BRIDGE_DEVICE_STORE = deviceStorePath;

const {
  authenticateZaloBridgeToken,
  completeZaloTabJob,
  createZaloBridgePairingCode,
  dispatchZaloTabJob,
  disconnectZaloTabBridge,
  enrollZaloBridgeDevice,
  getZaloTabBridgeStatus,
  isLoopbackAddress,
  pairZaloTabBridge,
  resetZaloTabBridgeForTests,
  resumeZaloTabBridge,
  waitForNextZaloTabJob,
} = await import('./zalo-tab-bridge.service.js');

test.afterEach(() => {
  resetZaloTabBridgeForTests();
});

test.after(() => {
  resetZaloTabBridgeForTests();
  rmSync(testDirectory, { recursive: true, force: true });
  delete process.env.ZALO_BRIDGE_DEVICE_STORE;
});

test('bridge endpoints accept only loopback socket addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.20'), false);
  assert.equal(isLoopbackAddress('203.0.113.10'), false);
});

test('pairing accepts only a chat.zalo.me tab and exposes no token in public status', () => {
  const pairing = createZaloBridgePairingCode();
  assert.throws(
    () => pairZaloTabBridge({
      code: pairing.code,
      clientId: 'extension-test',
      tabId: 10,
      title: 'Not Zalo',
      url: 'https://example.com/',
    }),
    /chat\.zalo\.me/,
  );

  const freshPairing = createZaloBridgePairingCode();
  const result = pairZaloTabBridge({
    code: freshPairing.code,
    clientId: 'extension-test',
    tabId: 11,
    title: 'Zalo - Work 2',
    url: 'https://chat.zalo.me/',
  });

  assert.equal(result.token.length, 64);
  assert.equal(result.deviceSecret.length, 64);
  const storedDevice = JSON.parse(readFileSync(deviceStorePath, 'utf8'));
  assert.equal(storedDevice.clientId, 'extension-test');
  assert.equal(storedDevice.secretHash.length, 64);
  assert.equal(JSON.stringify(storedDevice).includes(result.deviceSecret), false);
  assert.equal(JSON.stringify(storedDevice).includes(result.token), false);
  const status = getZaloTabBridgeStatus();
  assert.equal(status.connected, true);
  assert.equal(status.autoReconnectAvailable, true);
  assert.equal(status.target.tabId, 11);
  assert.equal('token' in status, false);
});

test('registered device resumes with a fresh session after backend restart', () => {
  const pairing = createZaloBridgePairingCode();
  const firstSession = pairZaloTabBridge({
    code: pairing.code,
    clientId: 'extension-persistent',
    tabId: 21,
    title: 'Zalo - Work 2',
    url: 'https://chat.zalo.me/',
  });

  resetZaloTabBridgeForTests({ preserveRegisteredDevice: true });
  const restartedStatus = getZaloTabBridgeStatus();
  assert.equal(restartedStatus.connected, false);
  assert.equal(restartedStatus.autoReconnectAvailable, true);
  assert.throws(
    () => authenticateZaloBridgeToken(firstSession.token),
    (error) => error?.code === 'INVALID_BRIDGE_TOKEN',
  );

  const resumed = resumeZaloTabBridge({
    clientId: 'extension-persistent',
    deviceSecret: firstSession.deviceSecret,
    tabId: 21,
    title: 'Zalo - Work 2',
    url: 'https://chat.zalo.me/',
  });
  assert.equal(resumed.token.length, 64);
  assert.notEqual(resumed.token, firstSession.token);
  assert.equal(getZaloTabBridgeStatus().connected, true);
  assert.equal(getZaloTabBridgeStatus().target.tabId, 21);
});

test('resume rejects a wrong device secret without creating a connection', () => {
  const pairing = createZaloBridgePairingCode();
  const session = pairZaloTabBridge({
    code: pairing.code,
    clientId: 'extension-secure',
    tabId: 22,
    title: 'Zalo Web',
    url: 'https://chat.zalo.me/',
  });
  resetZaloTabBridgeForTests({ preserveRegisteredDevice: true });

  assert.throws(
    () => resumeZaloTabBridge({
      clientId: 'extension-secure',
      deviceSecret: `${session.deviceSecret.slice(0, -1)}${session.deviceSecret.endsWith('0') ? '1' : '0'}`,
      tabId: 22,
      title: 'Zalo Web',
      url: 'https://chat.zalo.me/',
    }),
    (error) => error?.code === 'INVALID_DEVICE_CREDENTIAL' && error?.status === 401,
  );
  assert.equal(getZaloTabBridgeStatus().connected, false);
});

test('an active legacy session can enroll for automatic reconnect', () => {
  const pairing = createZaloBridgePairingCode();
  const session = pairZaloTabBridge({
    code: pairing.code,
    clientId: 'extension-upgrade',
    tabId: 23,
    title: 'Zalo Web',
    url: 'https://chat.zalo.me/',
  });
  const enrolled = enrollZaloBridgeDevice(session.token);

  resetZaloTabBridgeForTests({ preserveRegisteredDevice: true });
  const resumed = resumeZaloTabBridge({
    clientId: enrolled.clientId,
    deviceSecret: enrolled.deviceSecret,
    tabId: 23,
    title: 'Zalo Web',
    url: 'https://chat.zalo.me/',
  });
  assert.equal(resumed.token.length, 64);
  assert.equal(getZaloTabBridgeStatus().connected, true);
});

test('explicit disconnect revokes automatic reconnect registration', () => {
  const pairing = createZaloBridgePairingCode();
  const session = pairZaloTabBridge({
    code: pairing.code,
    clientId: 'extension-revoked',
    tabId: 24,
    title: 'Zalo Web',
    url: 'https://chat.zalo.me/',
  });
  disconnectZaloTabBridge(session.token);
  resetZaloTabBridgeForTests({ preserveRegisteredDevice: true });

  assert.equal(getZaloTabBridgeStatus().autoReconnectAvailable, false);
  assert.throws(
    () => resumeZaloTabBridge({
      clientId: 'extension-revoked',
      deviceSecret: session.deviceSecret,
      tabId: 24,
      title: 'Zalo Web',
      url: 'https://chat.zalo.me/',
    }),
    (error) => error?.code === 'INVALID_DEVICE_CREDENTIAL',
  );
});

test('a post job is claimed once and resolves only after extension completion', async () => {
  const pairing = createZaloBridgePairingCode();
  const { token } = pairZaloTabBridge({
    code: pairing.code,
    clientId: 'extension-test',
    tabId: 12,
    title: 'Zalo Web',
    url: 'https://chat.zalo.me/',
  });

  const completionPromise = dispatchZaloTabJob({
    productId: '735G2-D2',
    groupName: 'ZenWatch Test Group',
    content: 'Nội dung thử nghiệm',
    filePaths: ['C:\\temp\\watch-01.jpg'],
  }, { timeoutMs: 10_000 });

  const job = await waitForNextZaloTabJob(token, { waitMs: 10 });
  assert.equal(job.groupName, 'ZenWatch Test Group');
  assert.deepEqual(job.filePaths, ['C:\\temp\\watch-01.jpg']);
  assert.equal(await waitForNextZaloTabJob(token, { waitMs: 0 }), null);

  completeZaloTabJob(token, job.id, {
    success: true,
    detail: 'Đã gửi và ô soạn thảo đã trống',
  });
  const completion = await completionPromise;
  assert.equal(completion.success, true);
  assert.equal(getZaloTabBridgeStatus().activeJob, null);
});

test('extension failure rejects the waiting campaign job', async () => {
  const pairing = createZaloBridgePairingCode();
  const { token } = pairZaloTabBridge({
    code: pairing.code,
    clientId: 'extension-test',
    tabId: 13,
    title: 'Zalo Web',
    url: 'https://chat.zalo.me/',
  });

  const completionPromise = dispatchZaloTabJob({
    productId: '735G2-D2',
    groupName: 'Wrong Group Guard',
    content: 'Không được gửi nhầm',
    filePaths: ['C:\\temp\\watch-01.jpg'],
  }, { timeoutMs: 10_000 });
  const job = await waitForNextZaloTabJob(token, { waitMs: 10 });
  completeZaloTabJob(token, job.id, {
    success: false,
    error: 'Không xác nhận được đúng tiêu đề nhóm.',
  });

  await assert.rejects(completionPromise, /Không xác nhận được đúng tiêu đề nhóm/);
});

test('disconnecting the extension rejects an active job immediately', async () => {
  const pairing = createZaloBridgePairingCode();
  const { token } = pairZaloTabBridge({
    code: pairing.code,
    clientId: 'extension-test',
    tabId: 14,
    title: 'Zalo Web',
    url: 'https://chat.zalo.me/',
  });

  const completionPromise = dispatchZaloTabJob({
    productId: '735G2-D2',
    groupName: 'Disconnect Guard',
    content: 'Không được treo job',
    filePaths: ['C:\\temp\\watch-01.jpg'],
  }, { timeoutMs: 10_000 });
  disconnectZaloTabBridge(token);

  await assert.rejects(completionPromise, /ngắt kết nối tab Zalo Web/);
  assert.equal(getZaloTabBridgeStatus().connected, false);
  assert.equal(getZaloTabBridgeStatus().activeJob, null);
});
