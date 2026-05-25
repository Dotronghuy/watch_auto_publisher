import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// Hàm lấy danh sách ảnh trong 1 thư mục
export const getImagesInFolder = async (folderId) => {
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
      fields: 'files(id, name, mimeType, size)',
      orderBy: 'createdTime desc', // Mới nhất lên đầu
    });
    return res.data.files;
  } catch (error) {
    console.error('Lỗi khi lấy danh sách ảnh:', error.message);
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
    const res = await drive.files.get(
      { fileId, alt: 'media', acknowledgeAbuse: true },
      { responseType: 'stream' }
    );

    return new Promise((resolve, reject) => {
      res.data
        .on('end', () => {
          console.log(`✅ Đã tải xong: ${destPath}`);
          resolve(destPath);
        })
        .on('error', err => {
          console.error('Lỗi khi stream tải file:', err);
          reject(err);
        })
        .pipe(dest);
    });
  } catch (error) {
    console.error('Lỗi khi gọi API tải file:', error.message);
    throw error;
  }
};

// Hàm lấy tất cả các thư mục con trong 1 thư mục cha
export const getFoldersInFolder = async (parentId) => {
  try {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });
    return res.data.files;
  } catch (error) {
    console.error('Lỗi khi lấy danh sách folder con:', error.message);
    throw error;
  }
};
