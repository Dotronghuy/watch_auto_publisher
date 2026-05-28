import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Đọc file OAuth2 client credentials (tải từ Google Cloud Console)
const OAUTH_CREDENTIALS_PATH = path.join(__dirname, '../config/oauth2_credentials.json');
const TOKEN_PATH = path.join(__dirname, '../config/oauth2_token.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.metadata.readonly'];

const run = async () => {
  if (!fs.existsSync(OAUTH_CREDENTIALS_PATH)) {
    console.error('❌ Không tìm thấy file oauth2_credentials.json!');
    console.log('\n📌 HƯỚNG DẪN TẠO FILE:');
    console.log('1. Vào: https://console.cloud.google.com/apis/credentials?project=tool-info-watch');
    console.log('2. Bấm "+ CREATE CREDENTIALS" → "OAuth client ID"');
    console.log('3. Application type: "Desktop app" → Đặt tên bất kỳ → Bấm CREATE');
    console.log('4. Bấm "DOWNLOAD JSON" → Lưu file vào: backend/config/oauth2_credentials.json');
    console.log('5. Chạy lại: node src/get-drive-token.js');
    return;
  }

  const credentials = JSON.parse(fs.readFileSync(OAUTH_CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3333');

  // Tạo URL xác thực
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\n🔐 Mở link sau trong trình duyệt để xác thực Google:');
  console.log('\n' + authUrl + '\n');
  console.log('⏳ Đang chờ xác thực (server local chạy tại http://localhost:3333)...\n');

  // Tạo server tạm để nhận OAuth callback
  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost:3333');
        const code = url.searchParams.get('code');

        if (!code) {
          res.end('<h2>Không tìm thấy code. Hãy thử lại.</h2>');
          return;
        }

        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);

        // Lưu token vào file
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        console.log('✅ Token đã lưu vào:', TOKEN_PATH);

        // Lấy thông tin quota Drive ngay
        const drive = google.drive({ version: 'v3', auth: oAuth2Client });
        const about = await drive.about.get({ fields: 'storageQuota, user' });
        const q = about.data.storageQuota;
        const usedGB = (parseInt(q.usage) / 1024 / 1024 / 1024).toFixed(2);
        const limitGB = q.limit ? (parseInt(q.limit) / 1024 / 1024 / 1024).toFixed(0) : 'Unlimited';

        console.log(`\n📊 Thông tin Drive:`);
        console.log(`   👤 User: ${about.data.user?.emailAddress}`);
        console.log(`   💾 Đã dùng: ${usedGB} GB`);
        console.log(`   📦 Giới hạn: ${limitGB} GB`);

        // Thêm DRIVE_REFRESH_TOKEN vào .env
        const envPath = path.join(__dirname, '../../.env');
        let envContent = fs.readFileSync(envPath, 'utf8');
        if (envContent.includes('DRIVE_REFRESH_TOKEN=')) {
          envContent = envContent.replace(/DRIVE_REFRESH_TOKEN=.*/,  `DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
        } else {
          envContent += `\nDRIVE_REFRESH_TOKEN=${tokens.refresh_token}`;
        }
        fs.writeFileSync(envPath, envContent);
        console.log('\n✅ DRIVE_REFRESH_TOKEN đã được lưu vào .env!');
        console.log('🎉 Khởi động lại server (npm run dev) để áp dụng.\n');

        res.end(`
          <h2 style="font-family:sans-serif;color:green">✅ Xác thực thành công!</h2>
          <p>Đã dùng: <b>${usedGB} GB</b> / ${limitGB} GB</p>
          <p>Bạn có thể đóng tab này.</p>
        `);
        server.close();
        resolve();
      } catch (err) {
        console.error('Lỗi:', err.message);
        res.end('<h2>Lỗi xác thực. Kiểm tra terminal.</h2>');
        server.close();
        reject(err);
      }
    });

    server.listen(3333, () => {});
    server.on('error', reject);
  });
};

run().catch(console.error);
