import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../../../backend/crm.db'); // Lưu vào thư mục backend

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Lỗi khi mở CRM database', err.message);
  } else {
    db.run('PRAGMA journal_mode = WAL');
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
          is_read INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          account_id TEXT, -- Để biết đoạn chat này thuộc Page/Account nào
          bot_paused INTEGER DEFAULT 0,
          bot_paused_at DATETIME
        )
      `);

      // Thêm cột is_read cho DB cũ (nếu chưa có)
      db.run('ALTER TABLE conversations ADD COLUMN is_read INTEGER DEFAULT 0', () => {});
      
      // Thêm cột bot_paused và bot_paused_at cho chức năng Chatbot AI
      db.run('ALTER TABLE conversations ADD COLUMN bot_paused INTEGER DEFAULT 0', () => {});
      db.run('ALTER TABLE conversations ADD COLUMN bot_paused_at DATETIME', () => {});

      // Thêm cột is_approved cho chức năng Fine-tune AI
      db.run('ALTER TABLE conversations ADD COLUMN is_approved INTEGER DEFAULT 0', () => {});

      // Bảng image_hashes (lưu perceptual hash cho ảnh sản phẩm - Lớp 1 & Lớp 2)
      db.run(`
        CREATE TABLE IF NOT EXISTS image_hashes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hash TEXT NOT NULL,
          product_sku TEXT NOT NULL,
          source_type TEXT NOT NULL, -- 'post' hoặc 'sheet'
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Bảng messages (tin nhắn chi tiết hoặc comment cụ thể)
      db.run(`
        CREATE TABLE IF NOT EXISTS bot_memory_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT DEFAULT '{}',
          embedding TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_bot_memory_type_created ON bot_memory_items(type, created_at)');

      db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          message TEXT,
          is_from_page BOOLEAN DEFAULT 0,
          created_time DATETIME,
          FOREIGN KEY(conversation_id) REFERENCES conversations(id)
        )
      `);

      // Bảng customers (Lưu CRM Profile)
      db.run(`
        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY, -- sender_id
          email TEXT DEFAULT '',
          phone TEXT DEFAULT '',
          address TEXT DEFAULT '',
          lead_score REAL DEFAULT 0,
          tags TEXT DEFAULT '[]', -- JSON array
          notes TEXT DEFAULT '[]', -- JSON array of objects
          active_automation TEXT DEFAULT ''
        )
      `, (err) => {
        // Cố gắng thêm cột address nếu bảng đã tồn tại
        db.run('ALTER TABLE customers ADD COLUMN address TEXT DEFAULT ""', () => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  });
};

export const saveConversation = (id, platform, type, sender_name, sender_id, snippet, updated_at, account_id, options = {}) => {
  return new Promise((resolve, reject) => {
    // Support DB cũ (chưa có cột)
    db.run('ALTER TABLE conversations ADD COLUMN account_id TEXT', () => {});

    const upsertConversation = (matchingConversation = null) => {
      // Kiểm tra xem conversation có tin mới không (updated_at thay đổi)
      // Nếu có tin mới từ khách → reset is_read = 0
      const stmt = db.prepare(`
        INSERT INTO conversations (id, platform, type, sender_name, sender_id, snippet, updated_at, account_id, is_read)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
          snippet=excluded.snippet,
          account_id=excluded.account_id,
          sender_name=excluded.sender_name,
          sender_id=excluded.sender_id,
          is_read = CASE
            WHEN conversations.updated_at != excluded.updated_at THEN 0
            ELSE conversations.is_read
          END,
          updated_at=excluded.updated_at
      `);
      stmt.run([id, platform, type, sender_name, sender_id, snippet, updated_at, account_id], function(err) {
        stmt.finalize();
        if (err) return reject(err);

        if (!matchingConversation) return resolve(this.lastID);

        db.serialize(() => {
          db.run(`UPDATE messages SET conversation_id = ? WHERE conversation_id = ?`, [id, matchingConversation.id], (messageErr) => {
            if (messageErr) return reject(messageErr);

            db.run(
              `UPDATE conversations
               SET is_read = CASE WHEN ? = 0 THEN 0 ELSE is_read END,
                   bot_paused = CASE WHEN ? = 1 THEN 1 ELSE bot_paused END,
                   bot_paused_at = COALESCE(?, bot_paused_at)
               WHERE id = ?`,
              [matchingConversation.is_read, matchingConversation.bot_paused, matchingConversation.bot_paused_at, id],
              (preserveErr) => {
                if (preserveErr) return reject(preserveErr);

                db.run(`DELETE FROM conversations WHERE id = ?`, [matchingConversation.id], (deleteErr) => {
                  if (deleteErr) reject(deleteErr);
                  else resolve(this.lastID);
                });
              }
            );
          });
        });
      });
    };

    if (options.mergeExisting && sender_id) {
      db.get(
        `SELECT * FROM conversations
         WHERE id != ?
           AND platform = ?
           AND type = ?
           AND sender_id = ?
           AND COALESCE(account_id, '') = COALESCE(?, '')
         ORDER BY updated_at DESC
         LIMIT 1`,
        [id, platform, type, sender_id, account_id],
        (findErr, matchingConversation) => {
          if (findErr) return reject(findErr);
          upsertConversation(matchingConversation || null);
        }
      );
    } else {
      upsertConversation();
    }
  });
};

