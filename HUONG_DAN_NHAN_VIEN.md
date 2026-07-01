# 📋 HƯỚNG DẪN CÀI ĐẶT & SỬ DỤNG - Watch Auto Publisher

## 🔧 CÀI ĐẶT LẦN ĐẦU (Chỉ làm 1 lần)

### Bước 1: Cài đặt Node.js
1. Truy cập: https://nodejs.org
2. Tải bản **LTS** (nút màu xanh lá, bên trái)
3. Chạy file cài đặt, **nhấn Next cho đến khi xong** (giữ nguyên mặc định)
4. **Khởi động lại máy tính**

### Bước 2: Cài đặt Git
1. Truy cập: https://git-scm.com/downloads/win
2. Tải bản **64-bit**
3. Chạy file cài đặt, **nhấn Next cho đến khi xong** (giữ nguyên mặc định)
4. **Khởi động lại máy tính**

### Bước 3: Nhận thư mục dự án
- Anh/chị sẽ gửi cho bạn thư mục `watch_auto_publisher-master`
- Hoặc copy từ USB / gửi qua mạng nội bộ
- Đặt thư mục ở bất kỳ đâu trên máy (ví dụ: `C:\Users\TenBan\Desktop\watch_auto_publisher-master`)

### Bước 4: Chạy cài đặt
1. Mở thư mục `watch_auto_publisher-master`
2. **Double-click** vào file `1_CAI_DAT_LAN_DAU.bat`
3. Đợi cho đến khi thấy dòng **"CAI DAT THANH CONG!"**
4. Nếu báo lỗi thiếu Node.js hoặc Git → quay lại Bước 1-2

> ⏱️ Quá trình cài đặt mất khoảng **5-15 phút** tùy tốc độ mạng

---

## 🚀 SỬ DỤNG HÀNG NGÀY

### Chạy Tool
1. Mở thư mục `watch_auto_publisher-master`
2. **Double-click** vào file `2_CHAY_TOOL.bat`
3. Đợi vài giây cho tool khởi động
4. Mở trình duyệt (Chrome), truy cập: **http://localhost:5173**

### Tắt Tool
- Vào cửa sổ đen (Command Prompt) và nhấn `Ctrl + C`
- Hoặc đóng cửa sổ đen

---

## ⚠️ LƯU Ý QUAN TRỌNG

- **KHÔNG XÓA** bất kỳ file nào trong thư mục dự án
- **KHÔNG ĐÓNG** cửa sổ đen khi đang sử dụng tool
- Nếu tool bị lỗi → tắt cửa sổ đen → chạy lại `2_CHAY_TOOL.bat`
- Nếu vẫn lỗi → chạy lại `1_CAI_DAT_LAN_DAU.bat` rồi chạy `2_CHAY_TOOL.bat`

---

## 🆘 XỬ LÝ LỖI THƯỜNG GẶP

| Lỗi | Cách xử lý |
|------|-----------|
| `'node' is not recognized` | Cài lại Node.js và **khởi động lại máy** |
| `'git' is not recognized` | Cài lại Git và **khởi động lại máy** |
| `EACCES` hoặc `Permission denied` | Nhấn phải chuột vào file .bat → **Chạy với quyền Admin** |
| `Port 3000 already in use` | Mở Task Manager → tìm và tắt process Node.js cũ |
| `Port 5173 already in use` | Mở Task Manager → tìm và tắt process Node.js cũ |
| Tool chạy nhưng không mở được web | Kiểm tra đã truy cập đúng **http://localhost:5173** |
