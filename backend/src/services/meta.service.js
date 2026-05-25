import axios from 'axios';

// Đăng bài lên Facebook Fanpage
export const publishToFacebook = async (content, imageUrl) => {
  try {
    const pageToken = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!pageToken) throw new Error('Thiếu FB_PAGE_ACCESS_TOKEN');

    // Nếu chỉ có nội dung (text)
    if (!imageUrl) {
      const response = await axios.post(`https://graph.facebook.com/v19.0/me/feed`, null, {
        params: {
          message: content,
          access_token: pageToken
        }
      });
      console.log('✅ Đăng chữ lên FB thành công:', response.data);
      return response.data;
    } 
    // Nếu có ảnh
    else {
      const response = await axios.post(`https://graph.facebook.com/v19.0/me/photos`, null, {
        params: {
          message: content,
          url: imageUrl,
          access_token: pageToken
        }
      });
      console.log('✅ Đăng ảnh lên FB thành công:', response.data);
      return response.data;
    }
  } catch (error) {
    console.error('❌ Lỗi khi đăng bài FB:', error.response?.data || error.message);
    throw error;
  }
};

export const publishToInstagram = async (content, imageUrl) => {
  // Logic to post
};
