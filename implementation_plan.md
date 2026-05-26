# Kế hoạch Thống Trị Instagram & Threads (Giai đoạn 4)

Để đăng ảnh lên Instagram (IG) và Threads qua API chính thức, mạng xã hội yêu cầu chúng ta phải truyền vào **Link ảnh công khai (Public URL)** chứ không cho tải file trực tiếp từ máy tính lên.

**Giải pháp (Trích xuất Link ảnh từ Facebook):**
Chúng ta sẽ "lợi dụng" Facebook làm kho lưu trữ ảnh tạm thời. Khi có ảnh (từ Drive hoặc AI vẽ), hệ thống sẽ ngầm tải ảnh lên Facebook dưới dạng "Ẩn" (Unpublished). Sau đó, lấy cái link ảnh công khai từ Facebook đó để bắn sang API của Instagram và Threads! Vừa nhanh, vừa miễn phí, vừa mượt!

## User Review Required & Open Questions
> [!IMPORTANT]
> Để code có thể chạy được, bạn cần chuẩn bị các thông số sau trong file `.env`:
> 1. **IG_USER_ID**: ID của tài khoản Instagram Business (đã liên kết với Fanpage). Bạn đã biết cách lấy ID này chưa?
> 2. **Threads API**: Threads vừa ra mắt API chính thức, yêu cầu bạn phải có `THREADS_USER_ID` và `THREADS_ACCESS_TOKEN`. Bạn đã tạo App Threads trên giao diện Meta Developer chưa? 
> 3. **Cột trên Google Sheets**: Tôi sẽ code để hệ thống ghi thêm lịch sử đăng của IG và Threads. Bạn vui lòng tạo thêm 2 cột trên Sheets: `Post ID IG` và `Post ID Threads` (ví dụ ở cột AL và AM).

## Proposed Changes

---

### Tổ chức lại cấu trúc Code (Refactoring)
Thay vì nhồi nhét tất cả vào `publish.service.js`, ta sẽ tách riêng các "Vòi bạch tuộc" để dễ nâng cấp sau này.

#### [NEW] [facebook.service.js](file:///c:/Users/Admin/Downloads/watch-auto-publisher/backend/src/services/facebook.service.js)
- Chuyển logic đăng bài Facebook (Single & Album) từ `publish.service.js` sang đây.
- Thêm hàm `uploadHiddenPhotos(filePaths)`: Tải ảnh ẩn lên Facebook để lấy URL công khai.

#### [NEW] [instagram.service.js](file:///c:/Users/Admin/Downloads/watch-auto-publisher/backend/src/services/instagram.service.js)
- Thêm hàm `postToInstagram(imageUrls, caption, isCarousel)`:
  - Nếu là Single Image: Gọi API tạo Media Container -> Publish.
  - Nếu là Album (Carousel): Tạo từng Media Container con -> Gom vào Carousel Container -> Publish.

#### [NEW] [threads.service.js](file:///c:/Users/Admin/Downloads/watch-auto-publisher/backend/src/services/threads.service.js)
- Thêm hàm `postToThreads(imageUrl, caption)`: Gọi API `graph.threads.net` để đăng bài. Do Threads thiên về chữ, ta có thể giới hạn chỉ lấy tấm ảnh đẹp nhất (ảnh đầu tiên) để đăng cùng text.

---

### Cập nhật Dịch vụ Chính

#### [MODIFY] [publish.service.js](file:///c:/Users/Admin/Downloads/watch-auto-publisher/backend/src/services/publish.service.js)
- Logic bốc thăm và AI giữ nguyên.
- Sau khi AI viết Content xong:
  1. Gọi `facebook.service.js` để tải ảnh ẩn, lấy về mảng `publicImageUrls`.
  2. Dùng `publicImageUrls` này chạy đồng thời (Promise.all) các lệnh:
     - `postToFacebook(...)`
     - `postToInstagram(...)`
     - `postToThreads(...)`
  3. Lấy kết quả ID của cả 3 nền tảng.

#### [MODIFY] [sheet.service.js](file:///c:/Users/Admin/Downloads/watch-auto-publisher/backend/src/services/sheet.service.js)
- Cập nhật hàm `updateProductPostInfo` để ghi ID bài đăng vào đúng 3 cột: `Post ID FB`, `Post ID IG`, `Post ID Threads`.

## Verification Plan
1. Viết 1 file test nhỏ `test-omnichannel.js` để chạy thử riêng việc lấy Public URL từ ảnh ẩn Facebook.
2. Đẩy thử 1 post lên Instagram qua Graph API để kiểm tra Container có hoạt động (đặc biệt với Album).
3. Hỏi người dùng cung cấp Token Threads để chạy test API Threads.
