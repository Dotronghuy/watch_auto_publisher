# Kế hoạch Phân chia Shopee Product theo Nhóm Dây & Vỏ (Strap & Plating)

Thay vì gộp toàn bộ SKU của 1 dòng máy (Model) vào chung 1 sản phẩm Shopee như hiện tại, hệ thống sẽ tiến hành chia nhỏ chúng ra. Các SKU sẽ được nhóm chung vào 1 sản phẩm Shopee nếu chúng đáp ứng đủ 2 điều kiện: **Cùng chất liệu dây** (Dựa vào mã SKU) và **Cùng màu vỏ/mạ** (Dựa vào AI phân tích ảnh).

## User Review Required

> [!WARNING]
> Vì màu vỏ (mạ vàng hồng / nguyên bản) không thể suy ra 100% từ mã SKU, hệ thống vẫn cần dùng **AI (Gemini Vision)** để quét ảnh của những mã có cùng loại dây nhằm tìm ra các mẫu cùng màu vỏ. Tuy nhiên, AI sẽ **không quét từng cái rồi dừng lại**, mà nó sẽ quét **ĐỒNG LOẠT TẤT CẢ** các mã trong cùng 1 loại dây để gom lại thành 1 mảng duy nhất.

> [!IMPORTANT]  
> Các SKU được nhóm chung (ví dụ: nhóm toàn bộ các mã dây thép mạ vàng hồng T8, T9, T16, T19) sẽ xài chung 1 `shopeeProductId`. Khi tôi cập nhật mã này về Database, nó sẽ cập nhật đồng loạt cho toàn bộ các SKU anh em trong nhóm đó.

## Proposed Changes

### Thay đổi File Cốt Lõi (Shopee Sync Service)

#### [MODIFY] shopeeSync.service.js
- Thêm hàm phân loại tự động `groupVariantsByDesignAI(targetVariant, potentialVariants)` chia làm 2 bước:
  - **Bước 1 (Lọc cứng bằng Logic):** Nhìn vào chuỗi SKU của `targetVariant` (ví dụ: `751G-T7`). Trích xuất ký tự ngay sau dấu gạch ngang (trong trường hợp này là `T`). Chỉ giữ lại **TẤT CẢ** các `potentialVariants` có cùng ký tự `T`. 
  - **Bước 2 (Lọc mềm bằng AI):** Gửi đồng loạt Avatar của biến thể gốc (Ví dụ T7 - thép bạc) và **TOÀN BỘ** các biến thể dây thép còn lại (T8, T9, T14, T15, T16, T18, T19) lên Gemini trong cùng 1 lần gọi. 
  - Yêu cầu AI lọc ra những mã CÙNG MÀU VỎ (thép bạc) với T7. AI sẽ trả về kết quả quét qua toàn bộ danh sách mà không bỏ sót mã nào ở dưới (như T14, T15, T18 sẽ được gom chung với T7). Tương tự, nếu bạn bấm Sync mã T8 (vàng hồng), AI sẽ quét toàn bộ và gom T8, T9, T16, T19 vào chung 1 bộ.
- Sửa đổi hàm `runShopeeAutomationDemo`:
  - Thay thế bước query toàn bộ `allVariants` bằng mảng kết quả trả về từ `groupVariantsByDesignAI`.
  - Cập nhật dòng lưu DB cuối cùng: Cập nhật `shopeeProductId` cho **toàn bộ mảng `allVariants`** đã được nhóm lại thay vì chỉ update 1 bản ghi hiện tại.

## Verification Plan

### Manual Verification
- Bạn ấn nút **Auto Sync** cho mã `751G-T7` trên giao diện.
- Con bot Playwright sẽ chỉ đưa lên 4 phân loại là T7, T14, T15, T18 (Vì chúng cùng là dây thép, vỏ thép bạc).
- Tiếp theo bạn ấn Sync cho mã `751G-T8`, con bot sẽ chỉ đưa lên T8, T9, T16, T19 (dây thép, vỏ vàng hồng).
- Kiểm tra Database xem các mã trong từng nhóm có được gán chung ID tương ứng của Shopee không.
