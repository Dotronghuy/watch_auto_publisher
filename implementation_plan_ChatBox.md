# AI Chatbot 24/7 — Kế hoạch tổng thể (CẬP NHẬT)

---

## PHẦN A: HỆ THỐNG AUTO-REPLY

### Cách hoạt động chung

**Khách nhắn tin mới** → Đoạn chat đang ở chế độ nào?

- **🤖 Chế độ Bot** → Bot đọc tin nhắn + kiến thức → Bot soạn & gửi trả lời tự động
- **👤 Chế độ Nhân viên** → Không làm gì, chờ nhân viên xử lý

**Chuyển chế độ:**
- Nhân viên reply thủ công → Chuyển sang chế độ **"Nhân viên"** → Bot DỪNG
- Nhân viên im 2 giờ → Tự chuyển lại chế độ **"Bot"**

### Cơ chế Human Takeover

| Tình huống | Xử lý |
|---|---|
| Khách nhắn → chưa ai reply | ✅ Bot tự trả lời |
| Nhân viên reply 1 tin | ⏸️ Bot **DỪNG** cho đoạn chat đó |
| Nhân viên tiếp tục chat | ⏸️ Bot vẫn dừng |
| Nhân viên im **2 giờ** | 🔄 Bot kích hoạt lại |
| Nhân viên bấm "Giao lại cho Bot" | 🔄 Bot kích hoạt lại ngay |

### Bot trả lời text

| Khách hỏi | Bot xử lý |
|---|---|
| *"Chào shop"* | Chào + hỏi nhu cầu |
| *"C8053G-T1 giá bao nhiêu?"* | Tra mã trong Sheets → trả giá |
| *"Cadisen mặt xanh có mẫu nào?"* | Tìm text trong Sheets → liệt kê |
| *"Muốn mua đồng hồ nam 3-5 triệu"* | Gợi ý vài mẫu phù hợp |
| *"Ship bao lâu? Bảo hành thế nào?"* | Trả lời từ chatbot-knowledge.md |
| *"Muốn nói chuyện với nhân viên"* | Chuyển sang chế độ Nhân viên |
| Khách gửi ảnh | → Chuyển qua 3 LỚP NHẬN DIỆN |

### Delay trả lời
Bot đợi **3-8 giây** rồi mới gửi (ngẫu nhiên) — cho tự nhiên.

---

## PHẦN B: NHẬN DIỆN ẢNH — 3 LỚP

**Khách gửi ảnh** →

1. **LỚP 1: So hash ảnh bài viết**
   - ✅ Khớp → Ra đúng SKU → Trả giá ngay
   - ❌ Không khớp → Chuyển xuống Lớp 2

2. **LỚP 2: So hash ảnh gốc từ Sheets**
   - ✅ Khớp → Ra đúng SKU → Trả giá ngay
   - ❌ Không khớp → Chuyển xuống Lớp 3

3. **LỚP 3: Gemini Vision mô tả chi tiết**
   - Tìm được 2-3 mẫu → Gửi danh sách cho khách chọn
   - Không tìm được → Bot hỏi tự nhiên: brand / giá / giới tính

---

### 🔵 LỚP 1: So hash ảnh bài viết (CHÍNH XÁC 100%)

**Khi nào:** Khách gửi ảnh lấy từ bài Facebook/IG mà tool đã đăng.

**Cách hoạt động:**
1. Mỗi khi tool đăng bài → tính perceptual hash của ảnh → lưu DB kèm SKU
2. Khách gửi ảnh → tính hash → so DB → khớp → ra SKU

**Kết quả:**
> *"Đây là mẫu Cadisen C8053G-T1 màu Xanh Navy, giá 4.430.000đ ạ! Anh/chị muốn đặt hàng không ạ? 😊"*

| | |
|---|---|
| Chính xác | 100% |
| Token AI | 0 |
| Tốc độ | Vài mili-giây |
| Tài nguyên | ~16 byte/ảnh. 1000 ảnh = 16KB |

---

### 🟡 LỚP 2: So hash ảnh gốc từ Google Sheets

**Khi nào:** Lớp 1 không khớp. Khách gửi ảnh từ web, Shopee, Google, shop khác...

**Cách hoạt động:**
1. **Chạy 1 lần khi khởi động:** Tải tất cả ảnh sản phẩm từ cột E trong Sheets → tính hash → lưu DB
2. Cập nhật tự động khi có sản phẩm mới (sync định kỳ)
3. Khách gửi ảnh → tính hash → so với toàn bộ hash ảnh gốc → khớp → ra SKU

**Kết quả nếu khớp:**
> *"Đây là mẫu Cadisen C8053G-T1 màu Xanh Navy, giá 4.430.000đ ạ! Anh/chị muốn đặt hàng không ạ? 😊"*

