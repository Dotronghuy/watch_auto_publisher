import 'dotenv/config';
import axios from 'axios';

const TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const API = 'https://graph.facebook.com/v25.0'; // Dùng version mới nhất như Graph Explorer

async function diagnose2() {
  console.log('=== CHẨN ĐOÁN CHUYÊN SÂU ===\n');

  // 1. Debug token - xem nó thuộc App nào, hạn bao giờ
  console.log('--- BƯỚC 1: Debug Token trong .env ---');
  try {
    const debugRes = await axios.get(`${API}/debug_token`, {
      params: { input_token: TOKEN, access_token: TOKEN }
    });
    const d = debugRes.data.data;
    console.log('App ID:', d.app_id);
    console.log('Type:', d.type);
    console.log('Profile ID:', d.profile_id);
    console.log('Expires At:', d.expires_at === 0 ? 'KHÔNG BAO GIỜ HẾT HẠN' : new Date(d.expires_at * 1000).toISOString());
    console.log('Is Valid:', d.is_valid);
    console.log('Scopes:', d.scopes?.join(', '));
  } catch (e) {
    console.log('❌ Lỗi debug token:', e.response?.data?.error?.message || e.message);
  }

  // 2. Đọc post text vừa tạo ở script trước
  const testPostId = '269847139549241_122231315648283911';
  console.log('\n--- BƯỚC 2: Kiểm tra bài TEXT đã đăng lúc nãy ---');
  try {
    const postRes = await axios.get(`${API}/${testPostId}`, {
      params: { fields: 'id,message,is_published,is_hidden,created_time,permalink_url,timeline_visibility', access_token: TOKEN }
    });
    console.log('Kết quả:', JSON.stringify(postRes.data, null, 2));
  } catch (e) {
    console.log('❌ Lỗi đọc bài viết:', e.response?.data?.error?.message || e.message);
  }

  // 3. Thử đăng bài text bằng PAGE ID cụ thể thay vì /me
  const PAGE_ID = '269847139549241';
  console.log(`\n--- BƯỚC 3: Đăng bài TEXT bằng PAGE ID (${PAGE_ID}) thay vì /me ---`);
  try {
    const testRes = await axios.post(`${API}/${PAGE_ID}/feed`, {
      message: '📋 [TEST 2] Bài kiểm tra bằng Page ID trực tiếp - ' + new Date().toLocaleTimeString('vi-VN'),
      published: true,
      access_token: TOKEN
    });
    console.log('✅ Đăng thành công! Post ID:', testRes.data.id);
    
    // Đọc lại ngay
    const checkRes = await axios.get(`${API}/${testRes.data.id}`, {
      params: { fields: 'id,message,is_published,is_hidden,permalink_url,timeline_visibility', access_token: TOKEN }
    });
    console.log('Trạng thái:', JSON.stringify(checkRes.data, null, 2));
  } catch (e) {
    console.log('❌ Lỗi:', JSON.stringify(e.response?.data?.error || e.message, null, 2));
  }

  // 4. Liệt kê TẤT CẢ bài viết (published + unpublished) qua published_posts
  console.log(`\n--- BƯỚC 4: Liệt kê bài viết qua /${PAGE_ID}/published_posts ---`);
  try {
    const feedRes = await axios.get(`${API}/${PAGE_ID}/published_posts`, {
      params: { fields: 'id,message,created_time,is_published,is_hidden,timeline_visibility,type', limit: 10, access_token: TOKEN }
    });
    const posts = feedRes.data.data;
    console.log(`Tìm thấy ${posts.length} bài viết đã xuất bản:`);
    for (const post of posts) {
      console.log(`  [${post.created_time}] ID: ${post.id}`);
      console.log(`    published=${post.is_published} | hidden=${post.is_hidden} | visibility=${post.timeline_visibility} | type=${post.type}`);
      console.log(`    Nội dung: ${(post.message || '(không có text)').substring(0, 60)}`);
      console.log('');
    }
  } catch (e) {
    console.log('❌ Lỗi:', e.response?.data?.error?.message || e.message);
  }

  console.log('\n=== KẾT THÚC ===');
}

diagnose2().catch(err => console.error('Lỗi:', err));
