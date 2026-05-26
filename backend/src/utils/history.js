import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, '..', '..', 'posted_history.db');

// Khởi tạo Database SQLite với WAL mode để xử lý đa luồng an toàn
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Lỗi khi kết nối Database:', err.message);
  } else {
    // Bật Write-Ahead Logging để xử lý concurrent access tốt hơn
    db.run('PRAGMA journal_mode = WAL;');
    
    // Tạo bảng nếu chưa có
    db.run(`CREATE TABLE IF NOT EXISTS posted_images (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL
    )`);
  }
});

// Helper function để bọc db.all thành Promise
const runQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export const getPostedImageIds = async () => {
  try {
    const now = Date.now();
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const limitTimestamp = now - THREE_DAYS_MS;

    // Lấy các ID đã đăng trong vòng 3 ngày
    const rows = await runQuery(
      'SELECT id FROM posted_images WHERE timestamp > ?',
      [limitTimestamp]
    );
    
    return rows.map(row => row.id);
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu lịch sử từ DB:', error);
    return [];
  }
};

export const addPostedImageId = async (id) => {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    
    // Thêm bản ghi mới
    db.run(
      'INSERT OR IGNORE INTO posted_images (id, timestamp) VALUES (?, ?)',
      [id, now],
      (err) => {
        if (err) {
          console.error('Lỗi khi lưu lịch sử vào DB:', err);
          return reject(err);
        }

        // Dọn dẹp bản ghi cũ (trên 4 ngày)
        const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
        const deleteLimit = now - FOUR_DAYS_MS;
        db.run('DELETE FROM posted_images WHERE timestamp < ?', [deleteLimit], (deleteErr) => {
          if (deleteErr) console.error('Lỗi khi dọn dẹp DB:', deleteErr);
          resolve();
        });
      }
    );
  });
};