| | |
|---|---|
| Chính xác | Rất cao (ảnh gốc giống nhau) |
| Token AI | 0 |
| Tốc độ | Vài mili-giây |
| Tài nguyên lưu trữ | ~16KB cho 1000 sản phẩm |
| Tải ảnh lần đầu | Cần thời gian tải 1000+ ảnh (chạy nền 1 lần) |

> [!NOTE]
> Ảnh chỉ tải 1 lần rồi cache hash. Sau đó sản phẩm mới sẽ sync tự động.

---

### 🔴 LỚP 3: Gemini Vision — Mô tả chi tiết

**Khi nào:** Lớp 1 & 2 đều không khớp. Khách tự chụp đồng hồ trên tay, ảnh góc lạ...

**Cách hoạt động:**
1. Gửi ảnh cho Gemini Vision, yêu cầu mô tả chi tiết:
   - Thương hiệu (đọc chữ trên mặt)
   - Màu mặt số
   - Loại dây (thép/da/silicone)
   - Hình dáng vỏ (tròn/vuông/tonneau)
   - Phong cách (classic/sport/dress)
2. Dùng kết quả → filter Sheets nhiều điều kiện → thu hẹp từ 1000 → 2-3 mẫu
3. Gửi danh sách ngắn cho khách chọn

**Kết quả:**
> *"Shop thấy mẫu anh/chị gửi giống mấy sản phẩm này ạ:*
> *1️⃣ Cadisen C8053G-T1 — Xanh Navy — 4.430.000đ*
> *2️⃣ Cadisen C8185G-T1 — Xanh Navy — 4.890.000đ*
> *Anh/chị xem đúng mẫu nào shop báo giá chi tiết nhé! 😊"*

**Nếu Gemini cũng không nhận diện được** (ảnh quá mờ):
> *"Mẫu này đẹp quá ạ! 😍 Anh/chị cho shop biết thêm nhé:*
> *- Thương hiệu là gì ạ? (nếu biết)*
> *- Anh/chị thích tầm giá bao nhiêu?*
> *- Mua cho nam hay nữ ạ?*
> *Shop sẽ tìm mẫu giống nhất cho anh/chị! 🙏"*

| | |
|---|---|
| Chính xác | Tốt (thu hẹp xuống 2-3 mẫu) |
| Token AI | 1 lần gọi Gemini Vision/ảnh |
| Tốc độ | 2-5 giây |
| Chi phí | Gần 0đ (Gemini Free tier) |

---

## PHẦN C: BẠN CẦN CUNG CẤP

| Mục | Trạng thái |
|---|---|
| 🔑 Gemini API Key | ✅ Đã có |
| 📚 chatbot-knowledge.md (thông tin shop) | ✅ Đã điền cơ bản |
| 📚 chatbot-knowledge.md (FAQ + quy tắc) | ⬜ Cần bổ sung |
| 📊 Google Sheets sản phẩm | ✅ Đã có (1000+ SP) |

---

## PHẦN D: GIAO DIỆN (UI)

### Inbox CRM
- Badge **🤖 Bot** / **👤 Nhân viên** trên mỗi đoạn chat
- Nút **"Giao lại cho Bot"** khi đang ở chế độ Nhân viên
- Indicator "Bot đang soạn..." khi bot chuẩn bị trả lời

### Trang Cài đặt
| Cấu hình | Mặc định |
|---|---|
| Bật/Tắt Bot | Tắt |
| Thời gian tạm dừng | 2 giờ |
| Delay trả lời | 3-8 giây |
| Bật/Tắt Lớp 2 (hash ảnh Sheets) | Bật |
| Bật/Tắt Lớp 3 (Gemini Vision) | Bật |

---

## PHẦN E: THAY ĐỔI CODE

### Backend

| File | Loại | Mô tả |
|---|---|---|
| `services/chatbot.service.js` | MỚI | Logic chính: auto-reply, gọi Gemini, human takeover |
| `services/image-hash.service.js` | MỚI | Lớp 1+2: tính hash, so sánh, sync hash từ Sheets |
| `services/publish.service.js` | SỬA | Lưu hash ảnh khi đăng bài (Lớp 1) |
| `routes/api.routes.js` | SỬA | API: toggle bot, resume, ai-status, ai-settings |
| `.env` | SỬA | ✅ Đã thêm GEMINI_API_KEY |
| SQLite DB | SỬA | Thêm bảng image_hashes + cột bot_paused |

### Frontend

| File | Loại | Mô tả |
|---|---|---|
| `pages/InboxCRM.jsx` | SỬA | Badge bot/nhân viên, nút "Giao lại cho Bot" |
| Trang Cài đặt | SỬA | Section AI Chatbot settings |

---

## CÂU HỎI CHO BẠN

> 1. **Bot có nên nói giá** từ Sheets không? Hay chỉ nói "inbox để biết giá ưu đãi"?
> 2. **Bot có trả lời bình luận** (comment) không? Hay chỉ tin nhắn inbox?
> 3. Thời gian tạm dừng **2 giờ** OK không?
> 4. Còn điều chỉnh gì nữa không?
