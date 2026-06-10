import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../../../backend/crm.db'); // Lưu vào thư mục backend

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Lỗi khi mở CRM database', err.message);
  }
});

// Khởi tạo các bảng
export const initCRMDB = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Bảng conversations (đoạn chat inbox hoặc bài viết có comment)
      db.run(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL, -- 'facebook' hoặc 'instagram'
          type TEXT NOT NULL, -- 'inbox' hoặc 'comment'
          sender_name TEXT,
          sender_id TEXT,
          snippet TEXT,
          unread_count INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          account_id TEXT -- Để biết đoạn chat này thuộc Page/Account nào
        )
      `);

      // Bảng messages (tin nhắn chi tiết hoặc comment cụ thể)
      db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          message TEXT,
          is_from_page BOOLEAN DEFAULT 0,
          created_time DATETIME,
          FOREIGN KEY(conversation_id) REFERENCES conversations(id)
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
};

export const saveConversation = (id, platform, type, sender_name, sender_id, snippet, updated_at, account_id) => {
  return new Promise((resolve, reject) => {
    // Note: Dùng try-catch ẩn cho việc alter table để support DB cũ (chưa có cột account_id)
    db.run('ALTER TABLE conversations ADD COLUMN account_id TEXT', (err) => { /* Ignore err nếu cột đã tồn tại */ });

    const stmt = db.prepare(`
      INSERT INTO conversations (id, platform, type, sender_name, sender_id, snippet, updated_at, account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        snippet=excluded.snippet,
        updated_at=excluded.updated_at,
        account_id=excluded.account_id
    `);
    stmt.run([id, platform, type, sender_name, sender_id, snippet, updated_at, account_id], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
    stmt.finalize();
  });
};

export const saveMessage = (id, conversation_id, message, is_from_page, created_time) => {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO messages (id, conversation_id, message, is_from_page, created_time)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run([id, conversation_id, message, is_from_page ? 1 : 0, created_time], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
    stmt.finalize();
  });
};

export const getConversations = () => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM conversations ORDER BY updated_at DESC`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export const getConversationById = (id) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM conversations WHERE id = ?`, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const getMessagesByConversation = (conversationId) => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_time ASC`, [conversationId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};
