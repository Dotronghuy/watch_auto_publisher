import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import sharp from 'sharp';
import { getFolderIdByName, getImagesInFolder, downloadFileFromDrive, getFoldersInFolder } from './drive.service.js';
import { getProductInfoBySku, updateProductPostInfo } from './sheet.service.js';
import { getPostedImageIds, addPostedImageId } from '../utils/history.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateBackgroundOnChatGPT, generateTextOnGemini } from './playwright.service.js';

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
      let pathStr = await downloadFileFromDrive(img.id, img.name);
      
      // Nếu là ảnh AI, xử lý trực tiếp bằng Node.js để kiểm soát độ chính xác tuyệt đối 1024x1024
      if (postMode === 'AI') {
        const bgRemovedPath = pathStr.replace(/\.[^/.]+$/, "_rmbg.png");
        const finalPaddedPath = pathStr.replace(/\.[^/.]+$/, "_1024.png");
        
        try {
          console.log(`Đang gọi API remove.bg để gọt phông nền cho ${img.name}...`);
          const rmBgFormData = new FormData();
          rmBgFormData.append('size', 'auto');
          rmBgFormData.append('image_file', fs.readFileSync(pathStr), {
            filename: path.basename(pathStr),
            contentType: pathStr.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
          });
          
          const rmbgResponse = await axios.post('https://api.remove.bg/v1.0/removebg', rmBgFormData, {
            headers: {
              ...rmBgFormData.getHeaders(),
              'X-Api-Key': (process.env.REMOVE_BG_API_KEY || '').trim()
            },
            responseType: 'arraybuffer',
          });
          
          fs.writeFileSync(bgRemovedPath, rmbgResponse.data);
          
          console.log(`Đang ép kích thước ảnh thành hình vuông 1024x1024 cho OpenAI...`);
          await sharp(bgRemovedPath)
            .resize(1024, 1024, {
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 0 }
            })
            .toFormat('png')
            .toFile(finalPaddedPath);
            
          // Cập nhật lại đường dẫn để gửi n8n ảnh 1024x1024 này
          pathStr = finalPaddedPath;
        } catch (rmbgErr) {
          let errorMsg = rmbgErr.message;
          if (rmbgErr.response && rmbgErr.response.data) {
            try {
              errorMsg = rmbgErr.response.data.toString('utf8');
            } catch (e) { }
          }
          console.log(`⚠️ Lỗi khi xóa nền bằng remove.bg: ${errorMsg}. Vẫn tiếp tục dùng ảnh gốc.`);
        }
      }
      
      localFilePaths.push(pathStr);
    }

    // 3. Sử dụng Playwright để xử lý AI (Tạo ảnh & Viết Content)
    let postContent = '';
    try {
      const productInfo = await getProductInfoBySku(selectedSku.name);
      const productInfoText = productInfo ? Object.entries(productInfo).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
      
      // 3.1 NẾU LÀ CHẾ ĐỘ AI -> Gọi ChatGPT vẽ nền (Sinh 4-6 ảnh)
      let aiGeneratedImagePaths = [];
      if (postMode === 'AI' && localFilePaths.length === 1) {
        try {
          const imgPrompt = `Đây là hình ảnh một chiếc đồng hồ đã tách nền. Hãy giữ nguyên chiếc đồng hồ và tạo cho nó một phông nền mới cực kỳ sang trọng (như bàn đá cẩm thạch, vân gỗ cao cấp). Không được làm biến dạng chiếc đồng hồ.`;
          
          const numAiImages = Math.floor(Math.random() * 3) + 4; // Ngẫu nhiên 4, 5 hoặc 6 ảnh
          console.log(`🎨 [Nhánh AI] Yêu cầu ChatGPT vẽ ${numAiImages} bức ảnh liên tiếp...`);
          
          aiGeneratedImagePaths = await generateBackgroundOnChatGPT(localFilePaths[0], imgPrompt, numAiImages);
          
          // Xóa ảnh gốc vì không cần thiết đăng ảnh gốc nữa
          if (fs.existsSync(localFilePaths[0])) fs.unlinkSync(localFilePaths[0]);
          
          // Đổi mảng localFilePaths thành các ảnh AI vừa vẽ (để lát đăng Facebook thành Album)
          localFilePaths = [...aiGeneratedImagePaths];
        } catch (pwError) {
          console.log(`⚠️ Lỗi Playwright tạo ảnh: ${pwError.message}. Sẽ đăng ảnh gốc.`);
        }
      }
      
      // 3.2 GỌI GEMINI PLAYWRIGHT ĐỂ VIẾT CONTENT
      try {
          // Báo cho user biết nhánh nào đang chạy
          console.log(`🤖 [Nhánh ${postMode}] Gửi ảnh sang Gemini để viết Content...`);
          
          const textPrompt = `Hãy đóng vai một chuyên gia content marketing. Phân tích bức ảnh đồng hồ này và viết DUY NHẤT 1 bài đăng Facebook ngắn gọn, hấp dẫn để bán mẫu đồng hồ có mã SKU là: ${selectedSku.name}.\nDưới đây là thông tin kỹ thuật của sản phẩm:\n${productInfoText}\nChỉ trả về nội dung bài viết, không kèm giải thích. Dùng các hashtag phù hợp.`;
          
          // Truyền 1 bức ảnh ngẫu nhiên (ảnh gốc hoặc 1 trong các ảnh vừa vẽ) sang cho Gemini
          const randomGeminiImg = localFilePaths[Math.floor(Math.random() * localFilePaths.length)];
          postContent = await generateTextOnGemini(textPrompt, randomGeminiImg);
      } catch (geminiError) {
          console.log(`⚠️ Lỗi Playwright Gemini: ${geminiError.message}. Dùng nội dung dự phòng.`);
          postContent = `[Đăng Tự Động] Khám phá ngay siêu phẩm đồng hồ ${selectedSku.name} tuyệt đẹp.`;
      }
      
    } catch (e) {
      console.log(`⚠️ Lỗi trích xuất thông tin: ${e.message}. Dùng nội dung dự phòng.`);
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
    
    // Lưu Post ID và Ngày đăng lên Google Sheets
    await updateProductPostInfo(selectedSku.name, postId);
    
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
