import { spawnSync } from 'child_process';
import fs from 'fs';

const executableCandidates = process.platform === 'win32'
  ? [
      process.env.TAILSCALE_PATH,
      'C:\\Program Files\\Tailscale\\tailscale.exe',
      'tailscale.exe',
    ]
  : [process.env.TAILSCALE_PATH, 'tailscale'];

const tailscaleExecutable = executableCandidates.find((candidate) => {
  if (!candidate) return false;
  return candidate.includes('\\') || candidate.includes('/')
    ? fs.existsSync(candidate)
    : true;
});

if (!tailscaleExecutable) {
  throw new Error('Tailscale chưa được cài đặt.');
}

const runTailscale = (args) => {
  const result = spawnSync(tailscaleExecutable, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(
      `${tailscaleExecutable} ${args.join(' ')} thất bại: ${detail || `exit ${result.status}`}`,
    );
  }
  return String(result.stdout || '').trim();
};

const status = JSON.parse(runTailscale(['status', '--json']));
if (status.BackendState !== 'Running' || !status.Self?.DNSName) {
  throw new Error('Tailscale chưa đăng nhập hoặc chưa kết nối.');
}

const gatewayPort = String(process.env.MOBILE_WORKER_GATEWAY_PORT || 3100);
const target = `http://127.0.0.1:${gatewayPort}`;
runTailscale(['funnel', '--bg', '--yes', target]);

const dnsName = String(status.Self.DNSName).replace(/\.$/, '');
const publicUrl = `https://${dnsName}`;
console.log(`Tailscale Funnel đã bật: ${publicUrl} -> ${target}`);
console.log('Cấu hình chạy nền được Tailscale lưu và tự khôi phục sau khi Windows khởi động lại.');
