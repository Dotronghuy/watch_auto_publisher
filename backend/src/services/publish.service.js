import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import sharp from 'sharp';
import { getFolderIdByName, getImagesInFolder, getVideosInFolder, downloadFileFromDrive, getFoldersInFolder } from './drive.service.js';
import { getProductInfoBySku, updateProductPostInfo, getAllProductsPostInfo, clearExpiredPostInfo } from './sheet.service.js';
import { getPostedImageIds, addPostedImageId } from '../utils/history.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateBackgroundOnChatGPT, generateTextOnGemini } from './playwright.service.js';
import { publishToInstagram, publishCarouselToInstagram, publishFBReels, publishIGReels } from './meta.service.js';
import { addMusicToVideo } from './video.service.js';
import { addActivity } from '../utils/activity.js';
import { liveLog } from '../utils/liveLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, '../config/settings.json');

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://127.0.0.1:5678/webhook-test/test-ai';
const ROOT_DRIVE_FOLDER_ID = process.env.ROOT_DRIVE_FOLDER_ID || '1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl';

export const autoPublishRoutine = async (signal) => {
  const checkAbort = () => {
    if (signal && signal.aborted) {
      const err = new Error('Lưồng bị dừng theo yêu cầu của người dùng.');
      err.name = 'AbortError';
      throw err;
    }
  };

  liveLog('🤖 Bắt đầu tiến trình tự động đăng bài...', 'info', 'System');

  const cleanTempDirectory = () => {
    const tempDir = path.join(__dirname, '../../temp_images');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        if (file !== '.gitkeep') {
          try {
            fs.unlinkSync(path.join(tempDir, file));
          } catch (e) { }
        }
      }
    }
  };

  let localFilePaths = [];

  try {
    const skuFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    if (skuFolders.length === 0) throw new Error('Không tìm thấy thư mục SKU nào trong Drive!');

    const postedIds = await getPostedImageIds();

    liveLog('Đang kiểm tra lịch sử đăng bài từ Google Sheets...', 'typing', 'Google Sheets');
    const allProductsInfo = await getAllProductsPostInfo();

    checkAbort(); // ---- Dừng an toàn sau khi lấy dữ liệu Sheet ----
    const nowMs = Date.now();

    const eligibleSkus = [];
    const expiredButUnpickedRows = [];

    // Hàm parse ngày giờ định dạng HH:mm:ss DD/MM/YYYY
    const parseVietnameseDate = (dateString) => {
      if (!dateString) return 0;
      const parts = dateString.split(' ');
      if (parts.length !== 2) return 0;
      const [timePart, datePart] = parts;
      const [hour, min, sec] = timePart.split(':').map(Number);
      const [day, month, year] = datePart.split('/').map(Number);
      return new Date(year, month - 1, day, hour, min, sec).getTime();
    };

    for (const skuFolder of skuFolders) {
      const productInfo = allProductsInfo.find(p => p.sku === skuFolder.name);

      if (productInfo && productInfo.postDate) {
        const lastPostTime = parseVietnameseDate(productInfo.postDate);
        // Tính theo phút (minutes) thay vì ngày như yêu cầu test của user
        const cycleMs = productInfo.cycleMinutes * 60 * 1000;
        const timePassedMs = nowMs - lastPostTime;

        if (timePassedMs < cycleMs) {
          console.log(`⏳ Bỏ qua SKU ${skuFolder.name}: Mới đăng gần đây (cần chờ thêm khoảng ${Math.ceil((cycleMs - timePassedMs) / 60000)} phút).`);
          continue; // Chưa đủ thời gian chờ -> Bỏ qua
        } else {
          // Đã đủ thời gian chờ (hết cooldown), cho phép vào danh sách bốc thăm
          // Nếu lát nữa ko bốc trúng thì sẽ đem đi clear thời gian trên Sheets
          expiredButUnpickedRows.push(productInfo.rowIndex);
        }
      }
      eligibleSkus.push(skuFolder);
    }

    if (eligibleSkus.length === 0) {
      liveLog('⚠️ Tất cả các mã SKU đang trong thời gian chờ (Cooldown). Không có mã nào hợp lệ!', 'error', 'Google Sheets');
      throw new Error('Tất cả các mã SKU đang trong thời gian chờ (Cooldown). Không có mã nào hợp lệ để đăng!');
    }

    // Trộn ngẫu nhiên danh sách hợp lệ
    const shuffledSkus = eligibleSkus.sort(() => 0.5 - Math.random());

    const folderTypes = ['0_Anh_AVT', '1_Anh_Hang', '2_Anh_Tu_Chup', '3_Video_Doc'];
    let selectedImages = [];
    let selectedSku = null;
    let postMode = 'SINGLE'; // SINGLE (AI), ALBUM, hoặc REELS

    // Tìm ảnh/video chưa đăng
    for (const skuFolder of shuffledSkus) {
      // Trộn ngẫu nhiên thứ tự ưu tiên các loại thư mục
      const shuffledFolderTypes = [...folderTypes].sort(() => 0.5 - Math.random());

      for (const folderName of shuffledFolderTypes) {
        const targetFolderId = await getFolderIdByName(folderName, skuFolder.id);
        if (!targetFolderId) continue;

        let mediaFiles = [];
        if (folderName === '3_Video_Doc') {
          mediaFiles = await getVideosInFolder(targetFolderId);
        } else {
          mediaFiles = await getImagesInFolder(targetFolderId);
        }

        const freshMedia = mediaFiles.filter(item => !postedIds.includes(item.id));

        if (freshMedia.length > 0) {
          selectedSku = skuFolder;

          if (folderName === '0_Anh_AVT') {
            // Chế độ AI thay phông nền: Lấy 1 tấm
            selectedImages = [freshMedia[Math.floor(Math.random() * freshMedia.length)]];
            postMode = 'AI';
          } else if (folderName === '3_Video_Doc') {
            // Chế độ Reels: Lấy 1 Video
            selectedImages = [freshMedia[Math.floor(Math.random() * freshMedia.length)]];
            postMode = 'REELS';
          } else {
            // Chế độ Album: Bốc ngẫu nhiên 4-8 tấm
            const numToPick = Math.min(freshMedia.length, Math.floor(Math.random() * 5) + 4); // Random 4 đến 8
            selectedImages = freshMedia.sort(() => 0.5 - Math.random()).slice(0, numToPick);
            postMode = 'ALBUM';
          }
          break;
        }
      }

      if (selectedImages.length > 0) break; // Thoát vòng lặp ngoài nếu đã tìm được
    }

    if (selectedImages.length === 0) {
      throw new Error('Đã hết sạch ảnh/video mới chưa đăng trong tất cả các mã SKU hợp lệ.');
    }

    // Loại bỏ SKU vừa được bốc ra khỏi danh sách cần clear trên Sheets
    const pickedProductInfo = allProductsInfo.find(p => p.sku === selectedSku.name);
    if (pickedProductInfo) {
      const indexToKeep = expiredButUnpickedRows.indexOf(pickedProductInfo.rowIndex);
      if (indexToKeep !== -1) expiredButUnpickedRows.splice(indexToKeep, 1);
    }

    // Dọn dẹp (Xóa) lịch sử những mã SKU ko được chọn
    if (expiredButUnpickedRows.length > 0) {
      console.log(`🧹 Đang xóa lịch sử đăng của ${expiredButUnpickedRows.length} SKU đã hết hạn chờ để ưu tiên cho lần sau...`);
      await clearExpiredPostInfo(expiredButUnpickedRows);
    }

    liveLog(`✅ Đã chọn [Chế độ ${postMode}] - SKU: ${selectedSku.name} - Số lượng: ${selectedImages.length} ảnh`, 'highlight', 'Google Drive');

    checkAbort(); // ---- Dừng an toàn sau khi chọn ảnh/video ----

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
        console.log(`🤖 [Nhánh ${postMode}] Gửi ảnh sang Gemini để viết Content...`);

        let textPrompt = `Hãy đóng vai một chuyên gia content marketing. Phân tích bức ảnh đồng hồ này và viết DUY NHẤT 1 bài đăng Facebook ngắn gọn, hấp dẫn để bán mẫu đồng hồ có mã SKU là: ${selectedSku.name}.\nDưới đây là thông tin kỹ thuật của sản phẩm:\n${productInfoText}\nChỉ trả về nội dung bài viết, không kèm giải thích. Dùng các hashtag phù hợp.`;
        let targetImgPathForGemini = localFilePaths[Math.floor(Math.random() * localFilePaths.length)];
        let tempImgDownloaded = null;

        // Riêng nhánh REELS: Lấy tạm 1 ảnh từ thư mục 1_Anh_Hang hoặc 2_Anh_Tu_Chup để cho Gemini nhìn
        if (postMode === 'REELS') {
          textPrompt = `Hãy đóng vai một chuyên gia content marketing/Tiktok creator. Viết một đoạn caption ngắn giật tít, cực kỳ cuốn hút cho một video Reels giới thiệu chiếc đồng hồ có mã SKU là: ${selectedSku.name}.\nDưới đây là thông tin kỹ thuật của sản phẩm:\n${productInfoText}\nChỉ trả về caption, không kèm kịch bản hình ảnh. Dùng nhiều hashtag đang lên xu hướng (#dongho, #luxury, #reels...).`;

          // Tìm ảnh mẫu để gửi Gemini
          const sampleFolders = ['1_Anh_Hang', '2_Anh_Tu_Chup'];
          for (const sFolder of sampleFolders) {
            const sFolderId = await getFolderIdByName(sFolder, selectedSku.id);
            if (sFolderId) {
              const sImages = await getImagesInFolder(sFolderId);
              if (sImages.length > 0) {
                const sampleImg = sImages[0];
                tempImgDownloaded = await downloadFileFromDrive(sampleImg.id, `temp_gemini_${sampleImg.name}`);
                targetImgPathForGemini = tempImgDownloaded;
                break;
              }
            }
          }
        }

        postContent = await generateTextOnGemini(textPrompt, targetImgPathForGemini);

        // Xóa ảnh tạm nếu có dùng cho REELS
        if (tempImgDownloaded && fs.existsSync(tempImgDownloaded)) {
          fs.unlinkSync(tempImgDownloaded);
        }

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
    
    // Hàm trợ giúp để tính toán thời gian delay IG
    const getIgDelayMs = () => {
      try {
        if (fs.existsSync(settingsPath)) {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          // Nếu đang ở chế độ test thì KHÔNG áp dụng IG delay
          if (settings.mode === 'test') return 0;
          const min = parseInt(settings.igDelayMin) || 0;
          const max = parseInt(settings.igDelayMax) || min;
          if (min <= 0) return 0;
          const randomMinutes = min + Math.random() * (max - min);
          return Math.round(randomMinutes * 60 * 1000);
        }
      } catch (e) {}
      return 0; // Mặc định 0 nếu lỗi (không chờ)
    };
    
    // Hàm sleep hỗ trợ AbortSignal - có thể bị dừng giữa chừng
    const sleep = (ms, abortSignal) => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          clearTimeout(timer);
          const err = new Error('Sleep bị dừng theo yêu cầu.');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      }
    });

    if (postMode === 'REELS') {
      let finalVideoPath = localFilePaths[0];
      const musicDir = path.join(process.cwd(), 'music_library');

      // CHÈN NHẠC VÀO VIDEO NẾU CÓ
      if (fs.existsSync(musicDir)) {
          const musicFiles = fs.readdirSync(musicDir).filter(f => f.toLowerCase().endsWith('.mp3'));
          if (musicFiles.length > 0) {
              const randomMusic = musicFiles[Math.floor(Math.random() * musicFiles.length)];
              const musicPath = path.join(musicDir, randomMusic);
              const mixedVideoPath = finalVideoPath.replace('.mp4', `_mixed_${Date.now()}.mp4`);
              
              console.log(`🎧 Đã bốc trúng bài nhạc: ${randomMusic}`);
              try {
                  finalVideoPath = await addMusicToVideo(finalVideoPath, musicPath, mixedVideoPath);
              } catch (e) {
                  console.log(`⚠️ Bỏ qua chèn nhạc do lỗi FFmpeg: ${e.message}`);
              }
          } else {
              console.log(`⚠️ Thư mục music_library trống, sẽ đăng video gốc.`);
          }
      }

      // ĐĂNG VIDEO REELS LÊN FACEBOOK
      postId = await publishFBReels(finalVideoPath, postContent);

      // ĐĂNG VIDEO REELS LÊN INSTAGRAM (Bơm thẳng file nội bộ)
      try {
         const delayMs = getIgDelayMs();
         if (delayMs > 0) {
             console.log(`⏳ Đang chờ ${delayMs / 60000} phút trước khi đẩy video sang IG (Chống spam)...`);
             await sleep(delayMs);
         }
         
         console.log(`🚀 Đang đẩy trực tiếp Video từ ổ cứng sang IG Reels...`);
         
         // Thêm vòng lặp Retry phòng khi IG bị lỗi máy chủ nội bộ
         let igSuccess = false;
         for (let i = 1; i <= 3; i++) {
             try {
                 await publishIGReels(finalVideoPath, postContent);
                 igSuccess = true;
                 break; // Thành công thì thoát vòng lặp
             } catch (igErr) {
                 console.log(`⚠️ IG báo lỗi (Lần thử ${i}/3): ${igErr.message}`);
                 if (i < 3) {
                     console.log(`⏳ Đợi 15 giây rồi thử lại...`);
                     await new Promise(r => setTimeout(r, 15000));
                 }
             }
         }
         
         if (!igSuccess) {
             console.log(`❌ Đã thử 3 lần nhưng IG vẫn từ chối xử lý video này.`);
         }
      } catch (e) {
        console.log(`⚠️ Lỗi không xác định khi đăng IG Reels: ${e.message}`);
      }

      // XÓA FILE VIDEO ĐÃ ĐƯỢC CHÈN NHẠC (ĐỂ TRÁNH RÁC Ổ CỨNG)
      if (finalVideoPath !== localFilePaths[0] && fs.existsSync(finalVideoPath)) {
          fs.unlinkSync(finalVideoPath);
      }

    } else if (localFilePaths.length === 1) {
      // ĐĂNG 1 ẢNH (SINGLE POST)
      const fbFormData = new FormData();
      fbFormData.append('source', fs.createReadStream(localFilePaths[0]));
      fbFormData.append('message', postContent);
      fbFormData.append('access_token', pageToken);

      const fbResponse = await axios.post(`https://graph.facebook.com/v19.0/me/photos`, fbFormData, {
        headers: { ...fbFormData.getHeaders() }
      });
      postId = fbResponse.data.post_id;

      // Lấy Public URL của ảnh vừa đăng để dùng cho Instagram
      try {
        const photoId = fbResponse.data.id;
        const imgMetaRes = await axios.get(`https://graph.facebook.com/v19.0/${photoId}`, {
          params: { fields: 'images', access_token: pageToken }
        });
        const publicUrl = imgMetaRes.data.images[0].source;
        console.log(`✅ Lấy thành công Public URL từ FB để đẩy sang IG: ${publicUrl}`);

        // Đăng lên Instagram
        const delayMs = getIgDelayMs();
        if (delayMs > 0) {
            console.log(`⏳ Đang chờ ${delayMs / 60000} phút trước khi đẩy ảnh sang IG...`);
            await sleep(delayMs);
        }
        await publishToInstagram(postContent, publicUrl);
      } catch (igErr) {
        console.log(`⚠️ Lỗi khi đăng 1 ảnh lên Instagram: ${igErr.response?.data?.error?.message || igErr.message}`);
      }

    } else {
      // ĐĂNG ALBUM (MULTI-PHOTO)
      console.log(`Đang tải lên ${localFilePaths.length} ảnh ẩn để tạo Album FB...`);
      const attachedMedia = [];
      const publicUrls = [];

      for (const filePath of localFilePaths) {
        const fbFormData = new FormData();
        fbFormData.append('source', fs.createReadStream(filePath));
        fbFormData.append('published', 'false'); // Ảnh ẩn
        fbFormData.append('access_token', pageToken);

        const uploadRes = await axios.post(`https://graph.facebook.com/v19.0/me/photos`, fbFormData, {
          headers: { ...fbFormData.getHeaders() }
        });
        const photoId = uploadRes.data.id;
        attachedMedia.push({ media_fbid: photoId });

        // Trích xuất Public URL cho Instagram
        try {
          const imgMetaRes = await axios.get(`https://graph.facebook.com/v19.0/${photoId}`, {
            params: { fields: 'images', access_token: pageToken }
          });
          publicUrls.push(imgMetaRes.data.images[0].source);
        } catch (e) {
          console.log(`⚠️ Lỗi trích xuất link ảnh ẩn FB: ${e.message}`);
        }
      }

      console.log(`Đã tạo xong các ID ảnh FB. Bắt đầu đăng bài Feed...`);
      const feedRes = await axios.post(`https://graph.facebook.com/v19.0/me/feed`, {
        message: postContent,
        attached_media: attachedMedia,
        access_token: pageToken
      });
      postId = feedRes.data.id;

      // Đăng lên Instagram Carousel
      if (publicUrls.length >= 2) {
        try {
          const delayMs = getIgDelayMs();
          if (delayMs > 0) {
              console.log(`⏳ Đang chờ ${delayMs / 60000} phút trước khi đẩy Album sang IG...`);
              await sleep(delayMs);
          }
          console.log(`✅ Đang đẩy ${publicUrls.length} ảnh sang Instagram Carousel...`);
          await publishCarouselToInstagram(postContent, publicUrls);
        } catch (igErr) {
          console.log(`⚠️ Lỗi đăng Carousel Instagram: ${igErr.response?.data?.error?.message || igErr.message}`);
        }
      }
    }

    console.log(`✅ Đã đăng thành công lên FB (Post ID: ${postId})`);
    
    // Đẩy lịch sử lên giao diện Dashboard
    addActivity(`Đăng thành công sản phẩm ${selectedSku.name} lên Fanpage!`, 'success');

    // Lưu Post ID và Ngày đăng lên Google Sheets
    await updateProductPostInfo(selectedSku.name, postId);

    // 6. Lưu ID tất cả ảnh vào lịch sử
    for (const img of selectedImages) {
      await addPostedImageId(img.id);
    }

    // 7. Dọn sạch toàn bộ thư mục temp_images để tránh tích tụ file rác (ảnh gốc, rmbg, resize, chatgpt...)
    cleanTempDirectory();

    return { success: true, postId: postId, sku: selectedSku.name };

  } catch (error) {
    // Dọn rác nếu lỗi
    cleanTempDirectory();
    console.error('❌ Tiến trình tự động thất bại:', error.response?.data || error.message);
    throw error;
  }
};
