# ZenWatch Shopee Link Worker

Ứng dụng Android nội bộ nhận tác vụ từ backend qua HTTPS và thực hiện chuỗi thao tác trong
ứng dụng Facebook:

1. Mở đúng bài Fanpage vừa đăng.
2. Mở menu ba chấm.
3. Chọn **Quản lý liên kết đến sản phẩm**.
4. Nhập URL Shopee và tên liên kết.
5. Bấm **Lưu** và trả kết quả về backend.

Với bài video/Reels, ứng dụng không mở trình xem Reels toàn màn hình. Worker mở profile
Fanpage, chọn tab **Tất cả**, ưu tiên thẻ bài có caption khớp nội dung backend vừa đăng,
sau đó dùng thẻ bài mới nhất làm phương án dự phòng có giới hạn:

1. Bấm dấu ba chấm ở header của đúng thẻ bài Reels.
2. Chọn **Quản lý sản phẩm**.
3. Chọn **Thêm sản phẩm liên kết tiếp thị**.
4. Nhập URL Shopee, tên liên kết và bấm **Lưu**.

Bài viết/ảnh thường vẫn mở bằng permalink chính xác như trước.

Điện thoại không cần USB hoặc kết nối chung Wi-Fi với máy tính.

## Kết nối HTTPS ổn định bằng Tailscale Funnel

Tailscale được cài trên máy Windows chạy backend. Sau khi đăng nhập một lần, mở PowerShell
bằng quyền Administrator và chạy:

```powershell
cd backend
npm.cmd run start:mobile-worker-stack
npm.cmd run start:mobile-worker-funnel
```

Funnel chuyển tiếp địa chỉ HTTPS cố định `https://<máy>.<tailnet>.ts.net` tới cổng gateway
chỉ dành cho Mobile Worker tại `http://127.0.0.1:3100`. Tùy chọn `--bg` được lưu trong
dịch vụ Tailscale và tự hoạt động lại sau khi Windows khởi động.

Ghi URL cố định vào `MOBILE_WORKER_BASE_URL` trong `backend/.env`, sau đó chạy:

```powershell
npm.cmd run configure:mobile-worker
npx.cmd prisma migrate deploy
npm.cmd run test:mobile-worker
npm.cmd run test:mobile-worker-gateway
npm.cmd run test:mobile-worker-public
```

Thông tin cần nhập vào điện thoại được ghi ở:

```text
backend/config/mobile_worker_pairing.txt
```

## Cài trên Samsung

1. Cài APK và cho phép cài ứng dụng không rõ nguồn gốc.
2. Mở app, nhập URL HTTPS cố định Tailscale và token trong file pairing.
3. Bấm **Kiểm tra kết nối**.
4. Bấm **Bật quyền Trợ năng**, chọn **ZenWatch – Gắn link Shopee** và bật dịch vụ.
5. Trong cài đặt Pin của Samsung, đặt app thành **Không giới hạn**.
6. Đặt kiểu khóa màn hình thành **Không dùng** hoặc **Vuốt**. Android không cho ứng dụng
   tự vượt qua PIN, mật khẩu, hình vẽ hay sinh trắc học.
7. Nên cắm sạc điện thoại trong thời gian chạy lịch tự động.
8. Đăng nhập Facebook và chuyển đúng sang Fanpage cần quản lý.
9. Đánh dấu **Tự khởi động Worker sau khi mở máy**.
10. Quay lại app và bấm **Bắt đầu Worker**.

Worker giữ CPU hoạt động khi màn hình tắt. Khi backend có tác vụ mới, ứng dụng tự bật màn
hình, tạm bỏ màn hình khóa dạng **Vuốt**, mở Facebook và giữ màn hình sáng cho đến khi gửi
kết quả. Khi không có tác vụ, màn hình được phép tắt bình thường.

## Build

Yêu cầu JDK 17 và Android SDK 35:

```powershell
.\gradlew.bat assembleDebug
```

APK debug được tạo tại:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Cấu hình backend

- `MOBILE_WORKER_TOKEN`: token xác thực điện thoại.
- `MOBILE_WORKER_BASE_URL`: URL HTTPS cố định do Tailscale Funnel cấp.
- `MOBILE_SHOPEE_LINK_MODE=android_worker`: dùng Android Worker.
- `MOBILE_SHOPEE_LINK_MODE=disabled`: tắt bước gắn link.
- `MOBILE_SHOPEE_LINK_NAME`: tên liên kết, mặc định `Mua ở đây`.

## Giới hạn

- Selector hỗ trợ giao diện Facebook tiếng Việt trong ảnh tham chiếu và một số nhãn tiếng
  Anh tương đương.
- Facebook đổi giao diện có thể yêu cầu cập nhật selector.
- Đây là APK nội bộ. Nếu phát hành Google Play phải hoàn thành khai báo Accessibility
  Service và phần công khai/đồng ý dữ liệu theo chính sách Play.
