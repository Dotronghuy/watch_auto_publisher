import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { liveLog } from '../utils/liveLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Đường dẫn file credentials
const KEYFILEPATH = path.join(__dirname, '../config/credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

// Khởi tạo Google Auth
const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

// Hàm tìm Folder ID theo tên (trong một thư mục cha)
export const getFolderIdByName = async (folderName, parentId) => {
  try {
    const res = await drive.files.list({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id, name)',
    });
    if (res.data.files.length > 0) return res.data.files[0].id;
    return null;
  } catch (error) {
    console.error('Lỗi khi tìm folder:', error.message);
    throw error;
  }
};

// Hàm lấy danh sách ảnh trong 1 thư mục (đã nâng cấp đệ quy để vào các thư mục con như Anh_AVT, Anh_Tu_Chup, v.v.)
export const getImagesInFolder = async (folderId) => {
  try {
    let allImages = [];
    const fetchRecursive = async (fId) => {
      let pageToken = null;
      do {
        const res = await drive.files.list({
          q: `'${fId}' in parents and trashed=false`,
          fields: 'nextPageToken, files(id, name, mimeType, size)',
          orderBy: 'createdTime desc',
          pageSize: 1000,
          pageToken: pageToken
        });
        
        for (const file of res.data.files) {
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            if (!file.name.toUpperCase().includes('AVT')) {
              await fetchRecursive(file.id);
            } else {
              console.log(`[Drive] Bỏ qua thư mục AVT: ${file.name}`);
            }
          } else if (file.mimeType.startsWith('image/')) {
            allImages.push(file);
          }
        }
        pageToken = res.data.nextPageToken;
      } while (pageToken);
    };
    await fetchRecursive(folderId);
    return allImages;
  } catch (error) {
    console.error('Lỗi khi lấy danh sách ảnh đệ quy:', error.message);
    throw error;
  }
};

// Hàm lấy danh sách video trong 1 thư mục (đệ quy)
export const getVideosInFolder = async (folderId) => {
  try {
    let allVideos = [];
    const fetchRecursive = async (fId) => {
      let pageToken = null;
      do {
        const res = await drive.files.list({
          q: `'${fId}' in parents and trashed=false`,
          fields: 'nextPageToken, files(id, name, mimeType, size)',
          orderBy: 'createdTime desc',
          pageSize: 1000,
          pageToken: pageToken
        });
        
        for (const file of res.data.files) {
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            await fetchRecursive(file.id);
          } else if (file.mimeType.startsWith('video/')) {
            allVideos.push(file);
          }
        }
        pageToken = res.data.nextPageToken;
      } while (pageToken);
    };
    await fetchRecursive(folderId);
    return allVideos;
  } catch (error) {
    console.error('Lỗi khi lấy danh sách video đệ quy:', error.message);
    throw error;
  }
};

// Hàm tải file từ Drive về máy tính (Stream)
export const downloadFileFromDrive = async (fileId, fileName) => {
  const tempDir = path.join(__dirname, '../../temp_images');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const destPath = path.join(tempDir, fileName);
  const dest = fs.createWriteStream(destPath);

  try {
    console.log(`Bắt đầu tải file: ${fileName} (ID: ${fileId})`);
    liveLog(`Bắt đầu tải file: ${fileName}`, 'typing', 'Google Drive');
    const res = await drive.files.get(
      { fileId, alt: 'media', acknowledgeAbuse: true },
      { responseType: 'stream' }
    );

    return new Promise((resolve, reject) => {
      res.data.pipe(dest);
      
      dest.on('finish', () => {
        console.log(`✅ Đã tải xong: ${destPath}`);
        // Gửi image raw nếu là file ảnh để Frontend có thể update Carousel ngay lập tức
        const isImage = fileName.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/i);
        const extraPayload = isImage ? { image: `http://localhost:3000/images/${fileName}` } : {};
        liveLog(`✅ Đã tải xong: ${fileName}`, 'success', 'Google Drive', extraPayload);
        resolve(destPath);
      });
      
      dest.on('error', err => {
        console.error('Lỗi khi ghi file:', err);
        reject(err);
      });
      
      res.data.on('error', err => {
        console.error('Lỗi khi stream tải file:', err);
        reject(err);
      });
    });
  } catch (error) {
    console.error('Lỗi khi gọi API tải file:', error.message);
    throw error;
  }
};

