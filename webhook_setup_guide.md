# Hướng dẫn cài đặt Webhook Facebook để Test AI Chatbot

Tài liệu này hướng dẫn cách kết nối Facebook App với hệ thống CRM local của bạn thông qua `localtunnel`, giúp bạn nhận tin nhắn thật từ Facebook và kiểm tra luồng hoạt động của AI Chatbot ngay lập tức.

## 1. Thông tin Webhook hiện tại

*   **URL Public:** `https://iwcarnival-webhook.loca.lt`
*   **Webhook Callback URL:** `https://iwcarnival-webhook.loca.lt/webhook`
*   **Verify Token:** `vuadongho_crm_2024`

> [!NOTE]
> Đường dẫn trên được tạo bởi `localtunnel`. Nếu bạn tắt máy hoặc tắt terminal chạy tunnel, bạn sẽ cần phải chạy lại lệnh khởi tạo và cập nhật lại URL trong Facebook Developer.

## 2. Các bước cấu hình trên Facebook Developer

Để Facebook có thể gửi tin nhắn đến server local của bạn, hãy làm theo các bước sau:

1.  Truy cập vào trang [Facebook for Developers](https://developers.facebook.com/apps/) và chọn ứng dụng (App) của bạn.
2.  Ở menu bên trái, tìm đến phần **Messenger** > **Settings** (hoặc chọn mục **Webhooks** nếu bạn cấu hình ở cấp độ App).
3.  Tìm đến phần **Webhooks** và nhấn nút **Add Callback URL** (Thêm URL gọi lại) hoặc **Edit Callback URL** (Chỉnh sửa URL gọi lại).
4.  Trong cửa sổ hiện ra, điền thông tin sau:
    *   **Callback URL:** Nhập chính xác `https://iwcarnival-webhook.loca.lt/webhook`
    *   **Verify Token:** Nhập `vuadongho_crm_2024`
5.  Nhấn **Verify and Save** (Xác minh và Lưu). Facebook sẽ gửi một request kiểm tra đến server của bạn. Nếu thành công, cửa sổ sẽ đóng lại.
6.  Sau khi lưu thành công, bạn cần chọn các sự kiện (events) để đăng ký (Subscribe). Hãy chọn **Edit Subscriptions** (Chỉnh sửa đăng ký) cho Page tương ứng và tick chọn các sự kiện sau:
    *   `messages`
    *   `messaging_postbacks`
    *   `message_reactions`
7.  Nhấn **Save** (Lưu).

> [!IMPORTANT]
> Backend server của bạn **phải đang chạy** khi bạn nhấn "Verify and Save", nếu không Facebook sẽ báo lỗi kết nối. Hiện tại tôi đã khởi động backend cho bạn trên cổng `3000` (task đang chạy ngầm).

## 3. Quản lý Localtunnel

Nếu bạn cần khởi động lại tunnel, hãy mở một terminal mới và chạy lệnh sau (đảm bảo bạn đã cài node.js):

```bash
npx --yes localtunnel --port 3000 --subdomain iwcarnival-webhook
```

Lệnh này sẽ đảm bảo bạn luôn nhận được domain `iwcarnival-webhook.loca.lt` (miễn là nó chưa bị ai khác lấy).

## 4. Cách kiểm tra toàn trình

1.  Mở Facebook Messenger (bằng tài khoản cá nhân).
2.  Gửi tin nhắn vào Fanpage mà bạn đã liên kết với App.
3.  Mở giao diện tab **Inbox** trên ứng dụng local của bạn.
4.  Bạn sẽ thấy tin nhắn nhảy lên ngay lập tức và AI sẽ bắt đầu phân tích rồi tự động trả lời (nếu chế độ Bot đang ở trạng thái 🤖 bật).
