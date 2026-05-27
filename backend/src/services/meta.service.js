import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ============================================================
// FACEBOOK FANPAGE
// ============================================================

/**
 * Đăng bài lên Facebook Fanpage (text hoặc ảnh đơn)
 */
export const publishToFacebook = async (content, imageUrl) => {
  try {
    const pageToken = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!pageToken) throw new Error('Thiếu FB_PAGE_ACCESS_TOKEN');

    if (!imageUrl) {
      const response = await axios.post(`${GRAPH_API_BASE}/me/feed`, null, {
        params: { message: content, access_token: pageToken }
      });
      console.log('✅ Đăng chữ lên FB thành công:', response.data);
      return response.data;
    } else {
      const response = await axios.post(`${GRAPH_API_BASE}/me/photos`, null, {
        params: { message: content, url: imageUrl, access_token: pageToken }
      });
      console.log('✅ Đăng ảnh lên FB thành công:', response.data);
      return response.data;
    }
  } catch (error) {
    console.error('❌ Lỗi khi đăng bài FB:', error.response?.data || error.message);
    throw error;
  }
};

// ============================================================
// INSTAGRAM BUSINESS — Content Publishing API
// Tài liệu: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
// ============================================================

/**
 * Resize ảnh về tỉ lệ hợp lệ cho Instagram.
 * IG yêu cầu: vuông (1:1), portrait (4:5), hoặc landscape (1.91:1)
 * - Mặc định dùng 4:5 (portrait) cho Feed đồng hồ
 * @param {string} localImagePath - Đường dẫn ảnh local (đã được upload lên hosting công khai)
 * @param {'1:1' | '4:5'} ratio - Tỉ lệ mong muốn
 */
export const getInstagramImageDimensions = (ratio = '4:5') => {
  // Instagram yêu cầu ảnh width tối thiểu 320px, tối đa 1440px
  // Dùng 1080px làm chuẩn
  const width = 1080;
  if (ratio === '1:1') return { width, height: 1080 };
  if (ratio === '4:5') return { width, height: 1350 };
  return { width, height: 1080 }; // fallback vuông
};

/**
 * Đăng 1 ảnh lên Instagram Business Account.
 * Quy trình 2 bước:
 *   1. Tạo Media Container (trả về container_id)
 *   2. Publish container
 *
 * @param {string} content      - Caption của bài đăng
 * @param {string} imageUrl     - URL công khai của ảnh (phải là HTTPS, không cần auth)
 * @param {string[]} [hashtags] - Mảng hashtag, VD: ['#dongho', '#luxury']
 */
export const publishToInstagram = async (content, imageUrl, hashtags = []) => {
  const igUserId = process.env.IG_USER_ID;
  const igToken  = process.env.IG_ACCESS_TOKEN;

  if (!igUserId || !igToken) {
    throw new Error('Thiếu IG_USER_ID hoặc IG_ACCESS_TOKEN trong .env');
  }
  if (!imageUrl) {
    throw new Error('Instagram bắt buộc phải có imageUrl (URL công khai HTTPS)');
  }

  // Ghép hashtag vào cuối caption
  const hashtagBlock = hashtags.length > 0 ? '\n\n' + hashtags.join(' ') : '';
  const caption = `${content}${hashtagBlock}`;

  console.log(`📸 [Instagram] Bước 1/2: Tạo Media Container...`);

  // --- Bước 1: Tạo container ---
  const containerRes = await axios.post(
    `${GRAPH_API_BASE}/${igUserId}/media`,
    null,
    {
      params: {
        image_url:    imageUrl,
        caption:      caption,
        access_token: igToken,
      }
    }
  );

  const containerId = containerRes.data.id;
  if (!containerId) {
    throw new Error('Không nhận được container_id từ Instagram API');
  }

  console.log(`📸 [Instagram] Container ID: ${containerId}. Đợi 3 giây rồi publish...`);
  await new Promise(r => setTimeout(r, 3000)); // IG khuyến nghị đợi trước khi publish

  // --- Bước 2: Publish container ---
  const publishRes = await axios.post(
    `${GRAPH_API_BASE}/${igUserId}/media_publish`,
    null,
    {
      params: {
        creation_id:  containerId,
        access_token: igToken,
      }
    }
  );

  const mediaId = publishRes.data.id;
  console.log(`✅ [Instagram] Đăng thành công! Media ID: ${mediaId}`);
  return { mediaId, containerId };
};

