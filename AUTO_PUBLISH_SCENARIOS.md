# Các trường hợp đăng bài tự động

Tài liệu này mô tả kết quả mà hệ thống phải ghi nhận sau mỗi lần chạy Auto Publish.

## 1. Trường hợp thành công

| Mã | Trường hợp | Kết quả mong đợi |
|---|---|---|
| S01 | Thumbnail của toàn bộ ảnh đính kèm xuất hiện và tin nhắn `user` mới xuất hiện trong ChatGPT | Tool mới bắt đầu bộ đếm chờ ảnh AI. |
| S02 | ChatGPT tạo đủ số ảnh yêu cầu | Tool kiểm tra ảnh đầu ra rồi tiếp tục chuẩn bị nội dung và đăng bài. |
| S03 | ChatGPT chỉ tạo được một phần ảnh nhưng có ít nhất một ảnh hợp lệ | Tool sử dụng các ảnh hợp lệ đã tạo được và tiếp tục đăng. |
| S04 | SKU đầu tiên lỗi AI nhưng SKU kế tiếp tạo ảnh thành công | SKU lỗi bị loại khỏi lượt hiện tại; tool chuyển sang SKU hợp lệ kế tiếp mà không dừng toàn bộ job. |
| S05 | Facebook thành công, Instagram lỗi hoặc bị bỏ qua | Job vẫn được tính là thành công vì đã có ít nhất một nền tảng đăng thành công. |
| S06 | Instagram Reels thành công, Facebook Reels lỗi | Job vẫn được tính là thành công. |
| S07 | Một tài khoản/Page lỗi nhưng tài khoản/Page khác đăng thành công | Toàn job thành công; các lỗi riêng lẻ vẫn được ghi log. |
| S08 | Nền tảng đã đăng thành công nhưng lưu metric, lịch sử Sheet hoặc ID media bị lỗi | Không retry đăng bài để tránh tạo bài trùng; ghi cảnh báo cho bước phụ bị lỗi. |
| S09 | Job lỗi tạm thời ở lần đầu hoặc lần hai, sau đó thành công | BullMQ tự chạy lại, tối đa 3 attempts với exponential backoff bắt đầu từ 60 giây. |
| S10 | Job hết 3 attempts nhưng job bù thành công | Một job bù được tạo sau 5 phút; khi đăng thành công thì cập nhật `last_run`. |
| S11 | Máy tắt trong một khung giờ và scheduler phát hiện khung giờ bị lỡ | Scheduler tạo job chạy bù có `jobId` cố định theo timestamp để chống xếp trùng. |
| S12 | Chạy bằng nút “Chạy Auto Ngay” và có nền tảng đăng thành công | Luồng thủ công cũng cập nhật `last_run`. |
| S13 | `remove.bg` lỗi nhưng ảnh gốc vẫn sử dụng được | Tool ghi cảnh báo và tiếp tục nhánh tạo ảnh AI bằng ảnh gốc. |
| S14 | ChatGPT viết nội dung lỗi nhưng ảnh và thông tin SKU hợp lệ | Tool dùng nội dung dự phòng rồi tiếp tục đăng. |

## 2. Trường hợp lỗi có thể tự phục hồi

| Mã | Lỗi | Cách hệ thống xử lý |
|---|---|---|
| R01 | Không thấy đủ thumbnail ảnh đính kèm trong 30 giây | Đánh dấu lỗi AI của SKU hiện tại và thử SKU hợp lệ kế tiếp. |
| R02 | Đã nhấn gửi nhưng không thấy tin nhắn `user` mới trong 20 giây | Không bắt đầu chờ ảnh; chuyển sang SKU hợp lệ kế tiếp. |
| R03 | ChatGPT trả về 0 ảnh, timeout, từ chối nội dung hoặc kẹt tạo ảnh | Nếu chưa có ảnh hợp lệ thì SKU hiện tại bị loại; tool thử SKU kế tiếp. |
| R04 | Ảnh AI bị phát hiện trùng ảnh sản phẩm hoặc ảnh tham chiếu | Chặn ảnh để tránh đăng sai; coi là lỗi AI của SKU và thử SKU kế tiếp. |
| R05 | Toàn bộ nền tảng đều lỗi trong một attempt | Không cập nhật Sheet, media history hoặc `last_run`; worker ném lỗi để BullMQ retry. |
| R06 | Lỗi mạng, API nền tảng hoặc lỗi tạm thời khác làm job thất bại | BullMQ retry tối đa 3 attempts theo exponential backoff. |
| R07 | Job hết số attempts | Tạo tối đa một job bù sau 5 phút. Job bù có attempts/backoff riêng. |
| R08 | Redis lỗi khi đọc `last_run` | Scheduler fallback sang file local `config/last_run.state`. |
| R09 | Redis lỗi khi ghi `last_run` nhưng file local ghi được | Lần đăng vẫn được tính thành công; log cảnh báo Redis. |

## 3. Trường hợp lỗi cuối cùng

| Mã | Lỗi | Trạng thái cuối |
|---|---|---|
| F01 | Tất cả SKU hợp lệ trong lượt đều lỗi AI | Routine ném lỗi; job chuyển sang cơ chế attempts/backoff. |
| F02 | Không còn SKU hết cooldown | Job thất bại vì không có mã đủ điều kiện. |
| F03 | Tất cả SKU hợp lệ đều hết ảnh/video mới chưa đăng | Job thất bại vì không có media mới. |
| F04 | Không có token Facebook hợp lệ cho mọi tài khoản và không nền tảng nào đăng được | Job thất bại; không cập nhật lịch sử hoặc `last_run`. |
| F05 | Facebook và Instagram đều thất bại trong toàn bộ attempts và job bù | Job bù thất bại cuối cùng; không tạo thêm job bù thứ hai để tránh lặp vô hạn. |
| F06 | Redis không chạy | Queue, scheduler và worker Auto Publish không thể hoạt động; phần web còn lại có thể tiếp tục chạy. |
| F07 | Người dùng bấm Dừng | Luồng dừng ngay và không tạo job bù, vì đây là lệnh chủ động chứ không phải lỗi cần retry. |
| F08 | Cả Redis và file local đều không ghi được `last_run` sau khi bài đã đăng | Bài vẫn được coi là đã đăng để tránh đăng trùng; hệ thống ghi lỗi lưu trạng thái và cần xử lý thủ công. |

## 4. Quy tắc cập nhật trạng thái

- Chỉ đặt `publishSucceeded = true` khi API nền tảng xác nhận đăng thành công.
- Chỉ cập nhật `last_run` khi `publishedPlatforms` có ít nhất một phần tử.
- Chỉ lưu media đã đăng sau khi có ít nhất một nền tảng thành công.
- Lỗi AI chỉ loại SKU hiện tại; lỗi đăng nền tảng làm job retry.
- Lệnh Dừng không được retry và không tạo job bù.
- Mỗi job thất bại cuối cùng chỉ được tạo tối đa một job bù.
