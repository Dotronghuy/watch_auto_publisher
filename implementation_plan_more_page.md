# Hỗ Trợ Đăng Nhiều Tài Khoản Fanpage & Instagram Cùng Lúc

Yêu cầu của bạn là: Khi hệ thống bốc được 1 mã sản phẩm (SKU), nó sẽ tự động **đăng lên nhiều Fanpage và tài khoản IG khác nhau**. Đối với mỗi Fanpage/IG, nội dung bài viết (Caption) do AI sinh ra phải **hoàn toàn khác nhau (Unique)** để tránh bị Facebook đánh dấu Spam và phù hợp với từng tệp khách hàng.

Dưới đây là phương án kỹ thuật chi tiết. Bạn hãy đọc và xác nhận nhé!

## ⚠️ User Review Required

Tính năng này sẽ thay đổi khá nhiều ở giao diện cài đặt và luồng chạy của Backend. Vui lòng xem kỹ phần **Open Questions** và cho tôi biết ý kiến của bạn.

## ❓ Open Questions

1. **Giao diện cấu hình (Social Connections):** Tôi dự định sẽ xóa bỏ 4 ô nhập Token cứng nhắc hiện tại, thay vào đó làm một danh sách dạng bảng. Ở đó bạn có thể bấm nút **"Thêm tài khoản"**, đặt tên cho nó (VD: *Page Chuyên Hàng Lướt*, *Page Hàng Xách Tay*...) và dán Access Token vào. Bạn thấy OK với thiết kế này chứ?
2. **Hướng dẫn AI (Prompting):** Để AI viết bài khác nhau cho cùng 1 SKU, tôi sẽ thêm một trường "Phong cách viết" cho mỗi tài khoản bạn thêm vào. VD: Page A bạn đặt phong cách *"Ngắn gọn, giật tít, tập trung vào giá"*, Page B bạn đặt *"Chuyên gia phân tích máy cơ, kể chuyện dài"*. Hệ thống sẽ dùng yêu cầu này đưa cho ChatGPT để đẻ ra bài viết tương ứng. Ý tưởng này có đúng ý bạn không?
3. **Hiển thị trên Live Monitor:** Khi đăng cùng 1 SKU lên 3 Page khác nhau, AI sẽ viết 3 bài. Trên giao diện Live Monitor (Màn hình Workflow), tôi sẽ cho hiển thị lần lượt từng bài viết lên thẻ Facebook/IG khi nó đang xử lý Page đó (hiển thị nối tiếp nhau). Bạn có đồng ý không?

## 🛠 Proposed Changes

---

### Backend Data Storage

Sẽ chuyển từ việc lưu Token trong `.env` sang lưu mảng tài khoản trong tệp tin JSON tĩnh.

#### [NEW] [accounts.json](file:///C:/Users/Admin/Downloads/watch-auto-publisher/backend/config/accounts.json)
- Lưu danh sách mảng các tài khoản dưới dạng JSON, bao gồm: `id`, `name`, `stylePrompt`, `fbAccessToken`, `fbPageId`, `igAccessToken`, `igUserId`, `isActive`.

#### [MODIFY] [api.routes.js](file:///C:/Users/Admin/Downloads/watch-auto-publisher/backend/src/routes/api.routes.js)
- Thêm các Route mới `GET /api/accounts` và `POST /api/accounts` để Frontend có thể lấy và cập nhật danh sách tài khoản.
- Viết hàm đọc/ghi file `accounts.json`. Quá trình lưu tài khoản đầu tiên sẽ tự động bê các giá trị cũ từ `.env` sang.

---

### Backend Workflow

Thay đổi kịch bản cốt lõi khi một Job tự động được chạy.

#### [MODIFY] [publish.service.js](file:///C:/Users/Admin/Downloads/watch-auto-publisher/backend/src/services/publish.service.js)
- Sửa đổi hàm `autoPublishRoutine` và `dryRunRoutine`.
- Thay vì lấy thông tin từ `process.env.FB_PAGE_ID`, hệ thống sẽ đọc `accounts.json` và lọc ra các tài khoản đang `isActive = true`.
- **Vòng lặp (Loop):** Sau khi bốc được 1 SKU và lấy thư mục ảnh xong, hệ thống sẽ duyệt qua từng tài khoản trong danh sách.
- **Sinh Content:** Gửi Prompt sang ChatGPT, đính kèm thêm biến `{{STYLE_PROMPT}}` của riêng tài khoản đó để ChatGPT viết bài mới tinh.
- **Đăng bài (Upload):** Sử dụng các Access Token tương ứng của tài khoản đang chạy để POST ảnh và Feed qua Graph API.

---

### Frontend UI

Làm lại giao diện Cài đặt Mạng xã hội để hỗ trợ nhiều tài khoản.

#### [MODIFY] [SocialConnections.jsx](file:///C:/Users/Admin/Downloads/watch-auto-publisher/frontend/src/pages/SocialConnections.jsx)
- Xóa bỏ giao diện nhập Token đơn lẻ trong Section 2.
- Thêm giao diện Quản lý danh sách tài khoản (List view).
- Thêm Modal popup để điền: Tên tài khoản, Phong cách Content, Facebook Token, Facebook Page ID, Instagram Token, Instagram User ID.
- Gọi API `/api/accounts` để đồng bộ dữ liệu.

## 🧪 Verification Plan

### Automated Tests
- Test API GET/POST `/api/accounts` bằng Curl để đảm bảo file JSON được lưu chính xác.

### Manual Verification
- Khởi động lại Frontend, vào Cài đặt -> Mạng xã hội để tạo thử 2 tài khoản giả lập.
- Chạy thử chế độ **[Test 5 Phút / Lần]** trên Workflow.
- Theo dõi Terminal để xác nhận AI sinh ra 2 bài Content có độ dài và văn phong khác biệt, và gọi hàm API bằng 2 Token khác nhau.
