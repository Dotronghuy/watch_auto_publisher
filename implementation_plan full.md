# BẢN ĐỒ LỘ TRÌNH (ROADMAP): WATCH AUTO PUBLISHER Lên Đỉnh Cao

Dự án này không chỉ đơn thuần là một tool đăng bài, mà tôi sẽ thiết kế nó trở thành một **Hệ sinh thái Marketing tự động hoàn toàn**, hoạt động không khác gì một đội ngũ Media, Content và Ads chuyên nghiệp.

Dưới đây là toàn bộ các Giai đoạn (Phases) đã đi qua và những Giai đoạn nâng cấp cực khủng sắp tới:

---

## ✅ Giai đoạn 1: Đổ Móng & Liên Kết Nền Tảng (Đã hoàn thành)
- **Cốt lõi:** Sử dụng thư viện Python tải file gốc về máy chủ cục bộ để tránh 100% lỗi API Drive không trả về ảnh do file quá nặng hoặc yêu cầu quét virus.
- **Bộ não AI:** Tích hợp n8n Webhook làm cầu nối để gọi Gemini (hoặc ChatGPT) tự động viết content.
- **Thành quả:** Đã có thể tải thẳng file vật lý từ Drive và đăng thành công lên Facebook.

---

## ✅ Giai đoạn 2: Tự Động Hóa & Trí Nhớ (Đã hoàn thành)
- **Hàng đợi ngầm (BullMQ + Redis):** Bảo vệ hệ thống không bị crash, tự động gửi lại nếu đứt mạng.
- **Bộ máy thời gian:** Cấu hình tự động chạy theo chu kỳ (vd: mỗi 2 tiếng, hoặc 1 phút để test).
- **Trí nhớ:** Lưu lịch sử bài đăng vào thẳng Database (PostgreSQL/SQLite) để giải quyết triệt để lỗi đụng độ (file corruption) khi hệ thống chạy đa luồng, loại bỏ hoàn toàn việc đăng trùng lặp.

---

## 🚀 Giai đoạn 3: Logic Nội Dung "Quái Vật" (Chuẩn bị làm)
*Dựa trên ý tưởng xuất sắc của bạn, tôi sẽ nâng cấp hệ thống xử lý nội dung lên tầm cao mới:*

- **Chỉnh sửa phông nền AI (Image Inpainting):** Tuyệt đối KHÔNG để AI tự vẽ lại đồng hồ để tránh sai chi tiết kỹ thuật. Hệ thống sẽ giữ nguyên 100% chủ thể đồng hồ từ ảnh `0_Anh_AVT` và chỉ dùng AI (API chỉnh sửa ảnh) để thay thế phông nền (Background generation) phía sau thành bối cảnh sang trọng, lịch lãm.
- **Đăng Siêu Album (Multi-photo):** Nếu bốc trúng ảnh Hãng/Tự chụp, hệ thống sẽ gom **4 tấm ảnh đẹp nhất** tạo thành một Album dạng Grid (Lưới 1 to 3 nhỏ) cực kỳ bắt mắt trên Facebook, giúp tăng tỷ lệ click và chốt đơn.
- **Văn phong linh hoạt:** Tùy thuộc vào loại ảnh mà prompt đưa cho AI sẽ khác nhau.

---

## 🚀 Giai đoạn 4: Thống Trị Đa Kênh (Omnichannel)
*Tại sao chỉ đăng Facebook trong khi bạn có thể phủ sóng khắp nơi?*

- **Instagram (Tự động):** Tự động resize ảnh vuông hoặc 4:5, tự động gắn đống Hashtag "mồi" do AI nghĩ ra.
- **Threads:** Phân tách Content thành các chuỗi hội thoại ngắn gọn, tạo trend thảo luận.
- **TikTok (Biến Ảnh thành Video):** *Nâng cấp thêm!* Hệ thống sẽ dùng API của các dịch vụ dựng video để ghép ảnh thành 1 đoạn video ngắn có nhạc nền mặn mòi rồi đẩy thẳng lên TikTok.

---

## 🚀 Giai đoạn 5: Giao Diện Quản Trị Trung Tâm (Frontend React)
*Từ bỏ màn hình đen Terminal rườm rà, chúng ta sẽ có 1 trang Web xịn xò quản lý:*

- **Drive Manager:** Kéo thả link Google Drive mới vào giao diện web là hệ thống tự nhận diện.
- **Tính năng nhập liệu hàng loạt:** Tải file Excel mẫu, điền toàn bộ thông số các model mới và import hàng loạt lên Database cùng một lúc thay vì gõ tay từng mã SKU.
- **Tính năng dọn dẹp kho:** Nút xóa các biến thể và model không còn sử dụng/bị lỗi data. Hệ thống tự động dọn sạch rác trong Database và xóa thư mục ảnh trên Drive tương ứng để tiết kiệm tài nguyên.
- **Trạm Kiểm Duyệt (Approval Workflow):** Chuyển từ "Auto 100%" sang "Chờ duyệt". AI sẽ soạn sẵn Content chờ trên Web, bạn bấm "Duyệt" thì mới đăng.
- **Lịch Trình Trực Quan:** Một cuốn Lịch hiển thị các bài viết sắp lên sóng trong tháng.

---

## 🌟 Giai đoạn 6: Tự Học & Nuôi Dưỡng (Nâng cấp tối thượng)
*Biến Tool thành một Marketer thực thụ:*

- **Tracking tương tác:** Hệ thống tự động đếm số Like/Comment của từng bài đã đăng.
- **Tự Học (Machine Learning Feedback):** Báo lại cho n8n/ChatGPT biết bài nào nhiều Like nhất để các bài sau nó viết bắt trend và ra đơn tốt hơn.
- **Auto-Reply Comment:** Có khách comment "Xin giá", hệ thống chộp luôn ID của post, nhờ AI viết câu trả lời thả thính rồi tự động reply lại khách.