// Hàm lấy tất cả các thư mục con trong 1 thư mục cha
export const getFoldersInFolder = async (parentId) => {
  try {
    let allFolders = [];
    let pageToken = null;
    do {
      const res = await drive.files.list({
        q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'nextPageToken, files(id, name)',
        pageSize: 1000,
        pageToken: pageToken
      });
      allFolders = allFolders.concat(res.data.files);
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    
    return allFolders;
  } catch (error) {
    console.error('Lỗi khi lấy danh sách folder con:', error.message);
    throw error;
  }
};

/**
 * Lấy ảnh sản phẩm từ Google Drive cho chatbot (folder anh_hang hoặc anh_tu_chup)
 * Cấu trúc Drive: Root → I&W Carnival → 55851G1-S1 (tên folder = full SKU) → 1_Anh_Hang / 2_Anh_Tu_Chup
 * @param {string} skuName - Tên SKU (ví dụ: "55851G1-S1", "759G-S1", "515G")
 * @param {number} maxImages - Số ảnh tối đa muốn lấy (mặc định 5)
 * @returns {Promise<{urls: string[], source: string}>}
 */
export const getProductImagesFromDrive = async (skuName, maxImages = 5, folderPreference = 'all') => {
  const ROOT_DRIVE_FOLDER_ID = process.env.ROOT_DRIVE_FOLDER_ID || '1o0vu8gv7gF_u2sIC0fODFIDtcELlu8wL';
  
  try {
    // Bước 1: Tìm folder brand (I&W Carnival)
    const brandFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    const iwFolder = brandFolders.find(f => 
      f.name.toLowerCase().includes('i&w carnival') || 
      f.name.toLowerCase().includes('i&w') ||
      f.name.toLowerCase().includes('carnival')
    );
    if (!iwFolder) {
      console.log(`📸 [Drive] Không tìm thấy thư mục brand trong Drive`);
      return { urls: [], source: '' };
    }

    // Bước 2: Tìm folder SKU trên Drive
    // Tên folder trên Drive = full SKU (ví dụ: "55851G1-S1", không phải "55851G1")
    const skuUpper = skuName.toUpperCase();
    const skuFolders = await getFoldersInFolder(iwFolder.id);
    
    // Tìm tất cả các folder khớp với SKU (ưu tiên exact, startsWith, includes)
    let candidateFolders = [];
    const exactMatch = skuFolders.find(f => f.name.toUpperCase() === skuUpper);
    if (exactMatch) candidateFolders.push(exactMatch);
    
    candidateFolders.push(...skuFolders.filter(f => f.name.toUpperCase().startsWith(skuUpper) && f.id !== exactMatch?.id));
    candidateFolders.push(...skuFolders.filter(f => f.name.toUpperCase().includes(skuUpper) && !candidateFolders.some(cf => cf.id === f.id)));

    if (candidateFolders.length === 0) {
      console.log(`📸 [Drive] Không tìm thấy folder SKU: ${skuName}`);
      return { urls: [], source: '' };
    }
    
    // Bước 3: Duyệt qua các candidate folder, lấy folder ĐẦU TIÊN CÓ ẢNH
    let finalImages = [];
    let finalSource = '';
    let selectedFolder = null;

    for (const folder of candidateFolders) {
      const subFolders = await getFoldersInFolder(folder.id);
      const hangFolder = subFolders.find(f => f.name.includes('1_') || f.name.toLowerCase().includes('hãng') || f.name.toLowerCase().includes('hang'));
      const tuChupFolder = subFolders.find(f => f.name.includes('2_') || f.name.toLowerCase().includes('tự') || f.name.toLowerCase().includes('tu_chup') || f.name.toLowerCase().includes('tu'));

      let images = [];
      let source = '';

      if (folderPreference === 'anh_tu_chup') {
        if (tuChupFolder) {
          images = await getImagesInFolder(tuChupFolder.id);
          source = 'anh_tu_chup';
        }
      } else {
        if (hangFolder) {
          images = await getImagesInFolder(hangFolder.id);
          source = 'anh_hang';
        }

        if (images.length < 3 && tuChupFolder) {
          const tuChupImages = await getImagesInFolder(tuChupFolder.id);
          if (images.length === 0) {
            images = tuChupImages;
            source = 'anh_tu_chup';
          } else {
            images = [...images, ...tuChupImages];
            source = 'anh_hang + anh_tu_chup';
          }
        }
      }

      if (images.length > 0) {
        finalImages = images;
        finalSource = source;
        selectedFolder = folder;
        break; // Tìm thấy folder có ảnh thì dừng ngay
      }
    }

    if (finalImages.length === 0) {
      console.log(`📸 [Drive] SKU ${skuName}: Đã kiểm tra ${candidateFolders.length} folder nhưng không có ảnh nào`);
      return { urls: [], source: '' };
    }

    console.log(`📸 [Drive] Tìm thấy folder có ảnh: "${selectedFolder.name}" cho SKU: ${skuName}`);

    // Giới hạn số ảnh
    const selectedImages = finalImages.slice(0, maxImages);
    
    // Tạo URL công khai từ Google Drive file ID
    const urls = selectedImages.map(img => `https://drive.google.com/thumbnail?id=${img.id}&sz=w1000`);

    console.log(`📸 [Drive] SKU ${skuName}: Tìm thấy ${finalImages.length} ảnh, gửi ${urls.length} ảnh (từ ${finalSource})`);
    return { urls, source: finalSource };

  } catch (error) {
    console.error(`📸 [Drive] Lỗi khi lấy ảnh SKU ${skuName}:`, error.message);
    return { urls: [], source: '' };
  }
};

// Hàm tính tổng dung lượng THẬT - dùng BFS song song (nhanh hơn đệ quy tuần tự 10-20x)
export const getDriveFolderSize = async (rootFolderId) => {
  let totalBytes = 0;
  const CONCURRENCY = 10; // Xử lý tối đa 10 folder cùng lúc

  // BFS queue
  let queue = [rootFolderId];

  while (queue.length > 0) {
    // Lấy batch hiện tại (tối đa CONCURRENCY folder)
    const batch = queue.splice(0, CONCURRENCY);

    // Xử lý tất cả folder trong batch song song
    const results = await Promise.all(
      batch.map(async (folderId) => {
        let bytes = 0;
        const subFolderIds = [];

        try {
          // Lấy tất cả file trong folder (có pagination)
          let pageToken = null;
          do {
            const params = {
              q: `'${folderId}' in parents and trashed=false`,
              fields: 'nextPageToken, files(id, size, mimeType)',
              pageSize: 1000,
            };
            if (pageToken) params.pageToken = pageToken;

            const res = await drive.files.list(params);
            for (const file of res.data.files) {
              if (file.mimeType === 'application/vnd.google-apps.folder') {
                subFolderIds.push(file.id); // Đưa subfolder vào queue
              } else {
                bytes += parseInt(file.size || '0', 10);
              }
            }
            pageToken = res.data.nextPageToken;
          } while (pageToken);
        } catch (error) {
          console.warn(`⚠️ Bỏ qua folder ${folderId}:`, error.message);
        }

        return { bytes, subFolderIds };
      })
    );

    // Tổng hợp kết quả và thêm subfolder vào queue
    for (const r of results) {
      totalBytes += r.bytes;
      queue.push(...r.subFolderIds);
    }
  }

  return totalBytes;
};
