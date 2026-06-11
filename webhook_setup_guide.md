# Hướng Dẫn Thiết Lập Facebook/Instagram Webhook (Real-time)

## Tại sao cần Webhook?
Thay vì hệ thống phải liên tục "hỏi thăm" Facebook mỗi 30 giây, Webhook cho phép Facebook **tự động gửi tin nhắn mới vào hệ thống ngay lập tức** khi khách hàng nhắn tin. Kết quả: **0 giây delay**.

---

## ✅ Bước 1: Code Backend (ĐÃ HOÀN TẤT)
Hệ thống đã có 2 endpoint sẵn sàng:
- **`GET /webhook`** — Facebook gọi 1 lần để xác minh
- **`POST /webhook`** — Nhận tin nhắn real-time, lưu DB, đẩy SSE

Verify Token: `vuadongho_crm_2024` (có thể thay trong file `.env`)

---

## 🔧 Bước 2: Cài Cloudflare Named Tunnel (URL cố định vĩnh viễn, miễn phí)

### 2A. Tải và cài đặt cloudflared

1. Tải bản cài cho Windows tại: https://github.com/cloudflare/cloudflared/releases/latest
   → Tải file `cloudflared-windows-amd64.msi` → Cài đặt bình thường
2. Mở CMD/PowerShell mới, gõ kiểm tra:
   ```
   cloudflared --version
   ```
   Nếu hiện ra phiên bản (vd: `2024.x.x`) là thành công.

### 2B. Đăng nhập Cloudflare

Chạy lệnh này, trình duyệt sẽ tự mở:
```
cloudflared tunnel login
```
- Nếu **chưa có tài khoản** Cloudflare → Đăng ký miễn phí tại https://dash.cloudflare.com/sign-up
- Nếu **chưa có tên miền** trên Cloudflare → Bạn cần thêm 1 tên miền (có thể mua domain giá rẻ ~20-30k/năm tại Namecheap, rồi add vào Cloudflare)
- Sau khi đăng nhập → Chọn tên miền bạn muốn dùng → Bấm **Authorize**

### 2C. Tạo Named Tunnel

```bash
cloudflared tunnel create vuadongho-webhook
```
Lệnh này sẽ:
- Tạo 1 tunnel tên `vuadongho-webhook`
- Sinh ra 1 file credentials (JSON) trong thư mục `~/.cloudflared/`
- Hiện ra 1 **Tunnel ID** (dạng `abc123-def456-...`) → **Ghi nhớ ID này**

### 2D. Gắn tunnel vào tên miền (DNS)

```bash
cloudflared tunnel route dns vuadongho-webhook webhook.tenmien.com
```
→ Thay `tenmien.com` bằng tên miền thật của bạn trên Cloudflare.

Ví dụ nếu tên miền là `vuadongho.vn`:
```bash
cloudflared tunnel route dns vuadongho-webhook webhook.vuadongho.vn
```
→ URL webhook cố định vĩnh viễn sẽ là: `https://webhook.vuadongho.vn/webhook`

### 2E. Tạo file cấu hình

Tạo file `config.yml` trong thư mục `C:\Users\<TênUser>\.cloudflared\config.yml`:
```yaml
tunnel: <TUNNEL_ID>
credentials-file: C:\Users\<TênUser>\.cloudflared\<TUNNEL_ID>.json

ingress:
  - hostname: webhook.tenmien.com
    service: http://localhost:5173
  - service: http_status:404
```
→ Thay `<TUNNEL_ID>` bằng ID ở bước 2C, thay `tenmien.com` bằng domain thật.

### 2F. Chạy tunnel

```bash
cloudflared tunnel run vuadongho-webhook
```
Sau khi chạy, URL `https://webhook.tenmien.com` sẽ trỏ thẳng vào `localhost:5173` trên máy bạn.

> [!TIP]
> Bạn có thể tích hợp lệnh này vào `npm run dev` trong `package.json`:
> ```json
> "dev": "concurrently \"npm --prefix backend run dev\" \"npm --prefix frontend run dev\" \"cloudflared tunnel run vuadongho-webhook\""
> ```

---

## 🔧 Bước 3: Đăng ký Webhook trên Facebook Developer

### 3A. Cấu hình cho Facebook Messenger:
1. Vào https://developers.facebook.com/ → chọn App của bạn
2. Menu trái → **Messenger** → **Messenger Settings**
3. Kéo xuống phần **Webhooks** → Bấm **Add Callback URL**
4. Điền:
   - **Callback URL**: `https://webhook.tenmien.com/webhook`
   - **Verify Token**: `vuadongho_crm_2024`
5. Bấm **Verify and Save**
6. Sau khi xác minh thành công, ở phần **Webhook Fields**, tích chọn:
   - ✅ `messages` — nhận tin nhắn mới
   - ✅ `messaging_postbacks` — nhận nút bấm
   - ✅ `message_reads` — biết khi khách đọc tin
   - ✅ `message_deliveries` — biết khi tin đã gửi tới
7. Ở phần **Subscribe to Events for Page**, chọn đúng Fanpage của bạn

### 3B. Cấu hình cho Instagram (cùng 1 URL):
1. Trong App, menu trái → **Instagram** → **Webhooks**
2. Bấm **Add Callback URL** và điền **y hệt**:
   - **Callback URL**: `https://webhook.tenmien.com/webhook`
   - **Verify Token**: `vuadongho_crm_2024`
3. Tích chọn:
   - ✅ `messages` — nhận DM từ Instagram

> [!IMPORTANT]
> Cùng **1 URL** dùng cho cả Facebook Messenger và Instagram. Server tự phân biệt.

---

## 🎯 Kết quả sau khi hoàn tất

| Trước | Sau |
|---|---|
| Polling mỗi 30 giây | **Tức thì** (< 1 giây) |
| Chỉ lấy data khi sync | Facebook **tự động đẩy** data vào |
| Tốn bandwidth | Chỉ nhận khi có tin mới |
| Không biết khi nào khách đọc tin | Nhận thông báo **ngay khi khách đọc** |

> [!TIP]
> Sau khi cài xong, bạn có thể giảm tần suất auto-sync từ 30 giây xuống 5 phút (hoặc bỏ hẳn) vì Webhook đã lo phần real-time rồi. Auto-sync lúc này chỉ đóng vai trò "bảo hiểm" phòng khi Webhook bị lỡ sự kiện.