export const saveMessage = (id, conversation_id, message, is_from_page, created_time) => {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO messages (id, conversation_id, message, is_from_page, created_time)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
      conversation_id = excluded.conversation_id,
      message = excluded.message,
      is_from_page = excluded.is_from_page,
      created_time = excluded.created_time
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
    db.all(`
      SELECT c.*,
        CASE 
          WHEN c.is_read = 0 AND (
            SELECT m.is_from_page 
            FROM messages m 
            WHERE m.conversation_id = c.id 
            ORDER BY m.created_time DESC 
            LIMIT 1
          ) = 0 THEN 1
          ELSE 0
        END as needs_reply
      FROM conversations c
      ORDER BY c.updated_at DESC
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export const getApprovedConversations = () => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM conversations
      WHERE is_approved = 1
      ORDER BY updated_at DESC
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

/**
 * Đánh dấu đã đọc một cuộc hội thoại
 */
export const markConversationAsRead = (id) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE conversations SET is_read = 1 WHERE id = ?`, [id], function(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
};

export const markConversationAsApproved = (id) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE conversations SET is_approved = 1 WHERE id = ?`, [id], function(err) {
      if (err) reject(err);
      else resolve(this.changes);
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

export const getConversationByIdentity = (platform, type, senderId, accountId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM conversations
       WHERE platform = ?
         AND type = ?
         AND sender_id = ?
         AND COALESCE(account_id, '') = COALESCE(?, '')
       ORDER BY updated_at DESC
       LIMIT 1`,
      [platform, type, senderId, accountId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
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

export const getMessageById = (id) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM messages WHERE id = ?`, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// --- Customer Profile Methods ---

export const getCustomerProfile = (id) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM customers WHERE id = ?`, [id], (err, row) => {
      if (err) {
        reject(err);
      } else if (!row) {
        // Return default profile if not exists
        resolve({
          id,
          email: '',
          phone: '',
          address: '',
          lead_score: 0,
          tags: '[]',
          notes: '[]',
          active_automation: ''
        });
      } else {
        resolve(row);
      }
    });
  });
};

export const updateCustomerProfile = (id, data) => {
  return new Promise((resolve, reject) => {
    // Create if not exists
    db.run(`INSERT OR IGNORE INTO customers (id) VALUES (?)`, [id], (err) => {
      if (err) return reject(err);
      
      // Build update query dynamically
      const fields = [];
      const values = [];
      const allowedFields = ['email', 'phone', 'address', 'lead_score', 'tags', 'notes', 'active_automation'];
      
      for (const [key, val] of Object.entries(data)) {
        if (allowedFields.includes(key)) {
          fields.push(`${key} = ?`);
          values.push(val);
        }
      }
      
      if (fields.length === 0) return resolve(); // nothing to update
      
      values.push(id);
      const query = `UPDATE customers SET ${fields.join(', ')} WHERE id = ?`;
      
      db.run(query, values, function(err2) {
        if (err2) reject(err2);
        else resolve();
      });
    });
  });
};

// --- Chatbot & Image Hash Methods ---

export const saveBotMemoryItem = (type, content, metadata = {}, embedding = null) => {
  return new Promise((resolve, reject) => {
    const metadataText = typeof metadata === 'string' ? metadata : JSON.stringify(metadata || {});
    const embeddingText = Array.isArray(embedding) ? JSON.stringify(embedding) : embedding;

    db.run(
      `INSERT INTO bot_memory_items (type, content, metadata, embedding) VALUES (?, ?, ?, ?)`,
      [type, content, metadataText, embeddingText],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            id: this.lastID,
            type,
            content,
            metadata: metadataText,
            embedding: embeddingText,
            created_at: new Date().toISOString()
          });
        }
      }
    );
  });
};

export const getBotMemoryItems = ({ types = [], limit = 300 } = {}) => {
  return new Promise((resolve, reject) => {
    const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 300, 1000));
    const cleanTypes = Array.isArray(types) ? types.filter(Boolean) : [];
    const where = cleanTypes.length > 0
      ? `WHERE type IN (${cleanTypes.map(() => '?').join(', ')})`
      : '';
    const params = [...cleanTypes, safeLimit];

    db.all(
      `SELECT * FROM bot_memory_items ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
      params,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

export const getBotMemoryItemById = (id) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM bot_memory_items WHERE id = ?`, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
};

export const updateBotPausedStatus = (conversationId, isPaused) => {
  return new Promise((resolve, reject) => {
    const pausedVal = isPaused ? 1 : 0;
    const pausedAt = isPaused ? new Date().toISOString() : null;
    db.run(
      `UPDATE conversations SET bot_paused = ?, bot_paused_at = ? WHERE id = ?`,
      [pausedVal, pausedAt, conversationId],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
};

export const saveImageHash = (hash, productSku, sourceType) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO image_hashes (hash, product_sku, source_type) VALUES (?, ?, ?)`,
      [hash, productSku, sourceType],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

export const getAllImageHashes = () => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM image_hashes`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export const clearImageHashesBySource = (sourceType) => {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM image_hashes WHERE source_type = ?`, [sourceType], function (err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
};
