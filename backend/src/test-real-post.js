import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { getFolderIdByName, getImagesInFolder, downloadFileFromDrive, getFoldersInFolder } from './services/drive.service.js';

dotenv.config();

// Link Webhook của n8n (Dùng 127.0.0.1 thay vì localhost để tránh lỗi IPv6 của Node)
const N8N_WEBHOOK_URL = 'http://127.0.0.1:5678/webhook-test/test-ai';
const ROOT_DRIVE_FOLDER_ID = '1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl'; // Thư mục Media_Dong_Ho

const runRealTest = async () => {
  console.log('🚀 Bắt đầu kịch bản đăng bài ảnh thật từ Google Drive...');
  
  try {
    // 1. LẤY RANDOM 1 THƯ MỤC SKU
    console.log('1. Đang quét danh sách các mã SKU trong thư mục Media_Dong_Ho...');
    const skuFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    
    if (skuFolders.length === 0) {
      throw new Error('Không tìm thấy thư mục SKU nào trong thư mục gốc!');
    }

    // Chọn ngẫu nhiên 1 thư mục SKU
    const randomSkuFolder = skuFolders[Math.floor(Math.random() * skuFolders.length)];
    console.log(`=> Đã chọn ngẫu nhiên mã SKU: ${randomSkuFolder.name} (ID: ${randomSkuFolder.id})`);

    // 2. TÌM FOLDER '0_Anh_AVT' TRONG MÃ SKU ĐÓ
    console.log(`2. Đang tìm thư mục 0_Anh_AVT bên trong mã ${randomSkuFolder.name}...`);
    const targetFolderId = await getFolderIdByName('0_Anh_AVT', randomSkuFolder.id);
    
    if (!targetFolderId) {
      throw new Error(`Mã SKU ${randomSkuFolder.name} không có thư mục con '0_Anh_AVT'! Vui lòng chạy lại để bốc mã khác.`);
    }

    console.log('=> Đang quét ảnh trong thư mục 0_Anh_AVT...');
    const images = await getImagesInFolder(targetFolderId);
    if (images.length === 0) throw new Error(`Thư mục 0_Anh_AVT của mã ${randomSkuFolder.name} hiện không có ảnh nào!`);
    
    // Lấy ảnh đầu tiên (hoặc có thể random tiếp ảnh trong list này)
    const imageToPost = images[Math.floor(Math.random() * images.length)];
    
    // 3. TẢI ẢNH VỀ MÁY CỤC BỘ (Bằng Stream)
    console.log(`3. Phát hiện ảnh: ${imageToPost.name}. Chuẩn bị tải về máy chủ...`);
    const localFilePath = await downloadFileFromDrive(imageToPost.id, imageToPost.name);

    // 4. GỌI WEBHOOK N8N (Giả lập)
    console.log('4. Đang gửi ảnh cho n8n để AI viết bài...');
    let postContent = '';
    
    try {
      // Tạm thời chỉ gửi chữ (JSON) cho n8n để test kết nối trước khi nhét nguyên cái file ảnh nặng vào
      const n8nResponse = await axios.post(N8N_WEBHOOK_URL, {
        filename: imageToPost.name,
        sku: randomSkuFolder.name
      });
      
      // Lấy data từ n8n, phòng trường hợp n8n trả về key tên là 'text' thay vì 'content'
      const resData = n8nResponse.data;
      postContent = resData.content || resData.text || resData.message || (typeof resData === 'string' ? resData : JSON.stringify(resData));
      
      if (!postContent || postContent === 'undefined') {
        postContent = 'Cảnh báo: n8n có trả dữ liệu về nhưng Node.js không đọc được (Data: ' + JSON.stringify(resData) + ')';
      }
    } catch (n8nError) {
      console.log(`⚠️ Không thể kết nối tới n8n. Lỗi chi tiết: ${n8nError.message}`);
      if (n8nError.response) console.log('Chi tiết từ n8n:', n8nError.response.data);
      console.log('=> Dùng Text mặc định...');
      postContent = `🤖 [TEST RANDOM SKU TỪ DRIVE]\nĐây là nội dung được tự động sinh cho mã đồng hồ: ${randomSkuFolder.name}.\nTên file ảnh: ${imageToPost.name}`;
    }

    // 5. ĐĂNG BÀI LÊN FANPAGE FACEBOOK
    console.log('5. Bắt đầu đăng lên Fanpage...');
    const pageToken = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!pageToken) throw new Error('Thiếu FB_PAGE_ACCESS_TOKEN trong file .env');

    const fbFormData = new FormData();
    fbFormData.append('source', fs.createReadStream(localFilePath));
    fbFormData.append('message', postContent);
    fbFormData.append('access_token', pageToken);

    const fbResponse = await axios.post(`https://graph.facebook.com/v19.0/me/photos`, fbFormData, {
      headers: { ...fbFormData.getHeaders() }
    });

    console.log('✅ Đăng bài hoàn tất! Kết quả FB:', fbResponse.data);

    // 6. DỌN DẸP
    fs.unlinkSync(localFilePath);
    console.log('🗑️ Đã xóa file tạm trên máy tính.');

  } catch (error) {
    console.error('❌ Kịch bản thất bại:', error.response?.data || error.message);
  }
};

runRealTest();
