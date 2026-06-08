import 'dotenv/config';
import axios from 'axios';

const TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const API = 'https://graph.facebook.com/v19.0';

async function diagnose() {
  console.log('=== CHẨN ĐOÁN FACEBOOK API ===\n');

  // 1. Kiểm tra token thuộc về ai (User hay Page?)
  console.log('--- BƯỚC 1: Kiểm tra Token thuộc về AI? ---');
  try {
    const meRes = await axios.get(`${API}/me`, {
      params: { fields: 'id,name,category,access_token', access_token: TOKEN }
    });
    console.log('Token thuộc về:', JSON.stringify(meRes.data, null, 2));
    
    if (meRes.data.category) {
      console.log('✅ ĐÂY LÀ PAGE ACCESS TOKEN (Page:', meRes.data.name, ')');
    } else {
      console.log('⚠️ ĐÂY CÓ THỂ LÀ USER ACCESS TOKEN! (Tên:', meRes.data.name, ')');
    }
  } catch (e) {
    console.log('❌ Lỗi kiểm tra token:', e.response?.data?.error || e.message);
  }

  // 2. Kiểm tra quyền token
  console.log('\n--- BƯỚC 2: Kiểm tra quyền (Permissions) của Token ---');
  try {
    const permRes = await axios.get(`${API}/me/permissions`, {
      params: { access_token: TOKEN }
    });
    const perms = permRes.data.data;
    console.log('Tổng số quyền:', perms.length);
    const granted = perms.filter(p => p.status === 'granted').map(p => p.permission);
    const declined = perms.filter(p => p.status !== 'granted').map(p => p.permission);
    console.log('✅ Đã cấp:', granted.join(', '));
    if (declined.length) console.log('❌ Bị từ chối:', declined.join(', '));
    
    // Kiểm tra các quyền quan trọng
    const required = ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'];
    for (const perm of required) {
      if (!granted.includes(perm)) {
        console.log(`🚨 THIẾU QUYỀN QUAN TRỌNG: ${perm}`);
      }
    }
  } catch (e) {
    console.log('❌ Lỗi kiểm tra quyền:', e.response?.data?.error || e.message);
  }

  // 3. Đọc 5 bài viết gần nhất trên Feed
  console.log('\n--- BƯỚC 3: Đọc các bài viết gần nhất trên Feed của Page ---');
  try {
    const feedRes = await axios.get(`${API}/me/feed`, {
      params: { fields: 'id,message,created_time,is_published,is_hidden,type,status_type', limit: 5, access_token: TOKEN }
    });
    const posts = feedRes.data.data;
    if (posts.length === 0) {
      console.log('⚠️ KHÔNG CÓ BÀI VIẾT NÀO trên Feed!');
    } else {
      console.log(`Tìm thấy ${posts.length} bài viết:`);
      for (const post of posts) {
        console.log(`  - ID: ${post.id}`);
        console.log(`    Ngày: ${post.created_time}`);
        console.log(`    Loại: ${post.type || 'N/A'} | Status Type: ${post.status_type || 'N/A'}`);
        console.log(`    is_published: ${post.is_published} | is_hidden: ${post.is_hidden}`);
        console.log(`    Nội dung: ${(post.message || '').substring(0, 80)}...`);
        console.log('');
      }
    }
  } catch (e) {
    console.log('❌ Lỗi đọc Feed:', e.response?.data?.error || e.message);
  }

  // 4. Thử đăng 1 bài viết CHỈ CÓ TEXT (không có ảnh) để kiểm tra Feed
  console.log('\n--- BƯỚC 4: Thử đăng 1 bài viết TEXT lên Newsfeed ---');
  try {
    const testRes = await axios.post(`${API}/me/feed`, {
      message: '🔧 [TEST CHẨN ĐOÁN] Bài viết thử nghiệm từ API - ' + new Date().toLocaleTimeString('vi-VN'),
      published: true,
      access_token: TOKEN
    });
    console.log('✅ Đăng TEXT thành công! Post ID:', testRes.data.id);
    console.log('🌐 Link:', `https://facebook.com/${testRes.data.id}`);
    
    // Đọc lại bài vừa đăng để kiểm tra trạng thái
    console.log('\n--- BƯỚC 4b: Đọc lại bài vừa đăng ---');
    const checkRes = await axios.get(`${API}/${testRes.data.id}`, {
      params: { fields: 'id,message,is_published,is_hidden,created_time,timeline_visibility', access_token: TOKEN }
    });
    console.log('Trạng thái bài viết:', JSON.stringify(checkRes.data, null, 2));
  } catch (e) {
    console.log('❌ Lỗi đăng TEXT:', JSON.stringify(e.response?.data?.error || e.message, null, 2));
  }

  console.log('\n=== KẾT THÚC CHẨN ĐOÁN ===');
}

diagnose().catch(err => console.error('Lỗi nghiêm trọng:', err));
