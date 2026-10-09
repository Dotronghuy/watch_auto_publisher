import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
const mask = (token) => {
  if (!token) return '(trống)';
  return `${token.slice(0, 6)}...${token.slice(-4)} (${token.length} ký tự)`;
};

const accounts = JSON.parse(fs.readFileSync('./config/accounts.json', 'utf8'));

// Theo docs chính thức của Meta (Page Stories API):
//   1. Upload video bằng Resumable Upload: POST /{page_id}/videos (upload_phase=start/transfer/finish)
//   2. Đăng story: POST /{page_id}/video_stories  với  video_id + upload_phase=finish
// Quyền cần: pages_manage_posts (Advanced), publish_video (để upload video).
const probeToken = async (label, token, pageId) => {
  console.log(`\n=== ${label} ===`);
  console.log(`Token: ${mask(token)}`);

  try {
    const meRes = await axios.get(`${GRAPH_API_BASE}/me`, {
      params: { fields: 'id,name', access_token: token }
    });
    const me = meRes.data;
    console.log(`  /me -> id=${me.id} name=${me.name}`);
    const targetPageId = (pageId || '').trim() || me.id;
    if ((pageId || '').trim() && String(targetPageId) !== String(me.id)) {
      console.log(`  ⚠️ Page ID trong file (${targetPageId}) KHÁC token owner (${me.id}). Dùng token owner (${me.id}) để test.`);
    }
    const useId = targetPageId;

    // Probe 1: endpoint story đúng theo docs
    try {
      await axios.post(`${GRAPH_API_BASE}/${useId}/video_stories`, null, {
        params: {
          video_id: '123456789',   // giả — đảm bảo không đăng gì thật
          upload_phase: 'finish',
          access_token: token
        }
      });
      console.log('  ⚠️ /video_stories trả THÀNH CÔNG?! (bất thường với video_id giả)');
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      const code = e.response?.data?.error?.code;
      console.log(`  🔍 POST /video_stories (video_id giả) -> (${code}) ${msg}`);
      if (/unknown path/i.test(msg)) {
        console.log('     => Endpoint KHÔNG tồn tại với token này (khác docs hoặc page không đủ điều kiện)');
      } else if (/permission|requires/i.test(msg)) {
        console.log('     => Endpoint TỒN TẠI nhưng THIẾU QUYỀN');
      } else {
        console.log('     => Endpoint TỒN TẠI, quyền ĐỦ — lỗi chỉ do video_id giả ✅');
      }
    }

    // Probe 2: quyền publish_video qua Resumable Upload (upload_phase=start)
    try {
      await axios.post(`${GRAPH_API_BASE}/${useId}/videos`, null, {
        params: {
          upload_phase: 'start',
          file_size: 1,
          access_token: token
        }
      });
      console.log('  ⚠️ /videos upload_phase=start trả THÀNH CÔNG?! (bất thường)');
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      const code = e.response?.data?.error?.code;
      console.log(`  🔍 POST /videos upload_phase=start -> (${code}) ${msg}`);
      if (/publish_video|permission|requires/i.test(msg)) {
        console.log('     => THIẾU publish_video ❌');
      } else {
        console.log('     => publish_video ĐỦ ✅ (lỗi do file_size giả)');
      }
    }

    // Probe 3: đọc engagement (pages_read_engagement) — cần để theo dõi trạng thái
    try {
      await axios.get(`${GRAPH_API_BASE}/${useId}`, {
        params: { fields: 'id,name', access_token: token }
      });
      console.log('  ✅ pages_read_engagement (đọc page): OK');
    } catch (e) {
      console.log(`  ❌ Đọc page lỗi: ${e.response?.data?.error?.message || e.message}`);
    }
  } catch (e) {
    const code = e.response?.data?.error?.code;
    const msg = e.response?.data?.error?.message || e.message;
    console.log(`  ❌ /me LỖI (${code}): ${msg}`);
    if (code === 190) console.log('  → Token hết hạn hoặc bị thu hồi. Cần đăng nhập lại.');
  }
};

console.log('=== Thăm dò quyền Story video (endpoint ĐÚNG theo docs: video_stories) ===');
console.log('Lưu ý: dùng video_id/file_size GIẢ nên không có gì được đăng lên thật.\n');

for (const acc of accounts) {
  await probeToken(`Tài khoản trong accounts.json: ${acc.name}`, acc.fbAccessToken, acc.fbPageId);
}

await probeToken('Token FB_PAGE_ACCESS_TOKEN trong .env', process.env.FB_PAGE_ACCESS_TOKEN, '');