/**
 * Đăng Carousel (nhiều ảnh) lên Instagram.
 * Tối đa 10 ảnh.
 *
 * @param {string}   content   - Caption
 * @param {string[]} imageUrls - Mảng các URL công khai (HTTPS)
 * @param {string[]} [hashtags]
 */
export const publishCarouselToInstagram = async (content, imageUrls, hashtags = []) => {
  const igUserId = process.env.IG_USER_ID;
  const igToken  = process.env.IG_ACCESS_TOKEN;

  if (!igUserId || !igToken) throw new Error('Thiếu IG_USER_ID hoặc IG_ACCESS_TOKEN');
  if (!imageUrls || imageUrls.length < 2) throw new Error('Carousel cần ít nhất 2 ảnh');

  const hashtagBlock = hashtags.length > 0 ? '\n\n' + hashtags.join(' ') : '';
  const caption = `${content}${hashtagBlock}`;

  // Bước 1: Tạo container cho từng ảnh (is_carousel_item = true)
  console.log(`📸 [Instagram Carousel] Tạo ${imageUrls.length} item containers...`);
  const childIds = [];

  for (const url of imageUrls.slice(0, 10)) {
    const res = await axios.post(`${GRAPH_API_BASE}/${igUserId}/media`, null, {
      params: {
        image_url:        url,
        is_carousel_item: true,
        access_token:     igToken,
      }
    });
    childIds.push(res.data.id);
  }

  // Bước 2: Tạo Carousel container
  console.log(`📸 [Instagram Carousel] Tạo Carousel container...`);
  const carouselRes = await axios.post(`${GRAPH_API_BASE}/${igUserId}/media`, null, {
    params: {
      media_type:   'CAROUSEL',
      children:     childIds.join(','),
      caption:      caption,
      access_token: igToken,
    }
  });
  const carouselId = carouselRes.data.id;

  await new Promise(r => setTimeout(r, 3000));

  // Bước 3: Publish
  const publishRes = await axios.post(`${GRAPH_API_BASE}/${igUserId}/media_publish`, null, {
    params: { creation_id: carouselId, access_token: igToken }
  });

  const mediaId = publishRes.data.id;
  console.log(`✅ [Instagram Carousel] Đăng thành công! Media ID: ${mediaId}`);
  return { mediaId, carouselId };
};


// ============================================================
// THREADS — Threads Publishing API (Ra mắt 6/2024)
// Tài liệu: https://developers.facebook.com/docs/threads
// ============================================================

/**
 * Đăng 1 bài Threads (text-only hoặc kèm ảnh).
 *
 * @param {string}  content        - Nội dung bài đăng (tối đa 500 ký tự)
 * @param {string}  [imageUrl]     - URL ảnh công khai (nếu có)
 * @param {string}  [replyToId]    - ID bài trước (nếu muốn reply thành chuỗi)
 */
