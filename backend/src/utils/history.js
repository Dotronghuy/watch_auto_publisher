import sqlite3 from 'sqlite3';
import fs from 'fs';
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

    db.run(`CREATE TABLE IF NOT EXISTS post_metrics (
      post_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      sku TEXT,
      content TEXT,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      last_tracked INTEGER DEFAULT 0
    )`);

    // Thêm cột shares nếu DB đã tồn tại từ trước (migration)
    db.run(`ALTER TABLE post_metrics ADD COLUMN shares INTEGER DEFAULT 0`, (err) => {
      // Bỏ qua lỗi nếu cột đã tồn tại
    });
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

// Hàm mới: Lấy toàn bộ lịch sử (dùng cho Dashboard biểu đồ)
export const getAllPostedHistory = async () => {
  try {
    const rows = await runQuery('SELECT id, timestamp FROM posted_images');
    return rows;
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
export const addPostMetric = async (platform, postId, sku, content) => {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    db.run(
      'INSERT OR IGNORE INTO post_metrics (post_id, platform, sku, content, timestamp, last_tracked) VALUES (?, ?, ?, ?, ?, ?)',
      [postId, platform, sku, content, now, 0],
      (err) => {
        if (err) console.error('L?i luu metric:', err);
        resolve();
      }
    );
  });
};

export const updatePostMetrics = async (postId, likes, comments, shares = 0) => {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    db.run(
      'UPDATE post_metrics SET likes = ?, comments = ?, shares = ?, last_tracked = ? WHERE post_id = ?',
      [likes, comments, shares, now, postId],
      (err) => resolve()
    );
  });
};

// Lấy tổng hợp tương tác trong ngày hôm nay (real-time engagement)
// accountId: (optional) lọc theo tài khoản, dựa trên fbPageId/igUserId từ accounts.json
export const getTodayEngagement = async (accountFilter = null) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    // Lấy tất cả bài đăng trong ngày (không GROUP BY để có thể phân loại theo account)
    const rows = await runQuery(
      `SELECT post_id, platform, likes, comments, shares
       FROM post_metrics
       WHERE timestamp >= ?`,
      [startOfDay]
    );

    // Đọc danh sách accounts để mapping post_id -> account
    let accounts = [];
    try {
      const accountsPath = path.join(__dirname, '../../config/accounts.json');
      if (fs.existsSync(accountsPath)) {
        accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
      }
    } catch (e) { /* ignore */ }

    // Hàm xác định account từ post_id
    const getAccountForPost = (postId, platform) => {
      if (platform === 'facebook' || platform === 'facebook_reels') {
        // FB post_id format: pageId_postId
        const parts = postId.split('_');
        if (parts.length > 1) {
          const pageId = parts[0];
          return accounts.find(a => a.fbPageId && a.fbPageId.trim() === pageId) || null;
        }
      } else if (platform === 'instagram') {
        // IG: không thể xác định từ post_id, trả về account IG đầu tiên active
        // (Tương lai khi có thêm cột account_id sẽ chính xác hơn)
        return accounts.find(a => a.igUserId && a.isActive) || null;
      }
      return null;
    };

    const result = {
      totalLikes: 0, totalComments: 0, totalShares: 0, postCount: 0,
      byPlatform: {
        facebook: { likes: 0, comments: 0, shares: 0, posts: 0 },
        instagram: { likes: 0, comments: 0, shares: 0, posts: 0 }
      },
      byAccount: {} // { accountId: { name, likes, comments, shares, posts } }
    };

    for (const row of rows) {
      const account = getAccountForPost(row.post_id, row.platform);

      // Nếu có filter accountId và post không thuộc account đó → bỏ qua
      if (accountFilter && (!account || account.id !== accountFilter)) continue;

      const likes = row.likes || 0;
      const comments = row.comments || 0;
      const shares = row.shares || 0;

      result.totalLikes += likes;
      result.totalComments += comments;
      result.totalShares += shares;
      result.postCount++;

      // Gộp facebook_reels vào facebook
      const platformKey = (row.platform === 'facebook' || row.platform === 'facebook_reels') ? 'facebook' : 'instagram';
      result.byPlatform[platformKey].likes += likes;
      result.byPlatform[platformKey].comments += comments;
      result.byPlatform[platformKey].shares += shares;
      result.byPlatform[platformKey].posts++;

      // Gộp theo account
      if (account) {
        if (!result.byAccount[account.id]) {
          result.byAccount[account.id] = { name: account.name, likes: 0, comments: 0, shares: 0, posts: 0 };
        }
        result.byAccount[account.id].likes += likes;
        result.byAccount[account.id].comments += comments;
        result.byAccount[account.id].shares += shares;
        result.byAccount[account.id].posts++;
      }
    }

    return result;
  } catch (err) {
    console.error('Lỗi getTodayEngagement:', err);
    return { totalLikes: 0, totalComments: 0, totalShares: 0, postCount: 0, byPlatform: { facebook: { likes: 0, comments: 0, shares: 0, posts: 0 }, instagram: { likes: 0, comments: 0, shares: 0, posts: 0 } }, byAccount: {} };
  }
};

export const getPostsToTrack = async () => {
  try {
    const now = Date.now();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const THIRTY_MINUTES = 30 * 60 * 1000;
    
    return await runQuery(
      'SELECT * FROM post_metrics WHERE timestamp > ? AND last_tracked < ? ORDER BY timestamp DESC LIMIT 20',
      [now - SEVEN_DAYS, now - THIRTY_MINUTES]
    );
  } catch (err) {
    return [];
  }
};
