import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';

const accounts = JSON.parse(fs.readFileSync('./config/accounts.json', 'utf8'));
const acc = accounts[0]; // Vua Đồng Hồ

console.log('=== Testing Facebook Comments API ===');
console.log(`Account: ${acc.name}`);
console.log(`Page ID: ${acc.fbPageId}`);

// Test 1: me/posts
try {
  console.log('\n--- Test 1: GET /me/posts ---');
  const res = await axios.get('https://graph.facebook.com/v21.0/me/posts', {
    params: {
      fields: 'id,message,created_time,comments.limit(5){id,message,created_time,from}',
      access_token: acc.fbAccessToken,
      limit: 10
    }
  });
  const posts = res.data.data || [];
  console.log(`Posts returned: ${posts.length}`);
  posts.forEach((p, i) => {
    const cmts = p.comments?.data || [];
    console.log(`  [${i}] ID: ${p.id} | Cmts: ${cmts.length} | "${(p.message || '').substring(0, 50)}..."`);
    cmts.forEach(c => console.log(`      → [${c.from?.name || c.from?.id}] ${c.message?.substring(0, 60)}`));
  });
} catch (e) {
  console.log('ERROR:', e.response?.data?.error || e.message);
}

// Test 2: page_id/feed (includes visitor posts + page posts)
try {
  console.log('\n--- Test 2: GET /{pageId}/feed ---');
  const pageId = acc.fbPageId.trim();
  const res = await axios.get(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
    params: {
      fields: 'id,message,created_time,comments.limit(5){id,message,created_time,from}',
      access_token: acc.fbAccessToken,
      limit: 10
    }
  });
  const posts = res.data.data || [];
  console.log(`Posts returned: ${posts.length}`);
  posts.forEach((p, i) => {
    const cmts = p.comments?.data || [];
    console.log(`  [${i}] ID: ${p.id} | Cmts: ${cmts.length} | "${(p.message || '').substring(0, 50)}..."`);
    cmts.forEach(c => console.log(`      → [${c.from?.name || c.from?.id}] ${c.message?.substring(0, 60)}`));
  });
} catch (e) {
  console.log('ERROR:', e.response?.data?.error || e.message);
}

// Test 3: published_posts (all published posts by page)
try {
  console.log('\n--- Test 3: GET /{pageId}/published_posts ---');
  const pageId = acc.fbPageId.trim();
  const res = await axios.get(`https://graph.facebook.com/v21.0/${pageId}/published_posts`, {
    params: {
      fields: 'id,message,created_time,comments.limit(5){id,message,created_time,from}',
      access_token: acc.fbAccessToken,
      limit: 10
    }
  });
  const posts = res.data.data || [];
  console.log(`Posts returned: ${posts.length}`);
  posts.forEach((p, i) => {
    const cmts = p.comments?.data || [];
    console.log(`  [${i}] ID: ${p.id} | Cmts: ${cmts.length} | "${(p.message || '').substring(0, 50)}..."`);
    cmts.forEach(c => console.log(`      → [${c.from?.name || c.from?.id}] ${c.message?.substring(0, 60)}`));
  });
} catch (e) {
  console.log('ERROR:', e.response?.data?.error || e.message);
}
