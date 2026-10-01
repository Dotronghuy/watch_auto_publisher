import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sqlite3 from 'sqlite3';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.resolve(__dirname, '../..');
const BACKUPS_DIR = path.join(BACKEND_DIR, 'backups');

// Dữ liệu quan trọng cần sao lưu (đường dẫn tương đối từ thư mục backend/).
// Không gồm data/vector_store.json & local-image-embedding-index.json vì là embedding
// dựng lại được bằng script (embed_knowledge.js / build_local_image_index.js).
const BACKUP_FILES = [
  '.env',
  'config/settings.json',
  'config/accounts.json',
  'config/oauth2_token.json',
  'config/oauth2_credentials.json',
  'config/credentials.json',
  'config/analyzed_samples.json',
  'config/image-engine-state.json',
  'config/account-rotation-state.json',
  'config/mobile_worker_pairing.txt',
  'config/zalo-bridge-device.json',
  'posted_history.db',
  'crm.db',
  'prisma/app.db',
  'data/catalog.json',
];

export const BACKUP_NAME_PATTERN = /^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

const WINDOWS_BSD_TAR = 'C:\\Windows\\System32\\tar.exe';

// Chốt giao dịch WAL về file .db chính để bản sao không thiếu dữ liệu mới nhất.
const checkpointSqlite = (dbFile) => new Promise((resolve) => {
  if (!fs.existsSync(dbFile)) return resolve();
  const db = new sqlite3.Database(dbFile, () => {
    db.run('PRAGMA wal_checkpoint(TRUNCATE);', () => {
      db.close(() => resolve());
    });
  });
});

const fileSize = (filePath) => {
  try { return fs.statSync(filePath).size; } catch (e) { return 0; }
};

const collectFolderFiles = (dir, base = dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFolderFiles(full, base, out);
    else if (entry.isFile()) out.push({ rel: path.relative(base, full), size: fileSize(full) });
  }
  return out;
};

export const createBackup = async () => {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const name = `backup_${stamp}`;
  const folder = path.join(BACKUPS_DIR, name);
  fs.mkdirSync(folder, { recursive: true });

  let fileCount = 0;
  let totalBytes = 0;
  const copied = [];
  for (const rel of BACKUP_FILES) {
    const src = path.join(BACKEND_DIR, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    if (rel.endsWith('.db')) await checkpointSqlite(src);
    const dest = path.join(folder, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    fileCount++;
    totalBytes += fileSize(src);
    copied.push(rel);
  }

  // Nén thành zip (bsdtar của Windows) để tải về mang đi nơi khác khi cần.
  let zipName = null;
  const zipPath = path.join(BACKUPS_DIR, `${name}.zip`);
  try {
    await execFileAsync(WINDOWS_BSD_TAR, ['-a', '-c', '-f', zipPath, '-C', folder, '.'], { windowsHide: true });
    if (fs.existsSync(zipPath)) zipName = `${name}.zip`;
  } catch (e) {
    console.warn('⚠️ Không tạo được file zip (vẫn giữ bản sao dạng thư mục):', e.message);
  }

  return { name, zipName, fileCount, totalBytes, copied, createdAt: Date.now() };
};

export const listBackups = () => {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) return [];
    return fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && BACKUP_NAME_PATTERN.test(d.name))
      .map(d => {
        const folder = path.join(BACKUPS_DIR, d.name);
        const files = collectFolderFiles(folder);
        const zipPath = path.join(BACKUPS_DIR, `${d.name}.zip`);
        return {
          name: d.name,
          zipName: fs.existsSync(zipPath) ? `${d.name}.zip` : null,
          fileCount: files.length,
          totalBytes: files.reduce((sum, f) => sum + f.size, 0),
          createdAt: fs.statSync(folder).mtimeMs,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (e) {
    console.error('Lỗi liệt kê backup:', e.message);
    return [];
  }
};

export const restoreBackup = async (name) => {
  if (!BACKUP_NAME_PATTERN.test(name)) throw new Error('Tên backup không hợp lệ.');
  const folder = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(folder)) throw new Error('Không tìm thấy bản backup này.');

  const restored = [];
  const failed = [];
  for (const rel of BACKUP_FILES) {
    const src = path.join(folder, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const dest = path.join(BACKEND_DIR, rel);
    try {
      if (rel.endsWith('.db') && fs.existsSync(dest)) await checkpointSqlite(dest);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      restored.push(rel);
    } catch (e) {
      failed.push({ file: rel, error: e.message });
    }
  }

  return {
    restored,
    failed,
    note: 'Các cài đặt, khóa API và cơ sở dữ liệu chỉ có hiệu lực đầy đủ sau khi khởi động lại hệ thống. Nếu có file không khôi phục được, hãy tắt hệ thống rồi chạy lệnh: node backend/src/scripts/restore_backup.js <tên backup>',
  };
};

export const getBackupZipPath = (name) => {
  if (!BACKUP_NAME_PATTERN.test(name)) return null;
  const zipPath = path.join(BACKUPS_DIR, `${name}.zip`);
  return fs.existsSync(zipPath) ? zipPath : null;
};
