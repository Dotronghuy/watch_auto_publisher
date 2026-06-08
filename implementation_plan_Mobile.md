# 📱 Plan: Đăng Bài Tự Động Qua Điện Thoại (ADB + Appium)

## Bối cảnh

Hệ thống hiện tại dùng **Playwright trên PC** để đăng bài FB/IG qua web. Tuy nhiên:
- Web không hỗ trợ chọn nhạc cho bài đăng ảnh
- TikTok cũng yêu cầu nhạc để bài viết không bị "khô"
- Tính năng chọn nhạc **chỉ có trên app điện thoại**

→ Cần bổ sung kênh đăng bài qua **điện thoại thật** để có nhạc.

---

## Kiến Trúc Tổng Quan

```
┌──────────────────────────────────────────────────────────┐
│                    PC (Hệ thống hiện tại)                │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Google Drive │  │   ChatGPT    │  │   Telegram     │  │
│  │ (ảnh/video)  │  │ (content/ảnh)│  │  (review)      │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │
│         │                │                   │           │
│         ▼                ▼                   ▼           │
│  ┌─────────────────────────────────────────────────┐     │
│  │           publish.service.js (Node.js)          │     │
│  │  - Chọn SKU, tạo ảnh AI, viết content          │     │
│  │  - Quyết định: đăng qua WEB hay qua PHONE      │     │
│  └──────────┬──────────────────┬───────────────────┘     │
│             │                  │                         │
│     ┌───────▼──────┐   ┌──────▼──────────┐               │
│     │  Playwright  │   │  Appium Client  │               │
│     │  (đăng web)  │   │  (điều khiển    │               │
│     │  FB/IG post  │   │   điện thoại)   │               │
│     │  Không nhạc  │   │                 │               │
│     └──────────────┘   └──────┬──────────┘               │
│                               │ USB / ADB                │
└───────────────────────────────┼──────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   📱 Điện Thoại Thật  │
                    │                       │
                    │  - Facebook App       │
                    │  - Instagram App      │
                    │  - TikTok App         │
                    │                       │
                    │  ✅ Có nhạc           │
                    │  ✅ Không bị detect   │
                    │  ✅ Đầy đủ tính năng  │
                    └───────────────────────┘
```

---

## 2 Hướng Đi

### Hướng A: Song Song (Khuyến nghị)

```
Giữ nguyên hệ thống Playwright hiện tại + thêm kênh điện thoại

Khi nào dùng Playwright (web):
  - ChatGPT tạo ảnh AI (Image_Watch_AI)
  - ChatGPT viết content (Content_Watch_AI)
  - Các tác vụ không cần nhạc

Khi nào dùng Appium (phone):
  - Đăng ảnh lên IG/FB (có nhạc)
  - Đăng video lên TikTok (có nhạc)
  - Đăng Reels (có nhạc)
```

> **Ưu điểm:** Không phá vỡ hệ thống hiện tại, thêm khả năng mới
> **Nhược điểm:** Cần duy trì 2 hệ thống automation (web + mobile)

---

### Hướng B: Toàn Bộ Qua Điện Thoại

```
Chuyển hoàn toàn việc ĐĂNG BÀI sang điện thoại.
PC chỉ làm: tạo ảnh, viết content, review qua Telegram.
Điện thoại làm: đăng tất cả FB/IG/TikTok.
```

> **Ưu điểm:** Thống nhất, có nhạc cho tất cả bài
> **Nhược điểm:** Phụ thuộc vào 1 điện thoại, nếu hỏng/hết pin → dừng hệ thống

---

## Giải Pháp Kỹ Thuật Chi Tiết

### Phase 1: Setup Hạ Tầng (Ngày 1-2)

#### 1.1 Điện thoại

```
Yêu cầu:
  - Android 10+ (không cần flagship, mid-range là đủ)
  - RAM 4GB+
  - Bật Developer Mode + USB Debugging
  - Cắm nguồn 24/7 (sạc liên tục)
  - Kết nối WiFi ổn định + cáp USB vào PC

Cài sẵn:
  - Facebook App (đã đăng nhập fanpage)
  - Instagram App (đã đăng nhập)
  - TikTok App (đã đăng nhập)
```

#### 1.2 PC (cài thêm)

