# Nâng cấp hệ thống Banner: Hỗ trợ 1, 2, 3 đồng hồ

## Mô tả

Hiện tại banner luôn yêu cầu 3 ảnh (T1, T2, T3). Nâng cấp để:
- Cột F trong file Excel SAPO đánh dấu vị trí banner: `1` = Giữa, `2` = Trái, `3` = Phải
- Tùy số lượng ảnh có đánh dấu mà tạo layout phù hợp

## Quy tắc Layout

| Số ảnh AVT | Layout | Mô tả |
|---|---|---|
| **Chỉ có 1** (center) | 1 đồng hồ lớn chính giữa | Đồng hồ to, căn giữa hoàn toàn |
| **Có 1 + 2** (center + left) | 2 đồng hồ cân đối | 2 đồng hồ chồng nhau, căn giữa canvas |
| **Có 1 + 2 + 3** (đủ) | 3 đồng hồ (như hiện tại) | Trái → Phải → Giữa (giữa phía trước) |

## Proposed Changes

---

### Schema (Prisma)

#### [MODIFY] [schema.prisma](file:///c:/Users/Admin/Downloads/watch-auto-publisher/backend/prisma/schema.prisma)

Thêm field `bannerPosition` vào model `Variant`:

```diff
 model Variant {
   ...
   status           String    @default("DRAFT")
+  bannerPosition   Int?      // 1=Giữa(AVT chính), 2=Trái, 3=Phải. null=không dùng cho banner
   
   model            WatchModel @relation(...)
 }
```

Sau đó chạy `npx prisma db push` để migrate.

---

### Import SAPO Excel

#### [MODIFY] [shopee.routes.js](file:///c:/Users/Admin/Downloads/watch-auto-publisher/backend/src/routes/shopee.routes.js)

Route `/import-sapo-excel` — đọc cột F (row[5]) làm `bannerPosition`:
- Nếu cột F = `1` → `bannerPosition = 1` (Giữa)
- Nếu cột F = `2` → `bannerPosition = 2` (Trái)  
- Nếu cột F = `3` → `bannerPosition = 3` (Phải)
- Nếu cột F trống → `bannerPosition = null`

Lưu vào cả `update` và `create` của upsert.

---

### Banner Controller

#### [MODIFY] [banner.controller.js](file:///c:/Users/Admin/Downloads/watch-auto-publisher/backend/src/controllers/banner.controller.js)

Thay logic tìm T1/T2/T3 trong SKU → dùng field `bannerPosition`:

```js
const centerVar = validVariants.find(v => v.bannerPosition === 1);
const leftVar   = validVariants.find(v => v.bannerPosition === 2);
const rightVar  = validVariants.find(v => v.bannerPosition === 3);
```

Truyền số lượng ảnh thực tế vào `generateCollectionBanner()`:
- Chỉ có center → truyền `{ center: path }`
- Có center + left → truyền `{ center: path, left: path }`
- Đủ 3 → truyền `{ left: path, center: path, right: path }`

---

### Banner Service

#### [MODIFY] [banner.service.js](file:///c:/Users/Admin/Downloads/watch-auto-publisher/backend/src/services/banner.service.js)

Thêm 3 layout config:

```js
layouts: {
  single: {  // 1 đồng hồ to chính giữa
    center: { x: 350, y: 300, width: 550, height: 720 }
  },
  double: {  // 2 đồng hồ cân đối
    left:   { x: 150, y: 350, width: 480, height: 660 },
    center: { x: 530, y: 310, width: 500, height: 690 }
  },
  triple: {  // 3 đồng hồ (layout hiện tại)
    left:   { x: 72,  y: 380, width: 460, height: 640 },
    center: { x: 380, y: 330, width: 500, height: 690 },
    right:  { x: 722, y: 380, width: 460, height: 640 }
  }
}
```

Hàm `generateCollectionBanner()` nhận object `{ left?, center, right? }` thay vì array 3 phần tử, và tự chọn layout phù hợp.

---

## Verification Plan

### Manual Verification
1. Import file Excel SAPO có cột F đánh dấu 1, 2, 3
2. Tạo banner cho model chỉ có 1 ảnh → kiểm tra layout 1 đồng hồ
3. Tạo banner cho model có 2 ảnh → kiểm tra layout 2 đồng hồ
4. Tạo banner cho model có 3 ảnh → kiểm tra layout 3 đồng hồ (như hiện tại)
