import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE = path.join(__dirname, '..', '..', 'data', 'notifications.json');
const MAX = 100;

const TYPE_META = {
  'publish-success': { icon: '✅', label: 'Đăng bài thành công' },
  'publish-error': { icon: '❌', label: 'Lỗi đăng bài' },
  captcha: { icon: '🤖', label: 'CAPTCHA / Bot check' },
  login: { icon: '🔑', label: 'Đăng nhập' },
  'ui-change': { icon: '🖥️', label: 'Giao diện thay đổi' },
  'content-invalid': { icon: '📝', label: 'Nội dung không hợp lệ' },
  system: { icon: '⚙️', label: 'Hệ thống' }
};

// Ghi tuần tự để tránh ghi đè khi nhiều luồng cùng lưu
let queue = Promise.resolve();
const enqueue = (fn) => {
  queue = queue.then(fn).catch(() => {});
  return queue;
};

export const addNotification = ({ type = 'system', title, details = '' }) => {
  const meta = TYPE_META[type] || TYPE_META.system;
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title: title || meta.label,
    details: String(details || '').slice(0, 500),
    timestamp: Date.now()
  };
  return enqueue(async () => {
    try {
      let list = [];
      try { list = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
      if (!Array.isArray(list)) list = [];
      list.unshift(entry);
      list = list.slice(0, MAX);
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(list));
      fs.renameSync(tmp, FILE);
    } catch (err) {
      console.error('Lỗi lưu thông báo trong app:', err.message);
    }
  });
};

export const getNotifications = async (limit = 20) => {
  const safeLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 20));
  try {
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(list)) return [];
    return list.slice(0, safeLimit);
  } catch (e) {
    return [];
  }
};

export const getNotificationMeta = (type) => TYPE_META[type] || TYPE_META.system;