```
1. ADB (Android Debug Bridge)
   → choco install adb
   → Dùng để: push file ảnh/video vào điện thoại

2. Appium Server (v2.x)
   → npm install -g appium
   → appium driver install uiautomator2
   → Dùng để: điều khiển app trên điện thoại

3. Appium Inspector (optional)
   → Dùng để: xem UI elements, tìm selector cho các nút bấm
```

#### 1.3 Kiểm tra kết nối

```bash
# Kiểm tra điện thoại đã kết nối
adb devices

# Push file test vào điện thoại
adb push test.jpg /sdcard/DCIM/

# Chạy Appium server
appium --port 4723
```

---

### Phase 2: Appium Service (Ngày 3-5)

#### 2.1 File mới: `appium.service.js`

```javascript
// Kiến trúc dự kiến
import { remote } from 'webdriverio';

// Kết nối điện thoại
const connectPhone = async () => {
  const driver = await remote({
    hostname: 'localhost',
    port: 4723,
    capabilities: {
      platformName: 'Android',
      automationName: 'UiAutomator2',
      noReset: true,  // Giữ session đăng nhập
    }
  });
  return driver;
};

// Push ảnh vào điện thoại qua ADB
const pushFileToPhone = async (localPath) => {
  const phonePath = `/sdcard/DCIM/auto_post/${filename}`;
  exec(`adb push "${localPath}" "${phonePath}"`);
  // Refresh media scanner để app thấy ảnh mới
  exec(`adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${phonePath}`);
  return phonePath;
};

// Đăng ảnh lên Instagram có nhạc
const postToInstagramWithMusic = async (imagePath, caption, musicKeyword) => {
  const driver = await connectPhone();
  const phonePath = await pushFileToPhone(imagePath);

  // Mở Instagram
  await driver.activateApp('com.instagram.android');

  // Tạo bài mới → chọn ảnh → chọn nhạc → paste caption → đăng
  // ... (chi tiết ở Phase 3)
};
```

---

### Phase 3: Automation Cho Từng App (Ngày 5-10)

#### 3.1 Instagram — Flow Đăng Ảnh Có Nhạc

```
Bước 1: Mở app → Tap nút "+" (tạo bài mới)
Bước 2: Chọn ảnh từ gallery (ảnh vừa push qua ADB)
Bước 3: Tap "Next" → màn hình filter
Bước 4: Tap "Next" → màn hình caption
Bước 5: Tap "Add music" → tìm kiếm nhạc → chọn bài
Bước 6: Paste caption (dùng ADB input hoặc clipboard)
Bước 7: Tap "Share" → đăng bài

Thời gian ước tính: ~30-45 giây/bài
```

#### 3.2 Facebook — Flow Đăng Ảnh Có Nhạc

```
Bước 1: Mở app → Chuyển sang Fanpage
Bước 2: Tap "Create post"
Bước 3: Tap "Photo" → chọn ảnh
Bước 4: Tap "Music" → tìm kiếm → chọn bài
Bước 5: Paste caption
Bước 6: Tap "Post"

Thời gian ước tính: ~30-45 giây/bài
```

#### 3.3 TikTok — Flow Đăng Video/Ảnh

```
Bước 1: Mở app → Tap "+" (tạo mới)
Bước 2: Chọn video/ảnh từ gallery
Bước 3: Tap "Add sound" → tìm kiếm → chọn nhạc trending
Bước 4: Paste caption + hashtag
Bước 5: Tap "Post"

Thời gian ước tính: ~30-45 giây/bài
```

---

### Phase 4: Tích Hợp Vào Hệ Thống (Ngày 10-12)

```
publish.service.js (hiện tại)
  │
  ├── Tạo ảnh AI (ChatGPT - Playwright) ← giữ nguyên
  ├── Viết content (ChatGPT - Playwright) ← giữ nguyên
  ├── Review qua Telegram              ← giữ nguyên
  │
  └── Đăng bài:
      ├── [MỚI] postViaPhone(platform, imagePath, caption, musicKeyword)
      │     ├── Instagram → postToInstagramWithMusic()
      │     ├── Facebook  → postToFacebookWithMusic()
      │     └── TikTok    → postToTikTokWithMusic()
      │
      └── [CŨ - backup] postViaWeb() ← giữ làm fallback
```

---

## Rủi Ro & Cách Xử Lý

### Rủi ro 1: Điện thoại hết pin / mất kết nối USB

