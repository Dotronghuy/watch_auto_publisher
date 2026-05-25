import dotenv from 'dotenv';
import { publishToFacebook } from './services/meta.service.js';

// Load biến môi trường từ file .env
dotenv.config();

const testPost = async () => {
  console.log('Bắt đầu test đăng bài lên Fanpage...');
  try {
    // Test đăng chữ
    await publishToFacebook('🤖 Đây là bài post test tự động từ hệ thống Watch Auto Publisher!');
    
    // Nếu muốn test ảnh, bỏ comment dòng dưới (thay bằng link ảnh thật)
    // await publishToFacebook('Test đăng kèm ảnh', 'https://fastly.picsum.photos/id/237/200/300.jpg');
    
    console.log('Test hoàn tất!');
  } catch (error) {
    console.error('Test thất bại.');
  }
};

testPost();
