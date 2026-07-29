import crypto from 'crypto';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '../..');
const envPath = path.join(backendDir, '.env');
const pairingPath = path.join(backendDir, 'config', 'mobile_worker_pairing.txt');

const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
let updated = original.trimEnd();

const readValue = (key) => {
  const match = updated.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
};

let token = readValue('MOBILE_WORKER_TOKEN');
if (!token) {
  token = crypto.randomBytes(32).toString('base64url');
  updated += `${updated ? '\n' : ''}MOBILE_WORKER_TOKEN=${token}`;
}
if (!readValue('MOBILE_SHOPEE_LINK_MODE')) {
  updated += '\nMOBILE_SHOPEE_LINK_MODE=android_worker';
}
if (!readValue('MOBILE_SHOPEE_LINK_NAME')) {
  updated += '\nMOBILE_SHOPEE_LINK_NAME=Mua ở đây';
}

fs.writeFileSync(envPath, `${updated}\n`, 'utf8');
fs.mkdirSync(path.dirname(pairingPath), { recursive: true });

let serverUrl = readValue('MOBILE_WORKER_BASE_URL') || readValue('PUBLIC_BASE_URL');
if (!serverUrl) {
  try {
    const executable = process.platform === 'win32'
      ? 'C:\\Program Files\\Tailscale\\tailscale.exe'
      : 'tailscale';
    const result = spawnSync(executable, ['status', '--json'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status === 0) {
      const status = JSON.parse(result.stdout);
      const dnsName = String(status.Self?.DNSName || '').replace(/\.$/, '');
      if (status.BackendState === 'Running' && dnsName) {
        serverUrl = `https://${dnsName}`;
      }
    }
  } catch {
    // Tailscale chưa đăng nhập; người dùng có thể cấu hình URL sau.
  }
}

fs.writeFileSync(
  pairingPath,
  [
    'ZENWATCH ANDROID WORKER PAIRING',
    '================================',
    '',
    `Server URL (HTTPS): ${serverUrl || 'đăng nhập Tailscale và bật Funnel trước'}`,
    `Token: ${token}`,
    '',
    'Không chia sẻ token này. Có thể xóa file sau khi nhập vào điện thoại.',
    '',
  ].join('\n'),
  'utf8',
);

console.log(`Mobile Worker configuration is ready: ${pairingPath}`);