export const publishToThreads = async (content, imageUrl = null, replyToId = null) => {
  const threadsUserId = process.env.THREADS_USER_ID;
  const threadsToken  = process.env.THREADS_ACCESS_TOKEN;

  if (!threadsUserId || !threadsToken) {
    throw new Error('Thiếu THREADS_USER_ID hoặc THREADS_ACCESS_TOKEN trong .env');
  }

  // Threads giới hạn 500 ký tự
  const truncated = content.length > 500 ? content.slice(0, 497) + '...' : content;

  // --- Bước 1: Tạo Media Container ---
  const params = {
    text:         truncated,
    access_token: threadsToken,
  };

  if (imageUrl) {
    params.media_type = 'IMAGE';
    params.image_url  = imageUrl;
  } else {
    params.media_type = 'TEXT';
  }

  if (replyToId) {
    params.reply_to_id = replyToId;
  }

  console.log(`🧵 [Threads] Bước 1/2: Tạo Media Container (${params.media_type})...`);
  const containerRes = await axios.post(
    `${GRAPH_API_BASE}/${threadsUserId}/threads`,
    null,
    { params }
  );

  const containerId = containerRes.data.id;
  if (!containerId) throw new Error('Không nhận được container_id từ Threads API');

  await new Promise(r => setTimeout(r, 2000));

  // --- Bước 2: Publish ---
  console.log(`🧵 [Threads] Bước 2/2: Publishing container ${containerId}...`);
  const publishRes = await axios.post(
    `${GRAPH_API_BASE}/${threadsUserId}/threads_publish`,
    null,
    {
      params: {
        creation_id:  containerId,
        access_token: threadsToken,
      }
    }
  );

  const postId = publishRes.data.id;
  console.log(`✅ [Threads] Đăng thành công! Post ID: ${postId}`);
  return { postId, containerId };
};

/**
 * Đăng 1 CHUỖI Threads (Thread chain) từ nội dung dài.
 * Tự động phân tách content thành các đoạn <= 480 ký tự và đăng nối tiếp nhau.
 *
 * @param {string}   fullContent - Nội dung đầy đủ (sẽ tự cắt)
 * @param {string}   [imageUrl]  - Ảnh chỉ đính kèm bài đầu tiên
 */
export const publishThreadChain = async (fullContent, imageUrl = null) => {
  const CHUNK_SIZE = 480; // Để dư 20 ký tự cho số thứ tự
  const words = fullContent.split(' ');
  const chunks = [];
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).trim().length > CHUNK_SIZE) {
      if (current) chunks.push(current.trim());
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) chunks.push(current.trim());

  if (chunks.length === 0) return [];

  console.log(`🧵 [Threads Chain] Phân tách thành ${chunks.length} đoạn...`);
  const results = [];
  let previousId = null;

  for (let i = 0; i < chunks.length; i++) {
    const prefix = chunks.length > 1 ? `${i + 1}/${chunks.length} ` : '';
    const chunkContent = prefix + chunks[i];
    const useImage = i === 0 ? imageUrl : null; // Chỉ ảnh ở bài đầu tiên
    const result = await publishToThreads(chunkContent, useImage, previousId);
    results.push(result);
    previousId = result.postId;
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 1500)); // Tránh rate limit
    }
  }

  console.log(`✅ [Threads Chain] Đăng xong ${results.length} đoạn.`);
  return results;
};

// ============================================================
// REELS (VIDEO NGẮN) - FB & IG
// ============================================================

/**
 * Đăng Video Reels lên Facebook Page (Quy trình 3 bước)
 */
export const publishFBReels = async (videoPath, content) => {
  const pageToken = process.env.FB_PAGE_ACCESS_TOKEN;
  // Lấy Page ID từ Token (bằng API /me)
  const meRes = await axios.get(`${GRAPH_API_BASE}/me`, { params: { access_token: pageToken } });
  const pageId = meRes.data.id;

  console.log('🎥 [FB Reels] Bước 1: Initialize Upload...');
  const initRes = await axios.post(`${GRAPH_API_BASE}/${pageId}/video_reels`, {
    upload_phase: 'start',
    access_token: pageToken
  });
  
  const videoId = initRes.data.video_id;
  const uploadUrl = initRes.data.upload_url; // Thực chất trỏ về rupload.facebook.com

  console.log(`🎥 [FB Reels] Bước 2: Upload Video (ID: ${videoId})...`);
  const stats = fs.statSync(videoPath);
  // Sử dụng readFileSync thay vì Stream để tránh lỗi Transfer-Encoding: chunked của Axios
  const fileData = fs.readFileSync(videoPath);

  try {
    await axios.post(uploadUrl, fileData, {
      headers: {
        'Authorization': `OAuth ${pageToken}`,
        'offset': '0',
        'file_size': stats.size.toString(),
        'Content-Length': stats.size.toString(),
        'X-Entity-Length': stats.size.toString(),
        'Content-Type': 'application/octet-stream'
      }
    });
  } catch (err) {
    console.error('❌ Lỗi chi tiết FB Upload:', err.response?.data || err.message);
    throw err;
  }

  console.log(`🎥 [FB Reels] Bước 3: Finish Upload & Publish...`);
  const finishRes = await axios.post(`${GRAPH_API_BASE}/${pageId}/video_reels`, {
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    description: content,
    access_token: pageToken
  });

  console.log(`✅ [FB Reels] Đăng thành công! Video ID: ${videoId}`);
  return videoId;
};

