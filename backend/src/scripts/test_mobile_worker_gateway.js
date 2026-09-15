import assert from 'assert/strict';
import http from 'http';
import { createMobileWorkerGateway } from '../mobileWorkerGateway.js';

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const close = (server) => new Promise((resolve) => server.close(resolve));

const token = 'gateway-test-token';
const received = [];

const fakeBackend = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    if (req.url.includes('disconnect=1')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"ok":');
      setTimeout(() => res.destroy(), 20);
      return;
    }
    if (req.url.includes('timeout=1')) return;
    received.push({
      authorization: req.headers.authorization,
      body: Buffer.concat(chunks).toString('utf8'),
      method: req.method,
      url: req.url,
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});

let gateway;

try {
  const backendPort = await listen(fakeBackend);
  gateway = createMobileWorkerGateway({ token, targetPort: backendPort, requestTimeoutMs: 250 });
  const gatewayPort = await listen(gateway);
  const baseUrl = `http://127.0.0.1:${gatewayPort}`;
  const authorized = { authorization: `Bearer ${token}` };

  let response = await fetch(`${baseUrl}/api/mobile-worker/health`);
  assert.equal(response.status, 401);

  response = await fetch(`${baseUrl}/api/mobile-worker/jobs`, { headers: authorized });
  assert.equal(response.status, 404);

  response = await fetch(`${baseUrl}/api/auth/login`, { headers: authorized });
  assert.equal(response.status, 404);

  response = await fetch(`${baseUrl}/api/mobile-worker/health`, { headers: authorized });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);

  response = await fetch(`${baseUrl}/api/mobile-worker/jobs/abc/result`, {
    method: 'POST',
    headers: {
      ...authorized,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ deviceId: 'test-device', attempt: 1, status: 'SUCCEEDED' }),
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/mobile-worker/jobs/abc/retry`, {
    method: 'POST',
    headers: authorized,
  });
  assert.equal(response.status, 404);

  response = await fetch(`${baseUrl}/api/mobile-worker/jobs/abc/result`, {
    method: 'POST',
    headers: {
      ...authorized,
      'content-type': 'application/json',
    },
    body: 'x'.repeat(65 * 1024),
  });
  assert.equal(response.status, 413);

  assert.deepEqual(received.map(({ method, url }) => ({ method, url })), [
    { method: 'GET', url: '/api/mobile-worker/health' },
    { method: 'POST', url: '/api/mobile-worker/jobs/abc/result' },
  ]);
  assert(received.every((request) => request.authorization === `Bearer ${token}`));

  response = await fetch(`${baseUrl}/api/mobile-worker/health?timeout=1`, { headers: authorized });
  assert.equal(response.status, 502, 'backend timeout must not hang the Android poll');
  const startedAt = Date.now();
  await assert.rejects(async () => {
    const broken = await fetch(`${baseUrl}/api/mobile-worker/health?disconnect=1`, {
      headers: authorized, signal: AbortSignal.timeout(2000),
    });
    await broken.text();
  });
  assert(Date.now() - startedAt < 1500, 'partial backend response left the gateway connection hanging');
  response = await fetch(`${baseUrl}/api/mobile-worker/health`, { headers: authorized });
  assert.equal(response.status, 200, 'gateway did not recover after backend disconnection');

  console.log('mobile-worker gateway security: OK');
} finally {
  if (gateway?.listening) await close(gateway);
  if (fakeBackend.listening) await close(fakeBackend);
}
