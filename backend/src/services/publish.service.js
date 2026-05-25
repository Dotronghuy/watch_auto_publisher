import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { getFolderIdByName, getImagesInFolder, downloadFileFromDrive, getFoldersInFolder } from './drive.service.js';
import { getProductInfoBySku } from './sheet.service.js';
import { getPostedImageIds, addPostedImageId } from '../utils/history.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://127.0.0.1:5678/webhook-test/test-ai';
const ROOT_DRIVE_FOLDER_ID = process.env.ROOT_DRIVE_FOLDER_ID || '1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl';

export const autoPublishRoutine = async () => {
  console.log('🤖 Bắt đầu tiến trình tự động đăng bài (GIAI ĐOẠN 3)...');
  let localFilePaths = [];
  
  try {
    const skuFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    if (skuFolders.length === 0) throw new Error('Không tìm thấy thư mục SKU nào trong Drive!');

    const postedIds = await getPostedImageIds();
    const shuffledSkus = skuFolders.sort(() => 0.5 - Math.random());
    
    const folderTypes = ['0_Anh_AVT', '1_Anh_Hang', '2_Anh_Tu_Chup'];
    let selectedImages = [];
    let selectedSku = null;
    let postMode = 'SINGLE'; // SINGLE (AI) hoặc ALBUM

    // Tìm ảnh chưa đăng
    for (const skuFolder of shuffledSkus) {
      // Trộn ngẫu nhiên thứ tự ưu tiên các loại thư mục
      const shuffledFolderTypes = [...folderTypes].sort(() => 0.5 - Math.random());
      
      for (const folderName of shuffledFolderTypes) {
        const targetFolderId = await getFolderIdByName(folderName, skuFolder.id);
        if (!targetFolderId) continue;

        const images = await getImagesInFolder(targetFolderId);
        const freshImages = images.filter(img => !postedIds.includes(img.id));
        
        if (freshImages.length > 0) {
          selectedSku = skuFolder;
          
          if (folderName === '0_Anh_AVT') {
            // Chế độ AI thay phông nền: Lấy 1 tấm
            selectedImages = [freshImages[Math.floor(Math.random() * freshImages.length)]];
            postMode = 'AI';
          } else {
            // Chế độ Album: Bốc ngẫu nhiên 4-8 tấm
            const numToPick = Math.min(freshImages.length, Math.floor(Math.random() * 5) + 4); // Random 4 đến 8
            // Trộn ảnh ngẫu nhiên rồi lấy N tấm đầu tiên
            selectedImages = freshImages.sort(() => 0.5 - Math.random()).slice(0, numToPick);
            postMode = 'ALBUM';
          }
          break;
        }
      }
      
      if (selectedImages.length > 0) break; // Thoát vòng lặp ngoài nếu đã tìm được
    }

    if (selectedImages.length === 0) {
      throw new Error('Đã hết sạch ảnh mới chưa đăng trong tất cả các mã SKU. Cần thêm ảnh mới vào Drive!');
    }

    console.log(`=> Đã chọn [Chế độ ${postMode}] - SKU: ${selectedSku.name} - Số lượng ảnh: ${selectedImages.length}`);

    // 2. Tải tất cả ảnh về
    for (const img of selectedImages) {
      const path = await downloadFileFromDrive(img.id, img.name);
      localFilePaths.push(path);
    }

    // 3. Gửi toàn bộ dữ liệu (và File ảnh) sang Webhook của n8n
    let postContent = '';
    try {
      const productInfo = await getProductInfoBySku(selectedSku.name);
      const productInfoText = productInfo ? Object.entries(productInfo).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
      
      const n8nFormData = new FormData();
      n8nFormData.append('filename', selectedImages[0].name);
      n8nFormData.append('sku', selectedSku.name);
      n8nFormData.append('productInfoText', productInfoText);
      n8nFormData.append('postMode', postMode);
      n8nFormData.append('imageCount', selectedImages.length.toString());
      if (productInfo) n8nFormData.append('productInfo', JSON.stringify(productInfo));
      
      // Nếu là chế độ AI (1 ảnh AVT), gửi trực tiếp file ảnh vật lý sang n8n để n8n tự tách nền
      if (postMode === 'AI' && localFilePaths.length === 1) {
        n8nFormData.append('image', fs.createReadStream(localFilePaths[0]));
      }
      
      console.log('Đang gửi dữ liệu sang n8n để AI xử lý...');
      const n8nResponse = await axios.post(N8N_WEBHOOK_URL, n8nFormData, {
        headers: { ...n8nFormData.getHeaders() }
      });
      
      const resData = n8nResponse.data;
      postContent = resData.content || resData.text || resData.message || (typeof resData === 'string' ? resData : JSON.stringify(resData));
      
      // 4. Nếu n8n trả về kết quả ảnh AI đã ghép xong (Base64 hoặc URL)
      if (postMode === 'AI') {
        const newImagePath = path.join(__dirname, `../../temp_images/n8n_ai_${Date.now()}.jpg`);
        let hasNewImage = false;

        if (resData.imageBase64) {
          // n8n trả về dạng Base64
          const base64Data = resData.imageBase64.replace(/^data:image\/\w+;base64,/, "");
          fs.writeFileSync(newImagePath, Buffer.from(base64Data, 'base64'));
          hasNewImage = true;
        } else if (resData.imageUrl) {
          // n8n trả về dạng đường dẫn tải xuống
          const imgRes = await axios.get(resData.imageUrl, { responseType: 'stream' });
          const writer = fs.createWriteStream(newImagePath);
          imgRes.data.pipe(writer);
          await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });
          hasNewImage = true;
        }

        if (hasNewImage) {
          if (fs.existsSync(localFilePaths[0])) fs.unlinkSync(localFilePaths[0]); // Xóa ảnh gốc
          localFilePaths[0] = newImagePath; // Cập nhật lại đường dẫn ảnh để đăng lên FB
          console.log('✅ Đã nhận được ảnh AI ghép phông nền từ n8n!');
        }
      }
      
      if (!postContent || postContent === 'undefined') {
        postContent = `[Đăng Tự Động] Khám phá ngay mẫu đồng hồ ${selectedSku.name} tuyệt đẹp.`;
      }
    } catch (n8nError) {
      console.log(`⚠️ Lỗi kết nối n8n: ${n8nError.message}. Dùng nội dung và ảnh dự phòng.`);
      postContent = `[Đăng Tự Động] Siêu phẩm đồng hồ ${selectedSku.name}.`;
    }

    // 5. Đăng Facebook
    const pageToken = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!pageToken) throw new Error('Thiếu FB_PAGE_ACCESS_TOKEN');

    let postId = null;

    if (localFilePaths.length === 1) {
      // ĐĂNG 1 ẢNH (SINGLE POST)
      const fbFormData = new FormData();
      fbFormData.append('source', fs.createReadStream(localFilePaths[0]));
      fbFormData.append('message', postContent);
      fbFormData.append('access_token', pageToken);

      const fbResponse = await axios.post(`https://graph.facebook.com/v19.0/me/photos`, fbFormData, {
        headers: { ...fbFormData.getHeaders() }
      });
      postId = fbResponse.data.post_id;
    } else {
      // ĐĂNG ALBUM (MULTI-PHOTO)
      console.log(`Đang tải lên ${localFilePaths.length} ảnh ẩn để tạo Album...`);
      const attachedMedia = [];
      
      for (const filePath of localFilePaths) {
        const fbFormData = new FormData();
        fbFormData.append('source', fs.createReadStream(filePath));
        fbFormData.append('published', 'false'); // Ảnh ẩn
        fbFormData.append('access_token', pageToken);

        const uploadRes = await axios.post(`https://graph.facebook.com/v19.0/me/photos`, fbFormData, {
          headers: { ...fbFormData.getHeaders() }
        });
        attachedMedia.push({ media_fbid: uploadRes.data.id });
      }

      console.log(`Đã tạo xong các ID ảnh. Bắt đầu đăng bài Feed...`);
      const feedRes = await axios.post(`https://graph.facebook.com/v19.0/me/feed`, {
        message: postContent,
        attached_media: attachedMedia,
        access_token: pageToken
      });
      postId = feedRes.data.id;
    }

    console.log(`✅ Đã đăng thành công lên FB (Post ID: ${postId})`);
    
    // 6. Lưu ID tất cả ảnh vào lịch sử
    for (const img of selectedImages) {
      await addPostedImageId(img.id);
    }
    
    // 7. Xóa file tạm
    localFilePaths.forEach(p => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
    
    return { success: true, postId: postId, sku: selectedSku.name };

  } catch (error) {
    // Dọn rác nếu lỗi
    localFilePaths.forEach(p => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
    console.error('❌ Tiến trình tự động thất bại:', error.message);
    throw error;
  }
};
