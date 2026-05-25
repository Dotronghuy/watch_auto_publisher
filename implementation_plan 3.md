# Kế Hoạch Giai Đoạn 3: Logic Nội Dung Nâng Cao (AI Image & Multi-photo)

Dựa trên yêu cầu mới nhất, kịch bản bốc ảnh và đăng bài sẽ trở nên phức tạp và thông minh hơn rất nhiều. Hệ thống sẽ không chỉ đăng 1 ảnh đơn thuần nữa.

## Luồng Xử Lý Mới

### 1. Bốc ngẫu nhiên loại Thư mục (AVT / Ảnh Hãng / Tự Chụp)
Thay vì luôn chui vào `0_Anh_AVT`, hệ thống sẽ bốc ngẫu nhiên 1 trong các thư mục con của mã SKU đó. Tùy thuộc vào thư mục bốc trúng mà hành động sẽ khác nhau:

### 2. Kịch bản A: Trúng `0_Anh_AVT` (Dùng AI tạo ảnh)
- **Hành động**: Chỉ lấy 1 ảnh gốc từ Drive.
- **Xử lý AI**: Gửi thông tin sang n8n (kèm cờ `isAVT = true`).
- **Trong n8n**: Sẽ cấu hình để n8n gọi Gemini viết Content, ĐỒNG THỜI gọi thêm ChatGPT (DALL-E 3) để tạo ra 1 tấm ảnh mới mang phong cách sang trọng dựa trên nội dung bài viết.
- **Node.js**: Nhận cả Content + Link ảnh mới do AI tạo ra -> Tải ảnh AI đó về -> Đăng lên Facebook.

### 3. Kịch bản B: Trúng `Ảnh Hãng` hoặc `Tự Chụp` (Đăng Album nhiều ảnh)
- **Hành động**: Lấy **TẤT CẢ** các ảnh có trong thư mục đó.
- **Xử lý AI**: Bốc ngẫu nhiên 1 tấm ảnh trong số đó gửi sang n8n để AI "nhìn hình đoán chữ" và viết Content.
- **Node.js**: 
  - Tải toàn bộ ảnh trong thư mục đó về máy.
  - Sử dụng API Facebook nâng cao để upload từng ảnh lên chế độ "ẩn" (unpublished).
  - Lấy danh sách ID của các ảnh vừa tải lên.
  - Gắn Content của AI và danh sách ID ảnh vào để **đăng thành 1 bài viết Album hoàn chỉnh**.

## User Review Required
> [!IMPORTANT]
> **Về việc tạo ảnh AI bằng DALL-E (ChatGPT)**
> Để ChatGPT tạo được ảnh, bạn sẽ cần phải có tài khoản OpenAI nạp sẵn tiền (API của DALL-E 3 tốn khoảng 0.04$ / 1 tấm ảnh). Bạn đã có sẵn API Key của OpenAI chưa?
> 
> **Về giới hạn số lượng ảnh (Kịch bản B)**
> Khi lấy TẤT CẢ ảnh trong folder `Ảnh Hãng` hoặc `Tự Chụp`, nếu folder đó có quá nhiều ảnh (vd: 30 ảnh), việc đăng lên Facebook có thể bị lỗi hoặc trông rất loãng. 
> 👉 **Đề xuất**: Chúng ta nên giới hạn chỉ bốc ngẫu nhiên tối đa **4 hoặc 5 ảnh** trong folder đó để tạo thành 1 bài đăng đẹp mắt nhất. Bạn có đồng ý giới hạn số lượng ảnh không?

## Proposed Changes
### [MODIFY] `backend/src/services/publish.service.js`
- Cập nhật logic `Math.random()` để bốc ngẫu nhiên thư mục thay vì fix cứng `0_Anh_AVT`.
- Thêm logic xử lý lấy mảng ảnh (array) thay vì 1 ảnh.
- Cập nhật payload gửi sang n8n: thêm biến `folderType`.
- Viết lại hàm gọi API Facebook Facebook Graph API để hỗ trợ `attached_media` (đăng nhiều ảnh).

### Cấu hình trên n8n (Thao tác tay của bạn sau khi code xong)
- Tôi sẽ hướng dẫn bạn thêm node "Switch" (Rẽ nhánh) trong n8n: Nếu `folderType == 'AVT'` thì gọi DALL-E tạo ảnh. Nếu không thì chỉ gọi Gemini lấy chữ.

## Verification Plan
1. Code xong, tôi sẽ chạy thử để bắt nó vào Kịch bản B (Đăng nhiều ảnh) để xem Facebook có lên bài dạng Album chuẩn không.
2. Kiểm tra xem payload trả về từ n8n khi có ảnh AI (Kịch bản A) có hoạt động đúng không.
