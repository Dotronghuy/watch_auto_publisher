# Kế Hoạch Giai Đoạn 2: Tự Động Hóa Đăng Bài (Backend Queue)

Hệ thống hiện tại đã có thể đăng bài hoàn chỉnh, nhưng cần phải gõ lệnh bằng tay (`test-real-post.js`). Trong giai đoạn này, chúng ta sẽ biến nó thành một hệ thống tự động hoàn toàn (Auto Publisher) chạy ngầm 24/7.

## Luồng Hoạt Động Mới
1. **Cronjob (Hẹn giờ)**: Cứ mỗi `X` giờ, hệ thống tự động tạo ra một nhiệm vụ (Job) "Đăng Bài Mới".
2. **Hàng đợi (Queue)**: Nhiệm vụ này được đẩy vào Redis Queue (BullMQ). Việc dùng Queue giúp hệ thống không bị sập nếu có quá nhiều bài cần đăng, và tự động thử lại (retry) nếu mạng xã hội bị lỗi mạng.
3. **Công nhân (Worker)**: `publish.worker.js` sẽ bắt lấy Job này, chạy logic bốc ảnh từ Drive -> Gọi n8n -> Đăng Facebook.

## Cấu Trúc Backend
1. **`backend/src/utils/history.js`**: File chứa logic lưu lại ID của các ảnh đã đăng vào file `posted_history.json`. Nó sẽ kiểm tra và đảm bảo không lấy những ảnh đã đăng trong vòng 24 giờ qua. Các ảnh đăng sau 24h sẽ được "tái chế" lại thành ảnh mới.
2. **`backend/src/services/publish.service.js`**: Tách logic đăng bài từ `test-real-post.js` sang một Service tái sử dụng được, xử lý bốc random SKU, lọc ảnh trùng, tải về, gọi n8n, và ném lên FB.
3. **`backend/src/workers/publish.worker.js`**: Lắng nghe `publishQueue`. Khi có Job bay vào, nó sẽ kích hoạt `publish.service.js` chạy.
4. **`backend/src/scheduler.js`**: Bộ hẹn giờ tự động dùng cron `0 */2 * * *` (chạy định kỳ mỗi 2 tiếng 1 lần) để nhét Job vào Queue.
5. **`backend/src/app.js`**: File gốc tổng để khởi động Express, sau đó khởi chạy luôn Scheduler và Worker để mọi thứ chạy ngầm.

## Trạng Thái
✅ Giai đoạn này đã được code hoàn tất.
✅ Có thể khởi động bằng lệnh: `npm run dev` trong thư mục `backend`.
