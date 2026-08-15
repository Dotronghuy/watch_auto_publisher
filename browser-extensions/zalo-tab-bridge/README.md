# ZenWatch Zalo Tab Bridge

Extension này cho phép ZenWatch Tool đăng bài bằng **đúng tab Zalo Web đang đăng nhập sẵn**, không tạo profile Zalo Playwright riêng.

## Cài lần đầu

1. Mở `chrome://extensions/` trong Chrome, hoặc `vivaldi://extensions/` nếu dùng Vivaldi.
2. Bật **Chế độ dành cho nhà phát triển / Developer mode**.
3. Chọn **Tải tiện ích đã giải nén / Load unpacked**.
4. Chọn thư mục `browser-extensions/zalo-tab-bridge` này.
5. Ghim extension **ZenWatch Zalo Tab Bridge** lên thanh công cụ.

## Kết nối

1. Trong ZenWatch Tool, vào trang **Zalo Auto Post** và bấm **Tạo mã kết nối**.
2. Mở tab `https://chat.zalo.me/` đã đăng nhập đúng tài khoản công việc.
3. Bấm icon extension, nhập mã 6 số và chọn **Kết nối tab Zalo hiện tại**.
4. Quay lại ZenWatch Tool. Trạng thái phải chuyển thành **Đã kết nối** trước khi bắt đầu chiến dịch.

Sau lần ghép mã đầu tiên, extension lưu khóa thiết bị trong Chrome và tự xin session mới mỗi khi ZenWatch Tool khởi động lại. Bạn không cần tạo mã mới miễn là vẫn dùng extension và tab Zalo đã chọn.

## Lưu ý

- Giữ tab Zalo Web mở trong suốt chiến dịch.
- Không mở DevTools trên tab Zalo trong lúc tool đang đăng.
- Khi extension bắt đầu thao tác, Chromium có thể hiển thị thông báo tab đang được debug. Đây là cơ chế `chrome.debugger` dùng để điều khiển chính tab đã chọn.
- Nếu ZenWatch Tool/backend khởi động lại, extension sẽ tự kết nối lại. Mã mới chỉ cần khi tab Zalo đã chọn bị đóng/xóa, extension bị xóa, đổi tài khoản hoặc chủ động ngắt kết nối.
- Extension chỉ chấp nhận backend `localhost` và chỉ kết nối tab `https://chat.zalo.me/`.
- Sau khi cập nhật extension, mở trang quản lý tiện ích và bấm **Tải lại / Reload** ở ZenWatch Zalo Tab Bridge trước khi chạy chiến dịch tiếp theo.
