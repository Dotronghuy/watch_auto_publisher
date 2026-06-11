import { initCRMDB, getConversations } from './backend/src/utils/crm.db.js';
import { autoTagAllConversations } from './backend/src/services/autotag.service.js';
import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.resolve('./backend/data/crm.sqlite');

const run = async () => {
  console.log('1. Khởi tạo DB...');
  await initCRMDB();
  
  console.log('2. Xóa toàn bộ tags cũ trong DB...');
  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    db.run('UPDATE customers SET tags = "[]"', [], (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
  
  console.log('3. Lấy toàn bộ conversations...');
  const convs = await getConversations();
  
  console.log(`4. Bắt đầu quét lại tags cho ${convs.length} cuộc trò chuyện...`);
  await autoTagAllConversations(convs);
  
  console.log('✅ Hoàn tất! Bạn có thể F5 lại trình duyệt.');
  process.exit(0);
};

run().catch(e => {
  console.error(e);
  process.exit(1);
});
