import 'dotenv/config';
import https from 'https';

const token = String(process.env.MOBILE_WORKER_TOKEN || '').trim();
if (!token) throw new Error('MOBILE_WORKER_TOKEN is missing');

const publicUrl = String(
  process.env.MOBILE_WORKER_BASE_URL || process.env.PUBLIC_BASE_URL || '',
).trim().replace(/\/+$/, '');
if (!publicUrl.startsWith('https://')) {
  throw new Error('MOBILE_WORKER_BASE_URL must be a public HTTPS URL');
}

const healthUrl = new URL('/api/mobile-worker/health', publicUrl);

const requestWithPublicIp = (ipAddress) => new Promise((resolve, reject) => {
  const lookup = (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, [{ address: ipAddress, family: 4 }]);
    } else {
      callback(null, ipAddress, 4);
    }
  };
  const request = https.request({
    hostname: healthUrl.hostname,
    path: `${healthUrl.pathname}${healthUrl.search}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    lookup,
    servername: healthUrl.hostname,
    timeout: 20_000,
  }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => resolve({
      body,
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
    }));
  });
  request.on('timeout', () => request.destroy(new Error('Public health request timed out')));
  request.on('error', reject);
  request.end();
});

const requestHealth = async () => {
  try {
    const response = await fetch(healthUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    return {
      body: await response.text(),
      ok: response.ok,
      status: response.status,
    };
  } catch (directError) {
    // MagicDNS resolves this machine's own *.ts.net name to its private 100.x IP.
    // Resolve through public DNS so the test follows the same Funnel path as the phone.
    const dnsResponse = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(healthUrl.hostname)}&type=A`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!dnsResponse.ok) throw directError;
    const dnsData = await dnsResponse.json();
    const publicIp = dnsData.Answer?.find((answer) => answer.type === 1)?.data;
    if (!publicIp) throw directError;
    return requestWithPublicIp(publicIp);
  }
};

const healthResponse = await requestHealth();
if (!healthResponse.ok) {
  throw new Error(`Public health returned ${healthResponse.status}: ${healthResponse.body}`);
}

const health = JSON.parse(healthResponse.body);
if (!health.ok) throw new Error('Public health payload is not ok');
console.log(`mobile-worker Tailscale Funnel: OK (${publicUrl})`);
