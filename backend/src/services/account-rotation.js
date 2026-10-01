import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rotationStatePath = process.env.ACCOUNT_ROTATION_STATE_FILE
  ? path.resolve(process.env.ACCOUNT_ROTATION_STATE_FILE)
  : path.join(__dirname, '../../config/account-rotation-state.json');

// Mã lỗi Graph API cho thấy tài khoản bị hạn chế (không phải lỗi nội dung):
// 10 app bị hạn chế · 17 rate limit user · 24 user chưa được phép (IG) · 32 ID page sai
// 190 token hết hạn/sai · 200 thiếu quyền · 341 lỗi tạm · 368 page bị hạn chế
// 459-467 token hết hạn/checkpoint · 803 user không được đăng (IG)
const RESTRICTION_CODES = new Set([10, 17, 24, 32, 190, 200, 341, 368, 459, 460, 463, 464, 467, 803]);

const RESTRICTION_PATTERNS = [
  /restricted/i,
  /\bbanned\b/i,
  /hết hạn|expired/i,
  /invalid.{0,15}token|token.{0,15}invalid/i,
  /\bpermission\b/i,
  /not.{0,20}(admin|authorized|authorised|allowed)/i,
  /\bcheckpoint\b/i,
  /session.{0,20}(expired|invalid)/i,
];

const readRotationState = () => {
  try {
    const state = JSON.parse(fs.readFileSync(rotationStatePath, 'utf8'));
    return { lastAccountKey: String(state?.lastAccountKey || '') };
  } catch (e) {
    return { lastAccountKey: '' };
  }
};

const writeRotationState = (lastAccountKey) => {
  try {
    fs.writeFileSync(rotationStatePath, JSON.stringify({ lastAccountKey }), 'utf8');
  } catch (e) {}
};

const accountKey = (account) => String(account?.id || account?.fbPageId || account?.name || '').trim();

// Luân phiên vòng xoay: tài khoản kế tiếp sau lần chạy trước đứng đầu (tài khoản chính),
// các tài khoản còn lại xếp sau theo thứ tự vòng xoay để làm dự phòng.
export const getRotatedAccountOrder = (accounts) => {
  const list = (accounts || []).slice();
  if (list.length === 0) return [];
  const lastKey = readRotationState().lastAccountKey;
  const lastIdx = lastKey ? list.findIndex(a => accountKey(a) === lastKey) : -1;
  const primaryIdx = lastIdx === -1 ? 0 : (lastIdx + 1) % list.length;
  const primary = list[primaryIdx];
  const backups = [...list.slice(primaryIdx + 1), ...list.slice(0, primaryIdx)];
  writeRotationState(accountKey(primary));
  return [primary, ...backups];
};

// Nhận diện lỗi "tài khoản bị hạn chế" để biết khi nào nên chuyển tài khoản dự phòng.
export const isAccountRestrictionError = (error) => {
  if (!error) return false;
  const apiError = error?.response?.data?.error || {};
  if (apiError.code && RESTRICTION_CODES.has(Number(apiError.code))) return true;
  if (apiError.error_subcode && RESTRICTION_CODES.has(Number(apiError.error_subcode))) return true;
  const msg = String(apiError.message || error?.message || '');
  if (!msg) return false;
  return RESTRICTION_PATTERNS.some(pattern => pattern.test(msg));
};
