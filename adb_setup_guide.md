# Hướng dẫn Cài đặt & Thiết lập Giả lập ADB cho Hệ thống Auto Publisher

Hệ thống Watch Auto Publisher sử dụng ADB (Android Debug Bridge) để tự động hóa các thao tác trên thiết bị giả lập Android (như LDPlayer, NoxPlayer) nhằm phục vụ các tính năng như đính kèm link Shopee lên Facebook/Instagram hoặc các thao tác không được hỗ trợ bởi API chính thức.

Dưới đây là hướng dẫn chi tiết để thiết lập môi trường giả lập ADB cho dự án:

## Bước 1: Cài đặt Giả lập Android
Bạn cần cài đặt một phần mềm giả lập Android nhẹ và có hỗ trợ ADB tốt. Chúng tôi khuyến nghị sử dụng **LDPlayer** hoặc **NoxPlayer**.

- **LDPlayer** (Khuyên dùng): Tải tại [ldplayer.net](https://www.ldplayer.net/)
- **NoxPlayer**: Tải tại [bignox.com](https://www.bignox.com/)

## Bước 2: Bật tính năng ADB Debugging trên Giả lập
Sau khi cài đặt và khởi động giả lập:

### Đối với LDPlayer:
1. Mở phần **Cài đặt (Settings)** (biểu tượng bánh răng ở góc phải).
2. Chuyển sang tab **Cài đặt khác (Other Settings)**.
3. Tìm mục **ADB debugging** và chọn **Mở mạng kết nối (Open connection)**.
4. Lưu cài đặt và khởi động lại giả lập nếu được yêu cầu.

### Đối với NoxPlayer:
1. Mở **Cài đặt hệ thống (System settings)**.
2. Tại tab **Cài đặt chung (General settings)**, bật tuỳ chọn **Root**.
3. Khởi động lại giả lập.

## Bước 3: Cài đặt công cụ ADB trên máy tính (Windows)
Để chạy được các lệnh từ `backend/src/services/adb.service.js`, hệ thống cần công cụ `adb.exe` hoạt động.

1. Tải **SDK Platform-Tools** cho Windows từ trang chủ Android: [Tải tại đây](https://developer.android.com/studio/releases/platform-tools).
2. Giải nén thư mục tải về (ví dụ giải nén vào `C:\platform-tools`).
3. **Thêm vào System Environment Variables (Biến môi trường PATH)**:
   - Mở Start menu, tìm kiếm `Environment Variables` và chọn **Edit the system environment variables**.
   - Bấm vào nút **Environment Variables...**.
   - Trong phần **System variables**, tìm biến `Path` và bấm **Edit**.
   - Thêm đường dẫn `C:\platform-tools` vào danh sách.
   - Bấm OK để lưu lại.

*(Lưu ý: Nếu bạn sử dụng LDPlayer, phần mềm này thường đã tích hợp sẵn adb trong thư mục cài đặt, bạn có thể trỏ biến Path vào thư mục cài đặt của LDPlayer như `C:\LDPlayer\LDPlayer9`)*.

## Bước 4: Kiểm tra kết nối ADB
Mở cửa sổ Command Prompt (CMD) hoặc PowerShell mới và chạy lệnh sau để xem máy tính đã nhận giả lập chưa:

```bash
adb devices
```

**Kết quả mong đợi:**
Bạn sẽ thấy danh sách thiết bị đang kết nối. Ví dụ:
```
List of devices attached
emulator-5554   device
```
*(Lưu ý: Nếu danh sách trống, hãy kiểm tra lại xem giả lập đã bật chưa và ADB debugging đã được kích hoạt chưa)*.

## Bước 5: Cài đặt các ứng dụng cần thiết trên Giả lập
Vào giả lập Android, đăng nhập Google Play Store và cài đặt các ứng dụng cần thiết cho quá trình auto:
1. **Facebook**
2. **Instagram**
3. **Shopee** (nếu cần lấy link/thông tin)

Hãy đăng nhập sẵn các tài khoản mạng xã hội của cửa hàng trên giả lập này.

## Bước 6: Các lỗi thường gặp (Troubleshooting)
- **Lỗi `Không tìm thấy thiết bị giả lập nào kết nối qua ADB`**: Chạy lại lệnh `adb devices`, khởi động lại giả lập hoặc tắt/bật lại ADB Debugging.
- **Lỗi `adb is not recognized as an internal or external command`**: Bạn chưa thêm thư mục chứa `adb.exe` vào biến môi trường PATH của Windows (Xem lại Bước 3). Khởi động lại Terminal/CMD sau khi thêm PATH.
- **Lỗi gõ tiếng Việt / ký tự đặc biệt (`&`) qua ADB**: Hệ thống đã xử lý mã hóa các ký tự đặc biệt trong `adb.service.js`, nhưng bạn nên thiết lập bàn phím giả lập về tiếng Anh (English) để tránh xung đột Telex khi gửi text qua lệnh shell.
