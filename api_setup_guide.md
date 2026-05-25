# Hướng Dẫn Lấy API Keys & Access Tokens

Để hệ thống có thể tự động lấy ảnh và đăng bài, bạn cần cung cấp quyền truy cập bằng cách tạo các **API Keys** và **Access Tokens**. Hãy làm theo từng bước dưới đây.

---

## 1. Google Cloud (Lấy `credentials.json`)
Chúng ta sử dụng **Service Account** để Node.js có thể chạy ngầm mà không cần bạn phải đăng nhập mỗi ngày.

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/).
2. Đăng nhập bằng tài khoản Google của bạn và tạo một **Project mới** (Ví dụ: `Auto Publisher`).
3. Bật API:
   - Ở menu bên trái, chọn **APIs & Services** > **Library**.
   - Tìm kiếm và bấm **Enable** cho 2 API: `Google Drive API` và `Google Sheets API`.
4. Tạo Credentials (Chìa khóa):
   - Vào **APIs & Services** > **Credentials**.
   - Bấm nút **+ CREATE CREDENTIALS** ở trên cùng > Chọn **Service account**.
   - Đặt tên (VD: `bot-auto-post`) > Bấm *Create and Continue*.
   - Ở mục *Role*, chọn **Basic** > **Editor** > Bấm *Done*.
5. Tải file JSON:
   - Trong danh sách *Service Accounts* vừa hiện ra, bấm vào email của con bot bạn vừa tạo (có đuôi `@tên-project.iam.gserviceaccount.com`).
   - Sang tab **KEYS** > **ADD KEY** > **Create new key**.
   - Chọn định dạng **JSON** > Bấm Create. File sẽ tải về máy.
   - Đổi tên file đó thành `credentials.json` và copy vào thư mục `backend/src/config/` của dự án.
6. **BƯỚC QUAN TRỌNG NHẤT**: Copy địa chỉ email của Service Account. Sau đó vào Google Drive và Google Sheets của bạn, **Share (Chia sẻ)** quyền **Editor (Người chỉnh sửa)** cho email đó. Nếu không làm bước này, bot sẽ báo lỗi không tìm thấy file.

---

## 2. Meta (Facebook Fanpage & Instagram & Threads)
1. Truy cập [Meta for Developers](https://developers.facebook.com/).
2. Đăng nhập và bấm **Tạo ứng dụng (Create App)**.
   - Chọn loại ứng dụng: **Kinh doanh (Business)**.
3. Liên kết Fanpage & Instagram:
   - Trong Dashboard của App, cuộn xuống thêm các sản phẩm: **Facebook Login for Business** và **Instagram Graph API**.
4. Lấy Token:
   - Ở menu trên cùng, chọn **Tools** > **Graph API Explorer**.
   - Tại mục *Meta App*, chọn App bạn vừa tạo.
   - Tại mục *User or Page*, chọn Fanpage bạn muốn đăng bài.
   - Bấm nút **Add a Permission**, thêm các quyền sau: `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `threads_basic`, `threads_content_publish`.
   - Bấm **Generate Access Token**. (Sẽ có popup hiện lên yêu cầu bạn cấp quyền, hãy đồng ý).
5. Kéo dài hạn sử dụng Token (Long-lived Token):
   - Token vừa tạo chỉ sống được vài tiếng. Hãy copy Token đó.
   - Truy cập công cụ [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/).
   - Dán Token vào > Bấm **Debug**.
   - Cuộn xuống dưới cùng, bấm **Extend Access Token** để lấy Token sống được 60 ngày (hoặc vĩnh viễn với Page Token). Lưu mã này lại để dán vào cài đặt hệ thống.

---

## 3. TikTok (Content Posting API)
*Lưu ý: TikTok duyệt App khá gắt gao. Ban đầu bạn có thể dùng tài khoản thử nghiệm.*
1. Truy cập [TikTok for Developers](https://developers.tiktok.com/).
2. Đăng ký tài khoản Developer và chọn **Create an App**.
3. Khai báo thông tin ứng dụng (Website, mục đích đăng tải video tự động).
4. Trong phần *Products*, xin cấp quyền **Content Posting API** (để đăng video/ảnh).
5. Khi App được duyệt (hoặc trong môi trường Sandbox/Staging), bạn sẽ lấy được `Client Key` và `Client Secret`.
6. Hệ thống của chúng ta sẽ dùng 2 key này để tạo ra một đường link, bạn click vào link đó để đăng nhập kênh TikTok của bạn, sau đó hệ thống sẽ nhận được `Access Token` dùng để đăng bài.

> [!TIP]
> Bạn hãy làm **Bước 1 (Google Cloud)** trước, vì nó dễ nhất và là lõi dữ liệu của chúng ta. Khi bạn tải được file `credentials.json` về, chúng ta có thể viết code ngay lập tức cho module Google Drive. Các nền tảng MXH có thể làm sau.
