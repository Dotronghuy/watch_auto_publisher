import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = process.env.POSTED_HISTORY_DB_FILE
  ? path.resolve(process.env.POSTED_HISTORY_DB_FILE)
  : path.join(__dirname, '..', '..', 'posted_history.db');
let markSchemaReady;
const schemaReady = new Promise(resolve => {
  markSchemaReady = resolve;
});

// Khởi tạo Database SQLite với WAL mode để xử lý đa luồng an toàn
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Lỗi khi kết nối Database:', err.message);
    markSchemaReady();
  } else {
    db.serialize(() => {
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

    // Metadata của Tone Engine. Các migration này tương thích với DB cũ:
    // SQLite sẽ báo duplicate column khi đã chạy trước đó và ta chủ động bỏ qua.
    const toneMetricColumns = [
      ['tone_id', 'TEXT'],
      ['tone_name', 'TEXT'],
      ['perspective_id', 'TEXT'],
      ['perspective', 'TEXT'],
      ['cta_id', 'TEXT'],
      ['cta', 'TEXT'],
      ['prompt_version', 'TEXT'],
      ['account_id', 'TEXT']
    ];
    toneMetricColumns.forEach(([column, type]) => {
      db.run(`ALTER TABLE post_metrics ADD COLUMN ${column} ${type}`, () => {});
    });
    db.run('CREATE INDEX IF NOT EXISTS idx_post_metrics_tone_timestamp ON post_metrics(tone_id, timestamp)', () => {
      markSchemaReady();
    });
    });
  }
});

// Helper function để bọc db.all thành Promise
const runQuery = (sql, params = []) => {
  return schemaReady.then(() => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  }));
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
  await schemaReady;
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
export const addPostMetric = async (platform, postId, sku, content, metadata = {}) => {
  await schemaReady;
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const toneId = metadata.toneId || metadata.tone_id || null;
    const toneName = metadata.toneName || metadata.tone_name || null;
    const perspectiveId = metadata.perspectiveId || metadata.perspective_id || null;
    const perspective = metadata.perspective || null;
    const ctaId = metadata.ctaId || metadata.cta_id || null;
    const cta = metadata.cta || null;
    const promptVersion = metadata.promptVersion || metadata.prompt_version || null;
    const accountId = metadata.accountId || metadata.account_id || null;

    db.run(
      `INSERT OR IGNORE INTO post_metrics (
        post_id, platform, sku, content, timestamp, last_tracked,
        tone_id, tone_name, perspective_id, perspective, cta_id, cta, prompt_version, account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        postId, platform, sku, content, now, 0,
        toneId, toneName, perspectiveId, perspective, ctaId, cta, promptVersion, accountId
      ],
      (err) => {
        if (err) {
          console.error('Lỗi lưu metric:', err);
          reject(err);
          return;
        }
        resolve();
      }
    );
  });
};

// Lấy các lựa chọn gần nhất để Tone Engine tránh lặp tone/góc nhìn/CTA.
export const getRecentContentSelections = async (limit = 5, accountId = null) => {
  try {
    const safeLimit = Math.min(20, Math.max(1, Number.parseInt(limit, 10) || 5));
    const where = ["tone_id IS NOT NULL", "tone_id != ''"];
    const params = [];
    if (accountId) {
      where.push('account_id = ?');
      params.push(accountId);
    }
    params.push(safeLimit);

    return await runQuery(
      `SELECT tone_id, tone_name, perspective_id, perspective, cta_id, cta, prompt_version, account_id, timestamp
       FROM post_metrics
       WHERE ${where.join(' AND ')}
       ORDER BY timestamp DESC
       LIMIT ?`,
      params
    );
  } catch (error) {
    console.error('Lỗi lấy lịch sử Tone Engine:', error.message);
    return [];
  }
};

// Điểm tương tác có trọng số: like + 2*comment + 3*share.
// Chỉ thống kê bài mới có metadata; dữ liệu cũ vẫn được giữ nguyên nhưng không bị gán tone sai.
export const getTonePerformance = async (days = 30, accountId = null) => {
  try {
    const safeDays = Math.min(365, Math.max(1, Number.parseInt(days, 10) || 30));
    const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;
    const where = ['timestamp >= ?', "tone_id IS NOT NULL", "tone_id != ''"];
    const params = [cutoff];
    if (accountId) {
      where.push('account_id = ?');
      params.push(accountId);
    }

    const rows = await runQuery(
      `SELECT
         tone_id,
         MAX(tone_name) AS tone_name,
         COUNT(*) AS posts,
         SUM(COALESCE(likes, 0)) AS likes,
         SUM(COALESCE(comments, 0)) AS comments,
         SUM(COALESCE(shares, 0)) AS shares,
         SUM(COALESCE(likes, 0) + 2 * COALESCE(comments, 0) + 3 * COALESCE(shares, 0)) AS score
       FROM post_metrics
       WHERE ${where.join(' AND ')}
       GROUP BY tone_id
       ORDER BY CASE WHEN COUNT(*) > 0
         THEN (SUM(COALESCE(likes, 0) + 2 * COALESCE(comments, 0) + 3 * COALESCE(shares, 0)) * 1.0 / COUNT(*))
         ELSE 0 END DESC`,
      params
    );

    return rows.map(row => ({
      toneId: row.tone_id,
      toneName: row.tone_name,
      posts: Number(row.posts) || 0,
      likes: Number(row.likes) || 0,
      comments: Number(row.comments) || 0,
      shares: Number(row.shares) || 0,
      score: Number(row.score) || 0,
      averageScore: row.posts ? Number((Number(row.score || 0) / Number(row.posts)).toFixed(2)) : 0
    }));
  } catch (error) {
    console.error('Lỗi thống kê hiệu quả tone:', error.message);
    return [];
  }
};

export const updatePostMetrics = async (postId, likes, comments, shares = 0) => {
  await schemaReady;
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
      `SELECT post_id, platform, likes, comments, shares, account_id
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
    const getAccountForPost = (postId, platform, storedAccountId = null) => {
      if (storedAccountId) {
        return accounts.find(account => account.id === storedAccountId) || { id: storedAccountId, name: storedAccountId };
      }
      if (platform === 'facebook' || platform === 'facebook_reels') {
        // FB post_id format: pageId_postId
        const parts = String(postId || '').split('_');
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
      const account = getAccountForPost(row.post_id, row.platform, row.account_id);

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

export const closeHistoryDatabase = async () => {
  await schemaReady;
  return new Promise((resolve, reject) => {
    db.close(err => {
      if (err) reject(err);
      else resolve();
    });
  });
};