/**
 * Đăng Video Reels lên Instagram (Dùng Resumable Upload API - Bỏ qua URL công khai)
 */
export const publishIGReels = async (videoPath, content, hashtags = []) => {
  const igUserId = process.env.IG_USER_ID;
  const igToken  = process.env.IG_ACCESS_TOKEN;

  if (!igUserId || !igToken) throw new Error('Thiếu IG_USER_ID hoặc IG_ACCESS_TOKEN');

  const hashtagBlock = hashtags.length > 0 ? '\n\n' + hashtags.join(' ') : '';
  const caption = `${content}${hashtagBlock}`;

  console.log(`🎥 [IG Reels] Bước 1: Tạo Video Container (Resumable)...`);
  const containerRes = await axios.post(
    `${GRAPH_API_BASE}/${igUserId}/media`,
    null,
    {
      params: {
        media_type: 'REELS',
        upload_type: 'resumable',
        caption: caption,
        access_token: igToken,
      }
    }
  );

  const containerId = containerRes.data.id;
  console.log(`🎥 [IG Reels] Bước 2: Bơm file Video vào Instagram (Container ID: ${containerId})...`);
  
  const stats = fs.statSync(videoPath);
  const fileData = fs.readFileSync(videoPath);

  await axios.post(
    `https://rupload.facebook.com/ig-api-upload/${GRAPH_API_VERSION}/${containerId}`,
    fileData,
    {
      headers: {
        'Authorization': `OAuth ${igToken}`,
        'offset': '0',
        'file_size': stats.size.toString(),
        'Content-Type': 'application/octet-stream'
      }
    }
  );

  console.log(`🎥 [IG Reels] Đang chờ IG xử lý video (tối đa 60s)...`);
  
  // Chờ IG xử lý (tối đa 60s)
  let status = 'IN_PROGRESS';
  let attempts = 0;
  while (status !== 'FINISHED' && attempts < 15) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await axios.get(`${GRAPH_API_BASE}/${containerId}`, {
      params: { fields: 'status_code,status', access_token: igToken }
    });
    status = statusRes.data.status_code;
    console.log(`🎥 [IG Reels] Status: ${status}`);
    
    if (status === 'ERROR') {
      console.error(`❌ [IG Reels] Chi tiết lỗi từ Instagram:`, statusRes.data.status);
      throw new Error(`Lỗi xử lý video từ phía Instagram: ${statusRes.data.status || 'Không rõ nguyên nhân'}`);
    }
    attempts++;
  }

  if (status !== 'FINISHED') throw new Error('Quá thời gian chờ xử lý IG Reels.');

  console.log(`🎥 [IG Reels] Bước 3: Publish Container...`);
  const publishRes = await axios.post(
    `${GRAPH_API_BASE}/${igUserId}/media_publish`,
    null,
    {
      params: { creation_id: containerId, access_token: igToken }
    }
  );

  const mediaId = publishRes.data.id;
  console.log(`✅ [IG Reels] Đăng thành công! Media ID: ${mediaId}`);
  return mediaId;
};