```
Xác suất: TRUNG BÌNH
Hậu quả:  Không đăng được bài
Giải pháp:
  ✅ Cắm sạc 24/7 (dùng timer ổ cắm để ngắt sạc khi đầy, tránh chai pin)
  ✅ Kiểm tra kết nối ADB trước khi đăng
  ✅ Fallback: nếu phone không khả dụng → đăng qua web (không nhạc)
  ✅ Gửi cảnh báo Telegram khi mất kết nối
```

### Rủi ro 2: App IG/FB/TikTok tự cập nhật → UI thay đổi

```
Xác suất: THẤP (vài tháng 1 lần)
Hậu quả:  Automation không tìm được nút bấm
Giải pháp:
  ✅ Tắt auto-update app trên điện thoại
  ✅ Dùng resource-id selector (ổn định hơn xpath)
  ✅ Thêm fallback selector cho mỗi nút (2-3 cách tìm)
  ✅ Log + screenshot khi lỗi → dễ debug
  ✅ Fallback: đăng qua web nếu phone lỗi
```

### Rủi ro 3: App hiện popup/dialog bất ngờ

```
Xác suất: CAO (thường xuyên)
Hậu quả:  Flow bị kẹt ở popup
Giải pháp:
  ✅ Trước mỗi bước, check và dismiss popup phổ biến:
     - "Rate this app" → Dismiss
     - "Update available" → Later
     - "Turn on notifications" → Not now
     - "Login again" → Re-login
  ✅ Timeout + retry: nếu kẹt quá 30s → force close app → thử lại
```

### Rủi ro 4: Bài đăng bị Facebook/IG/TikTok ẩn (spam detection)

```
Xác suất: THẤP (nếu đăng hợp lý)
Hậu quả:  Bài không hiển thị
Giải pháp:
  ✅ Giới hạn tần suất: tối đa 3-4 bài/ngày/platform
  ✅ Đăng cách nhau ít nhất 2-3 tiếng
  ✅ Content đa dạng (đã có hệ thống xoay vòng 7 góc × 7 tone)
  ✅ Không đăng cùng ảnh lên nhiều platform cùng lúc
```

### Rủi ro 5: Nhạc bị vi phạm bản quyền

```
Xác suất: THẤP (nếu dùng nhạc IG/TikTok cung cấp)
Hậu quả:  Bài bị gỡ hoặc tắt tiếng
Giải pháp:
  ✅ CHỈ chọn nhạc từ thư viện của IG/FB/TikTok (đã được license)
  ✅ Tìm kiếm bằng keyword an toàn: "lofi", "jazz", "ambient", "luxury"
  ✅ Tạo danh sách nhạc yêu thích trên mỗi app → chọn ngẫu nhiên từ đó
```

### Rủi ro 6: Chọn nhạc không phù hợp với thương hiệu luxury

```
Xác suất: TRUNG BÌNH
Hậu quả:  Giảm chất lượng brand
Giải pháp:
  ✅ Tạo playlist keyword phù hợp: ["jazz", "lofi", "piano", "ambient", "chill"]
  ✅ TRÁNH: nhạc quá sôi động, nhạc có lời hát, nhạc trend nhảm
  ✅ Lưu danh sách bài nhạc đã dùng → không lặp lại liên tục
```

---

## Timeline Tổng Thể

```
Phase 1 (Ngày 1-2):   Setup hạ tầng — ADB, Appium, kết nối điện thoại
Phase 2 (Ngày 3-5):   Code appium.service.js — kết nối, push file, base functions
Phase 3 (Ngày 5-10):  Code automation cho IG → FB → TikTok
Phase 4 (Ngày 10-12): Tích hợp vào publish.service.js + fallback
Phase 5 (Ngày 12-14): Test end-to-end, fix bug, xử lý edge cases
```

**Tổng: ~2 tuần** (có thể nhanh hơn nếu UI các app ít popup)

---

## Checklist Trước Khi Bắt Đầu

```
[ ] Có điện thoại Android dành riêng (Android 10+, 4GB RAM+)
[ ] Có cáp USB kết nối ổn định
[ ] Đã đăng nhập FB/IG/TikTok trên điện thoại
[ ] Đã bật Developer Mode + USB Debugging
[ ] Đã tắt auto-update app trên điện thoại
[ ] Máy PC có đủ USB port trống
[ ] WiFi ổn định cho cả PC và điện thoại
```
