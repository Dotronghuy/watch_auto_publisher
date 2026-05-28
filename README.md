# 🕐 Watch Auto Publisher

Hệ thống tự động đăng bài đồng hồ lên Facebook & Instagram, sử dụng AI (ChatGPT + Gemini) để sinh ảnh và viết content.

---

## 🚀 Cài đặt từ đầu trên máy mới

### Yêu cầu hệ thống
- **Node.js** v18+ ([tải tại nodejs.org](https://nodejs.org))
- **Redis** (BullMQ dùng Redis để quản lý queue)
  - Windows: tải [Redis for Windows](https://github.com/tporadowski/redis/releases) hoặc dùng Docker
  - Mac: `brew install redis && brew services start redis`

---

### 🏠 Máy ở nhà (đã có code cũ rồi)

```bash
# Vào thư mục cũ và kéo code mới nhất về
git pull origin master

# Cài lại dependencies (phòng khi có package mới)
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# Chạy luôn
npm run dev
```

---

### 1. Clone & cài dependencies

```bash
# Clone repo
git clone <URL_REPO_CUA_BAN>
cd watch_auto_publisher-master

# Cài dependencies toàn bộ (root + backend + frontend)
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2. Cài Playwright browser (bắt buộc cho ChatGPT & Gemini)

```bash
cd backend
npx playwright install chromium
cd ..
```

### 3. Tạo file `.env` trong thư mục `backend/`

Tạo file `backend/.env` với nội dung sau (điền giá trị thật của bạn):

```env
PORT=3000

# Meta (Facebook/Instagram)
FB_PAGE_ACCESS_TOKEN=your_token_here
IG_ACCESS_TOKEN=your_token_here
IG_USER_ID=your_ig_user_id

# Redis
REDIS_URL=redis://localhost:6379

# Remove.bg (tùy chọn - xóa phông ảnh AVT)
REMOVE_BG_API_KEY=your_key_here

# Google Drive (thư mục root chứa ảnh sản phẩm)
ROOT_DRIVE_FOLDER_ID=your_drive_folder_id
```

### 4. Đặt Google Service Account credentials

Tạo file `backend/src/config/credentials.json` từ Google Cloud Console:
- Vào [Google Cloud Console](https://console.cloud.google.com)
- Tạo Service Account → Tải key JSON → Đặt vào `backend/src/config/credentials.json`
- Cấp quyền cho Service Account truy cập Google Drive & Sheets

### 5. Tạo thư mục profile Chrome (để đăng nhập ChatGPT & Gemini)

```bash
mkdir backend/chrome_data_chatgpt
mkdir backend/chrome_data_gemini
mkdir backend/temp_images
```

Sau đó dùng **Login Helper** trong giao diện (Cài đặt → Tài khoản AI) để đăng nhập lần đầu.

---

## ▶️ Chạy ứng dụng

```bash
# Chạy cả Backend + Frontend cùng lúc
npm run dev
```

- **Backend API**: http://localhost:3000
- **Frontend UI**: http://localhost:5173

---

## 📁 Cấu trúc thư mục

```
watch_auto_publisher-master/
├── backend/                  # Node.js + Express API
│   ├── src/
│   │   ├── config/           # credentials.json, settings.json
│   │   ├── services/         # publish, playwright, drive, sheet, meta...
│   │   ├── routes/           # API endpoints
│   │   └── utils/            # helper functions
│   ├── chrome_data_chatgpt/  # Profile Chrome cho ChatGPT (gitignored)
│   ├── chrome_data_gemini/   # Profile Chrome cho Gemini (gitignored)
│   └── temp_images/          # Ảnh tạm thời (gitignored)
├── frontend/                 # React + Vite UI
│   └── src/
│       ├── pages/            # Workflow, Dashboard, Calendar...
│       └── components/       # Layout, Topbar, Sidebar...
└── package.json              # Root script chạy cả 2
```

---

## ⚠️ Lưu ý quan trọng

- **`.env`** không được đẩy lên GitHub — phải tạo lại trên máy mới
- **`credentials.json`** không được đẩy lên GitHub — phải copy thủ công
- **Chrome profiles** không được đẩy — phải đăng nhập lại bằng Login Helper
- **Redis** phải đang chạy trước khi start app
