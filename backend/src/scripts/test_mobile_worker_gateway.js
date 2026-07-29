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
  gateway = createMobileWorkerGateway({ token, targetPort: backendPort });
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
    body: JSON.stringify({ deviceId: 'test-device', status: 'SUCCEEDED' }),
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

  console.log('mobile-worker gateway security: OK');
} finally {
  if (gateway?.listening) await close(gateway);
  if (fakeBackend.listening) await close(fakeBackend);
}
