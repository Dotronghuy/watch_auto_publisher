import axios from 'axios';
import { getPostsToTrack, updatePostMetrics } from '../utils/history.js';
import { generateContentOnChatGPT } from './playwright.service.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const trackPostMetrics = async () => {
    try {
        const posts = await getPostsToTrack();
        if (!posts || posts.length === 0) return;

        // Đọc danh sách tài khoản active từ accounts.json
        const accountsPath = path.resolve(__dirname, '../../config/accounts.json');
        let accounts = [];
        try {
            if (fs.existsSync(accountsPath)) {
                accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')).filter(a => a.isActive);
            }
        } catch (e) {
            console.error('Không thể đọc accounts.json:', e);
            return;
        }

        if (accounts.length === 0) {
            console.warn('⚠️ Không có tài khoản nào active để lấy metrics!');
            return;
        }

        for (const post of posts) {
            let likes = 0;
            let comments = 0;
            let shares = 0;
            let success = false;

            if (post.platform === 'facebook' || post.platform === 'facebook_reels') {
                // Thử tìm account phù hợp dựa trên pageId (post_id format: pageId_postId)
                let accountToUse = null;
                const parts = post.post_id.split('_');
                if (parts.length > 1) {
                    const pageId = parts[0];
                    accountToUse = accounts.find(a => a.fbPageId && a.fbPageId.trim() === pageId);
                }
                
                const accountsToTry = accountToUse ? [accountToUse] : accounts;

                for (const account of accountsToTry) {
                    if (!account.fbAccessToken) continue;
                    try {
                        const res = await axios.get(`https://graph.facebook.com/v19.0/${post.post_id}?fields=reactions.summary(total_count),comments.summary(total_count),shares&access_token=${account.fbAccessToken}`);
                        if (res.data.reactions) likes = res.data.reactions.summary.total_count;
                        if (res.data.comments) comments = res.data.comments.summary.total_count;
                        if (res.data.shares) shares = res.data.shares.count || 0;
                        success = true;
                        break; // Nếu lấy được thì thoát vòng lặp account
                    } catch (e) {
                        // Bỏ qua lỗi 400 nếu đang thử nhiều account, chỉ log khi thử account cuối cùng
                    }
                }
                if (!success) console.log(`⚠️ Không lấy được metrics FB cho post ${post.post_id}`);
            } else if (post.platform === 'instagram') {
                // Với IG, ID không chứa userId, nên thử với tất cả các tài khoản IG active
                for (const account of accounts) {
                    if (!account.igAccessToken) continue;
                    try {
                        const res = await axios.get(`https://graph.facebook.com/v19.0/${post.post_id}?fields=like_count,comments_count&access_token=${account.igAccessToken}`);
                        if (res.data.like_count) likes = res.data.like_count;
                        if (res.data.comments_count) comments = res.data.comments_count;
                        success = true;
                        break;
                    } catch (e) {
                        // Thử account tiếp theo
                    }
                }
                if (!success) console.log(`⚠️ Không lấy được metrics IG cho post ${post.post_id}`);
            }

            // Update in DB
            await updatePostMetrics(post.post_id, likes, comments, shares);
            
            // Phân tích nếu bài viết tốt (Feedback loop)
            // Ngưỡng ví dụ: 5 likes hoặc 2 comments -> Báo cáo lại cho ChatGPT
            if (likes >= 5 || comments >= 2) {
                console.log(`🔥 Bài viết ${post.post_id} đang có tương tác tốt (${likes} Likes, ${comments} Comments). Đang gửi Feedback cho AI...`);
                
                // Toggle Check: Tracking Feedback
                const allowTracking = await prisma.setting.findUnique({ where: { key: 'gemini_allow_tracking' } });
                if (allowTracking && allowTracking.value === 'false') {
                  console.log('[Toggle] ❌ Tracking Feedback AI bị TẮT. Bỏ qua feedback loop.');
                  continue;
                }

                // 1. Feedback cho Content (Text)
                const taskType = post.platform === 'instagram' ? 'ig' : 'fb';
                const textFeedbackPrompt = `[HỆ THỐNG BÁO CÁO KẾT QUẢ]:
Bài viết bạn tạo ra cho sản phẩm SKU ${post.sku} vừa đạt kết quả rất tốt trên mạng xã hội (${likes} Lượt thích, ${comments} Bình luận).
Nội dung bạn đã viết:
"${post.content}"

Hãy ghi nhớ phong cách này, những từ khóa đã dùng, và áp dụng nó để tạo ra các nội dung tương tự hoặc tốt hơn trong tương lai. Chỉ cần trả lời ngắn gọn: "Đã ghi nhận, tôi sẽ phát huy phong cách này!".`;
                
                // 2. Feedback cho Image (Ảnh)
                const imageFeedbackPrompt = `[HỆ THỐNG BÁO CÁO KẾT QUẢ]:
Bức ảnh bạn vừa tạo ra cho sản phẩm SKU ${post.sku} vừa được đăng tải và đạt tương tác rất tốt (${likes} Lượt thích, ${comments} Bình luận). 
Khách hàng rất thích cách bạn ghép chiếc đồng hồ vào bối cảnh bức ảnh mẫu.

Hãy ghi nhớ: Bố cục, cách đánh sáng, độ đổ bóng và phong cách chân thực của bức ảnh vừa rồi. Hãy coi đó là tiêu chuẩn "TỐT" để áp dụng cho các lần tạo ảnh tiếp theo. Tuyệt đối tránh việc sinh ra ảnh nhìn giả tạo. Không cần tạo ảnh mới ngay bây giờ, chỉ cần trả lời: "Đã ghi nhận, tôi sẽ tiếp tục phong cách ghép ảnh chân thực này!".`;

                try {
                    // Send feedback to ChatGPT Content
                    await generateContentOnChatGPT(textFeedbackPrompt, taskType, null);
                    // Send feedback to ChatGPT Image (tái sử dụng hàm với tham số bí mật 'image_feedback')
                    await generateContentOnChatGPT(imageFeedbackPrompt, 'image_feedback', null);
                    console.log('✅ Đã gửi Feedback huấn luyện cho cả AI Viết Content và AI Tạo Ảnh thành công.');
                } catch (err) {
                    console.log(`⚠️ Lỗi khi gửi feedback cho AI: ${err.message}`);
                }
            }
        }
    } catch (e) {
        console.error('Lỗi trong tiến trình Tracking:', e);
    }
};
