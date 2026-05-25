# Watch Auto Publisher

Hệ thống tự động đăng bài lên nhiều nền tảng (Facebook, Instagram, Threads, TikTok).
Nguồn ảnh được lấy từ Google Drive, tự động được viết nội dung qua AI (ChatGPT/Gemini), và đẩy lên các nền tảng thông qua hàng đợi.

## Cấu trúc
- `frontend`: React + Vite
- `backend`: Node.js + Express + BullMQ (Redis)

## Cài đặt và Chạy

### 1. Backend
Yêu cầu: Đã cài Docker để chạy Redis.
```bash
docker-compose up -d
cd backend
npm install
npm run dev
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```
