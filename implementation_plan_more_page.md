# Hỗ Trợ Đăng Nhiều Tài Khoản Fanpage & Instagram Cùng Lúc

Yêu cầu của bạn là: Khi hệ thống bốc được 1 mã sản phẩm (SKU), nó sẽ tự động **đăng lên nhiều Fanpage và tài khoản IG khác nhau**. Đối với mỗi Fanpage/IG, nội dung bài viết (Caption) do AI sinh ra phải **hoàn toàn khác nhau (Unique)** để tránh bị Facebook đánh dấu Spam và phù hợp với từng tệp khách hàng.

Dưới đây là phương án kỹ thuật chi tiết sau khi đã tinh chỉnh theo phản hồi của bạn. Bạn hãy đọc và xác nhận để tôi bắt đầu code nhé!

## ⚠️ User Review Required

Vui lòng xem lại plan đã được cập nhật bên dưới và xác nhận nếu bạn đồng ý để tôi tiến hành lập trình.

## ❓ Open Questions (Đã được thống nhất)

1. **Giao diện cấu hình (Social Connections):** (Đồng ý) Xóa bỏ 4 ô nhập Token cứng nhắc hiện tại, thay vào đó làm một danh sách dạng bảng. Ở đó bạn có thể bấm nút **"Thêm tài khoản"**, đặt tên cho nó (VD: *Page Chuyên Hàng Lướt*, *Page Hàng Xách Tay*...) và dán Access Token vào.
2. **Hướng dẫn AI (Prompting):** (Đã điều chỉnh) Không cần nhập phong cách riêng cho từng Fanpage. Hệ thống vẫn sẽ giữ nguyên cơ chế **chọn Random Prompt Giọng văn** hiện tại (từ tệp `.md`). Tuy nhiên, thay vì chỉ gọi AI 1 lần cho tất cả, hệ thống sẽ **gọi AI viết bài mới cho từng Fanpage**. Tức là nếu có 3 Fanpage, AI sẽ được gọi 3 lần, mỗi lần sẽ tự động mix giọng văn ngẫu nhiên để đảm bảo bài viết ra là hoàn toàn Unique.
3. **Hiển thị trên Live Monitor & Luồng đăng bài:** (Đã điều chỉnh) Sẽ áp dụng cơ chế **chạy nối tiếp (Sequential)**. Đối với 1 SKU:
   - Hệ thống xử lý Fanpage 1 -> Sinh Content riêng cho Page 1 -> Đăng lên Page 1 -> Hiển thị kết quả lên Live Monitor.
   - Xong Fanpage 1, hệ thống mới chuyển sang Fanpage 2 -> Sinh Content riêng cho Page 2 -> Đăng lên Page 2 -> Cập nhật Live Monitor.
   - Quá trình cứ tiếp tục như vậy. Đảm bảo Fanpage nào đăng trước sẽ hiện kết quả trước, rất rõ ràng và tuần tự.

## 🛠 Proposed Changes

---

### Backend Data Storage

Sẽ chuyển từ việc lưu Token trong `.env` sang lưu mảng tài khoản trong tệp tin JSON tĩnh.

#### [NEW] [accounts.json](file:///C:/Users/Admin/Downloads/watch-auto-publisher/backend/config/accounts.json)
- Lưu danh sách mảng các tài khoản dưới dạng JSON, bao gồm: `id`, `name`, `fbAccessToken`, `fbPageId`, `igAccessToken`, `igUserId`, `isActive`.

#### [MODIFY] [api.routes.js](file:///C:/Users/Admin/Downloads/watch-auto-publisher/backend/src/routes/api.routes.js)
- Thêm các Route mới `GET /api/accounts` và `POST /api/accounts` để Frontend có thể lấy và cập nhật danh sách tài khoản.
- Viết hàm đọc/ghi file `accounts.json`. Quá trình lưu tài khoản đầu tiên sẽ tự động bê các giá trị cũ từ `.env` sang để bạn không phải nhập lại.

---

### Backend Workflow

Thay đổi kịch bản cốt lõi khi một Job tự động được chạy.

#### [MODIFY] [publish.service.js](file:///C:/Users/Admin/Downloads/watch-auto-publisher/backend/src/services/publish.service.js)
- Sửa đổi hàm `autoPublishRoutine` và `dryRunRoutine`.
- Thay vì lấy thông tin từ `process.env.FB_PAGE_ID`, hệ thống sẽ đọc `accounts.json` và lọc ra các tài khoản đang được bật (`isActive = true`).
- **Khắc phục lỗi AI lặp văn phong:** Sẽ code thêm một bộ xáo trộn (Randomizer) trực tiếp bằng Node.js. Bộ này sẽ chọn ngẫu nhiên 1 trong 7 Tông giọng và 1 trong 7 Góc nhìn, sau đó **nhét thẳng yêu cầu bắt buộc này vào Prompt gửi cho ChatGPT** (VD: *"Bắt buộc viết theo TONE-03 và Góc nhìn 5"*). Việc này ép ChatGPT phải thay đổi công thức thay vì tự ý dùng công thức an toàn quen thuộc như hiện tại.
- **Vòng lặp Nối tiếp (Sequential Loop):** 
  - Khởi tạo vòng lặp `for...of` chạy qua từng tài khoản được chọn.
  - Mỗi vòng lặp sẽ gọi hàm `generateContentOnChatGPT()` kèm theo Tone/Perspective ngẫu nhiên để AI viết một bài mới hoàn toàn.
  - Dùng Access Token của tài khoản hiện tại để gọi Graph API đăng bài.
  - Bắn Log (SSE) về cho Live Monitor theo thời gian thực (đang đăng page nào, nội dung gì).

---

### Frontend UI

Làm lại giao diện Cài đặt Mạng xã hội để hỗ trợ nhiều tài khoản.

#### [MODIFY] [SocialConnections.jsx](file:///C:/Users/Admin/Downloads/watch-auto-publisher/frontend/src/pages/SocialConnections.jsx)
- Xóa bỏ giao diện nhập Token đơn lẻ trong Section 2.
- Thêm giao diện Quản lý danh sách tài khoản (List view).
- Thêm Modal popup để điền: Tên tài khoản, Facebook Token, Facebook Page ID, Instagram Token, Instagram User ID (đã bỏ trường Phong cách Content theo yêu cầu).
- Gọi API `/api/accounts` để đồng bộ dữ liệu.

## 🧪 Verification Plan

### Automated Tests
- Test API GET/POST `/api/accounts` bằng Postman/Curl để đảm bảo file JSON được lưu chính xác.

### Manual Verification
- Khởi động lại Frontend, vào Cài đặt -> Mạng xã hội để tạo thử 2 tài khoản.
- Chạy thử chế độ **[Chạy Thử (Dry Run)]** trên Workflow.
- Theo dõi Live Monitor để xác nhận:
  1. AI viết bài cho Page 1 và hiển thị.
  2. Sau đó AI tiếp tục viết bài khác cho Page 2 và hiển thị.
  3. Nội dung 2 bài phải khác nhau do cơ chế Random Prompt.
