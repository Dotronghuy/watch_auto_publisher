import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FOLDER_ID = '1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl';

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, '../config/credentials.json'),
  scopes: ['https://www.googleapis.com/auth/drive.readonly']
});

const drive = google.drive({ version: 'v3', auth });

try {
  console.log('🔍 Đang kiểm tra kết nối Service Account với folder Drive...');
  console.log(`📁 Folder ID: ${FOLDER_ID}`);
  
  const res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and trashed=false`,
    fields: 'files(id, name, size, mimeType)',
    pageSize: 5
  });
  
  console.log(`\n✅ KẾT NỐI THÀNH CÔNG! Tìm thấy ${res.data.files.length} file/folder:`);
  res.data.files.forEach(f => {
    const size = f.size ? `(${(parseInt(f.size) / 1024 / 1024).toFixed(2)} MB)` : '(folder)';
    console.log(`  - ${f.name} ${size}`);
  });
  
} catch(err) {
  console.error('\n❌ LỖI KẾT NỐI DRIVE!');
  console.error('Message:', err.message);
  console.error('Code:', err.code);
  
  if (err.code === 403) {
    console.log('\n⚠️  NGUYÊN NHÂN: Service account chưa được cấp quyền vào folder!');
    console.log('📌 CÁCH SỬA:');
    console.log('   1. Mở Google Drive');
    console.log('   2. Chuột phải vào folder Media_Dong_Ho');
    console.log('   3. Chọn "Chia sẻ"');
    console.log('   4. Nhập email: bot-auto-post@tool-info-watch.iam.gserviceaccount.com');
    console.log('   5. Quyền: Người xem (Viewer)');
    console.log('   6. Bấm Gửi');
  }
}
