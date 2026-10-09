import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
const mask = (token) => {
  if (!token) return '(trống)';
  return `${token.slice(0, 6)}...${token.slice(-4)} (${token.length} ký tự)`;
};

const accounts = JSON.parse(fs.readFileSync('./config/accounts.json', 'utf8'));

const PERMISSIONS_NEEDED = [
  'publish_video',
  'pages_manage_posts',
  'pages_read_engagement',
  'pages_show_list',
  'pages_manage_metadata',
];

console.log('=== Kiểm tra quyền Facebook cho đăng Story video ===\n');

for (const acc of accounts) {
  if (!acc.fbAccessToken) continue;
  console.log(`Tài khoản: ${acc.name} (${acc.id})`);
  console.log(`Page ID trong file: "${acc.fbPageId}"`);
  console.log(`Token: ${mask(acc.fbAccessToken)}`);
  try {
    const meRes = await axios.get(`${GRAPH_API_BASE}/me`, {
      params: { fields: 'id,name', access_token: acc.fbAccessToken },
    });
    console.log(`  /me → id=${meRes.data.id} name=${meRes.data.name}`);

    const permRes = await axios.get(`${GRAPH_API_BASE}/me/permissions`, {
      params: { access_token: acc.fbAccessToken },
    });
    const granted = new Set((permRes.data.data || []).filter((p) => p.status === 'granted').map((p) => p.permission));
    console.log('  Quyền đã được cấp (granted):');
    for (const p of PERMISSIONS_NEEDED) {
      const ok = granted.has(p);
      console.log(`    ${ok ? '✅' : '❌'} ${p}${ok ? '' : '  ← CẦN DUYỆT THÊM (App Review)'}`);
    }

    const pagesRes = await axios.get(`${GRAPH_API_BASE}/me/accounts`, {
      params: { fields: 'id,name', access_token: acc.fbAccessToken },
    });
    console.log('  Fanpage truy cập được:');
    for (const page of pagesRes.data.data || []) {
      console.log(`    - ${page.name} (id=${page.id})`);
    }
  } catch (error) {
    console.log(`  ❌ Lỗi gọi API: ${error.response?.data?.error?.message || error.message}`);
    if (error.response?.data?.error?.code === 190) {
      console.log('  → Token đã hết hạn hoặc bị thu hồi (code 190).');
    }
  }
  console.log('');
}

if (process.env.FB_PAGE_ACCESS_TOKEN) {
  console.log(`Token FB_PAGE_ACCESS_TOKEN trong .env: ${mask(process.env.FB_PAGE_ACCESS_TOKEN)}`);
  try {
    const meRes = await axios.get(`${GRAPH_API_BASE}/me`, {
      params: { fields: 'id,name', access_token: process.env.FB_PAGE_ACCESS_TOKEN },
    });
    console.log(`  /me → id=${meRes.data.id} name=${meRes.data.name}`);
    const permRes = await axios.get(`${GRAPH_API_BASE}/me/permissions`, {
      params: { access_token: process.env.FB_PAGE_ACCESS_TOKEN },
    });
    const granted = new Set((permRes.data.data || []).filter((p) => p.status === 'granted').map((p) => p.permission));
    for (const p of PERMISSIONS_NEEDED) {
      console.log(`    ${granted.has(p) ? '✅' : '❌'} ${p}`);
    }
  } catch (error) {
    console.log(`  ❌ Lỗi: ${error.response?.data?.error?.message || error.message}`);
  }
} else {
  console.log('FB_PAGE_ACCESS_TOKEN trong .env: (không có)');
}
