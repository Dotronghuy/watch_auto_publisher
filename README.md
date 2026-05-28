# 🕐 Watch Auto Publisher

Hệ thống tự động đăng bài đồng hồ lên Facebook & Instagram, sử dụng AI (ChatGPT + Gemini) để sinh ảnh và viết content.

**GitHub:** https://github.com/Dotronghuy/watch_auto_publisher

---

## ✅ Checklist sang máy công ty (hoặc máy mới)

| # | Việc cần làm | Ghi chú |
|---|-------------|---------|
| 1 | Cài **Node.js v18+** | https://nodejs.org |
| 2 | Cài **Redis** | Xem bên dưới |
| 3 | Clone repo | `git clone ...` |
| 4 | Cài npm packages | `npm install` ở 3 chỗ |
| 5 | Cài Playwright browser | `npx playwright install chromium` |
| 6 | Tạo file **`.env`** | Copy từ máy cũ hoặc điền lại |
| 7 | Copy **`credentials.json`** | Copy thủ công từ USB/Drive |
| 8 | Copy **`oauth2_credentials.json`** | Copy thủ công từ USB/Drive |
| 9 | Tạo thư mục Chrome | `mkdir backend/chrome_data_chatgpt` |
| 10 | Đăng nhập ChatGPT & Gemini | Dùng Login Helper trong app |

---

## 🚀 Cài đặt từ đầu trên máy mới (máy công ty)

### Bước 1 — Cài Node.js

Tải và cài Node.js **v18 trở lên** tại: https://nodejs.org

Kiểm tra:
```bash
node -v   # phải hiện v18.x.x hoặc cao hơn
npm -v
```

---

### Bước 2 — Cài Redis (bắt buộc)

Redis là hàng đợi xử lý công việc nền, **bắt buộc phải chạy** trước khi start app.

**Windows:**
1. Tải [Redis for Windows](https://github.com/tporadowski/redis/releases) (file `.msi`)
2. Cài đặt → Redis tự chạy như Windows Service

Kiểm tra Redis đang chạy:
```bash
redis-cli ping   # phải trả về PONG
```

---

### Bước 3 — Clone repo & cài dependencies

```bash
# Clone code từ GitHub
git clone https://github.com/Dotronghuy/watch_auto_publisher.git
cd watch_auto_publisher

# Cài dependencies (phải chạy ở CẢ 3 chỗ)
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

---

### Bước 4 — Cài Playwright browser (bắt buộc cho ChatGPT & Gemini)

```bash
cd backend
npx playwright install chromium
cd ..
```

---

### Bước 5 — Tạo file `.env` trong thư mục `backend/`

Tạo file **`backend/.env`** — copy từ máy cũ hoặc điền lại:

```env
PORT=3000

# Meta (Facebook/Instagram)
FB_PAGE_ACCESS_TOKEN=your_token_here
IG_ACCESS_TOKEN=your_token_here
IG_USER_ID=your_ig_user_id

# Redis
REDIS_URL=redis://localhost:6379

# Remove.bg (xóa phông ảnh AVT)
REMOVE_BG_API_KEY=your_key_here

# Google Drive
ROOT_DRIVE_FOLDER_ID=your_drive_folder_id
DRIVE_REFRESH_TOKEN=your_refresh_token
```

---

### Bước 6 — Copy file credentials (KHÔNG có trên GitHub)

> ⚠️ Các file này chứa thông tin nhạy cảm, **không được đẩy lên GitHub**.  
> Phải copy thủ công từ máy cũ qua USB hoặc gửi qua kênh bảo mật.

Cần copy 2 file vào thư mục `backend/config/`:
```
backend/config/credentials.json          ← Google Service Account
backend/config/oauth2_credentials.json   ← Google OAuth2 Client
```

Nếu chưa có `backend/config/oauth2_token.json` → chạy lần đầu sẽ tự tạo khi xác thực OAuth.

---

### Bước 7 — Tạo thư mục cần thiết

```bash
mkdir backend/chrome_data_chatgpt
mkdir backend/chrome_data_gemini
mkdir backend/temp_images
```

---

### Bước 8 — Đăng nhập ChatGPT & Gemini (lần đầu)

1. Chạy app: `npm run dev`
2. Mở http://localhost:5173
3. Vào **Cài đặt → Tài khoản AI**
4. Click **"Login ChatGPT"** → Cửa sổ Chrome mở ra → Đăng nhập thủ công
5. Click **"Login Gemini"** → Đăng nhập thủ công
6. Đóng cửa sổ sau khi đăng nhập xong

---

## 🏠 Máy nhà (đã có code cũ — chỉ cần update)

```bash
# Kéo code mới nhất về
git pull origin master

# Cài lại packages (phòng khi có package mới được thêm)
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# Chạy
npm run dev
```

---

## ▶️ Chạy ứng dụng

```bash
npm run dev
```

- **Frontend UI**: http://localhost:5173
- **Backend API**: http://localhost:3000

---

## 📄 Cập nhật file Prompt AI (.md)

Không cần chỉnh code. Chỉ cần:
1. Sửa file `.md` trên máy tính
2. Vào **Luồng công việc** → Click **"Chọn file .md"** trên node GPT-4 Vision
3. Chọn file → Upload tự động → Tool dùng prompt mới ngay lập tức ✅

---

## 📁 Cấu trúc thư mục

```
watch_auto_publisher/
├── backend/                     # Node.js + Express API
│   ├── config/                  # gpt_image_prompt.md, credentials (gitignored)
│   ├── src/
│   │   ├── config/              # settings.json
│   │   ├── services/            # publish, playwright, drive, sheet, meta...
│   │   ├── routes/              # API endpoints
│   │   └── utils/               # helper functions
│   ├── chrome_data_chatgpt/     # Profile Chrome ChatGPT (gitignored)
│   ├── chrome_data_gemini/      # Profile Chrome Gemini (gitignored)
│   └── temp_images/             # Ảnh tạm thời (gitignored)
├── frontend/                    # React + Vite UI
│   └── src/
│       ├── pages/               # Workflow, Dashboard, Calendar...
│       └── components/          # Layout, Topbar, Sidebar...
└── package.json                 # Root script chạy cả 2
```

---

## ⚠️ File KHÔNG có trên GitHub (phải xử lý thủ công)

| File | Lý do | Cách xử lý |
|------|-------|------------|
| `backend/.env` | Chứa API keys | Tạo lại / copy từ máy cũ |
| `backend/config/credentials.json` | Google Service Account | Copy từ máy cũ qua USB |
| `backend/config/oauth2_credentials.json` | Google OAuth2 | Copy từ máy cũ qua USB |
| `backend/config/oauth2_token.json` | OAuth token | Tự tạo khi chạy lần đầu |
| `backend/chrome_data_chatgpt/` | Session ChatGPT | Đăng nhập lại qua Login Helper |
| `backend/chrome_data_gemini/` | Session Gemini | Đăng nhập lại qua Login Helper |
