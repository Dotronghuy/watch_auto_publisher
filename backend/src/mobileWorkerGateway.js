import crypto from 'crypto';
import http from 'http';
import { fileURLToPath } from 'url';

const DEFAULT_BODY_LIMIT = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT = 180;
const RATE_WINDOW_MS = 60_000;

const WORKER_ROUTES = [
  { method: 'GET', pattern: /^\/api\/mobile-worker\/health$/ },
  { method: 'GET', pattern: /^\/api\/mobile-worker\/jobs\/next$/ },
  { method: 'POST', pattern: /^\/api\/mobile-worker\/jobs\/[^/]+\/heartbeat$/ },
  { method: 'POST', pattern: /^\/api\/mobile-worker\/jobs\/[^/]+\/result$/ },
];

const jsonResponse = (res, statusCode, body) => {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': payload.length,
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const isAllowedWorkerRoute = (method, pathname) => WORKER_ROUTES.some(
  (route) => route.method === method && route.pattern.test(pathname),
);

export const createMobileWorkerGateway = ({
  token = process.env.MOBILE_WORKER_TOKEN,
  targetHost = '127.0.0.1',
  targetPort = Number(process.env.PORT || 3000),
  bodyLimit = DEFAULT_BODY_LIMIT,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  rateLimit = DEFAULT_RATE_LIMIT,
} = {}) => {
  const expectedToken = String(token || '').trim();
  if (!expectedToken) {
    throw new Error('MOBILE_WORKER_TOKEN is required for the public gateway');
  }

  const rateBuckets = new Map();

  return http.createServer((req, res) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', 'http://mobile-worker.local');
    } catch {
      jsonResponse(res, 400, { error: 'Invalid request URL' });
      return;
    }

    if (!isAllowedWorkerRoute(req.method, parsedUrl.pathname)) {
      jsonResponse(res, 404, { error: 'Not found' });
      return;
    }

    const authorization = String(req.headers.authorization || '');
    const suppliedToken = authorization.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : '';

    if (!safeEqual(expectedToken, suppliedToken)) {
      jsonResponse(res, 401, { error: 'Invalid mobile worker token' });
      return;
    }

    const now = Date.now();
    const clientKey = String(req.socket.remoteAddress || 'unknown');
    const bucket = rateBuckets.get(clientKey);
    if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
      rateBuckets.set(clientKey, { count: 1, startedAt: now });
    } else {
      bucket.count += 1;
      if (bucket.count > rateLimit) {
        jsonResponse(res, 429, { error: 'Too many requests' });
        return;
      }
    }

    const bodyChunks = [];
    let bodySize = 0;
    let requestFinished = false;

    req.on('data', (chunk) => {
      if (requestFinished) return;
      bodySize += chunk.length;
      if (bodySize > bodyLimit) {
        requestFinished = true;
        jsonResponse(res, 413, { error: 'Request body is too large' });
        req.destroy();
        return;
      }
      bodyChunks.push(chunk);
    });

    req.on('error', () => {
      if (!res.headersSent) {
        jsonResponse(res, 400, { error: 'Invalid request body' });
      }
    });

    req.on('end', () => {
      if (requestFinished) return;
      requestFinished = true;

      const body = Buffer.concat(bodyChunks);
      const headers = {
        authorization: `Bearer ${expectedToken}`,
        connection: 'close',
        host: `${targetHost}:${targetPort}`,
      };
      if (body.length) {
        headers['content-length'] = String(body.length);
        headers['content-type'] = String(req.headers['content-type'] || 'application/json');
      }

      const proxyRequest = http.request({
        host: targetHost,
        port: targetPort,
        method: req.method,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers,
        timeout: requestTimeoutMs,
      }, (proxyResponse) => {
        const responseHeaders = {
          'cache-control': 'no-store',
          'content-type': String(proxyResponse.headers['content-type'] || 'application/json; charset=utf-8'),
          'x-content-type-options': 'nosniff',
        };
        res.writeHead(proxyResponse.statusCode || 502, responseHeaders);
        proxyResponse.pipe(res);
      });

      proxyRequest.on('timeout', () => {
        proxyRequest.destroy(new Error('Backend request timed out'));
      });
      proxyRequest.on('error', () => {
        if (!res.headersSent) {
          jsonResponse(res, 502, { error: 'Mobile worker backend is unavailable' });
        } else {
          res.destroy();
        }
      });

      if (body.length) proxyRequest.write(body);
      proxyRequest.end();
    });
  });
};

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`));

if (isDirectRun) {
  const listenHost = String(process.env.MOBILE_WORKER_GATEWAY_HOST || '127.0.0.1');
  const listenPort = Number(process.env.MOBILE_WORKER_GATEWAY_PORT || 3100);
  const server = createMobileWorkerGateway();

  server.listen(listenPort, listenHost, () => {
    console.log(`Mobile worker gateway listening on http://${listenHost}:${listenPort}`);
  });
}
