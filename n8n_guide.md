# Hướng Dẫn Cấu Hình Siêu Workflow n8n

Với kiến trúc mới, Node.js sẽ gửi toàn bộ dữ liệu (kể cả file ảnh gốc) sang n8n qua phương thức `multipart/form-data`. Nhiệm vụ của bạn là dựng 1 luồng (Workflow) n8n để xử lý như sau:

## BƯỚC 1: Cấu hình Trạm 1 (Webhook)
1. Mở node Webhook hiện tại của bạn.
2. Tại mục **HTTP Method**, đảm bảo chọn `POST`.
3. Tại mục **Respond**, bạn bắt buộc chọn **`Using 'Respond to Webhook' Node`** (Trả lời thông qua node cuối cùng). Việc này giúp n8n tính toán xong xuôi toàn bộ AI rồi mới trả kết quả về cho Node.js.
4. Bấm `Listen for test event`, sau đó qua Terminal chạy `npm run dev` để Node.js bắn 1 phát dữ liệu sang cho n8n mồi thử.

## BƯỚC 2: Rẽ Nhánh (Node Switch hoặc IF)
Sau khi Webhook nhận dữ liệu, bạn thêm 1 node **Switch** (hoặc IF) để chia làm 2 đường đi dựa vào biến `postMode` mà Node.js gửi sang:
- Kéo từ Webhook sang node Switch.
- Value 1 để test: `={{ $json.body.postMode }}`
- Rule 1 (Đường 1): Nếu bằng `ALBUM`
- Rule 2 (Đường 2): Nếu bằng `AI`

---

## BƯỚC 3: Dựng Đường 1 (Nếu là ALBUM)
Đường này cực kỳ đơn giản vì chỉ cần viết Content (Album đã có Node.js lo ghép ảnh).
1. Thêm node **OpenAI (ChatGPT)** hoặc **Google Gemini**.
2. Nối nhánh `ALBUM` của Switch vào node này.
3. Prompt (Câu lệnh):
   ```text
   Viết 1 bài post Facebook bán đồng hồ. Mã SKU: {{$json.body.sku}}.
   Đây là bộ sưu tập (Album) gồm {{$json.body.imageCount}} bức ảnh thực tế siêu đẹp.
   Thông số chi tiết:
   {{$json.body.productInfoText}}
   Yêu cầu: Viết chốt sale cực mạnh, giật tít. KHÔNG chào hỏi lôi thôi. Trả về đúng nội dung.
   ```
4. Cuối cùng, thêm node **Respond to Webhook**. Mục *Respond With* chọn `JSON`, và thiết lập Data là:
   ```json
   {
     "content": "={{ $json.text }}" 
   }
   ```
   *(Lưu ý: Thay `$json.text` bằng đúng cái biến chứa câu trả lời của GPT/Gemini)*.

---

## BƯỚC 4: Dựng Đường 2 (Nếu là AI)
Đường này hệ thống gửi kèm file ảnh vật lý (Nằm ở mục `Binary` của Webhook, tên là `image`). Bạn cần làm 4 Node nối tiếp nhau:

**Node 4.1: Xóa Phông Nền (HTTP Request)**
- Đăng ký 1 tài khoản `remove.bg` để lấy API Key miễn phí.
- Dùng node HTTP Request gọi API của Remove.bg (truyền file `image` từ webhook vào). Node này sẽ trả về cho bạn cái đồng hồ trong suốt (không có phông nền).

**Node 4.2: Vẽ Phông Nền Bằng DALL-E 3 (OpenAI)**
- Thêm node **OpenAI**, chọn tính năng *Generate Image*.
- Model: `dall-e-3`.
- Prompt: `A luxury dark marble table with warm elegant studio lighting, empty, no objects, hyper realistic`. (Vẽ 1 cái bàn đá sang trọng không có đồ vật).
- Đảm bảo đầu ra lưu thành dạng file Binary.

**Node 4.3: Ghép Ảnh (Edit Image)**
- Thêm node **Edit Image** (có sẵn của n8n).
- Chọn Operation là **Composite** (Ghép chồng ảnh).
- Input 1: Phông nền từ DALL-E 3.
- Input 2: Ảnh đồng hồ trong suốt từ Remove.bg.
- Chỉnh tọa độ (X, Y) để căn cái đồng hồ vào giữa cái bàn.

**Node 4.4: Viết Content & Trả Kết Quả**
- Dùng 1 node ChatGPT/Gemini để viết Content (Prompt giống hệt Bước 3, chỉ sửa lại văn phong cho "Sang trọng, quý phái").
- Cuối cùng, thêm node **Respond to Webhook**. Mục *Respond With* chọn `JSON` và cấu hình Data trả về có đủ 2 thứ:
  ```json
  {
    "content": "={{ $json.text_cua_gpt }}",
    "imageBase64": "={{ $binary.data.data }}" 
  }
  ```
  *(Lưu ý: `imageBase64` bạn trỏ vào cái dữ liệu data của bức ảnh đã ghép xong ở Node Edit Image).*

---

Làm xong luồng này, hệ thống của bạn thực sự là một HỆ SINH THÁI KHÔNG THỂ BỊ ĐÁNH BẠI! Hãy bắt tay vào kéo thả trên n8n ngay nhé!
