# ZenWatch Shopee Link Worker

Ứng dụng Android nội bộ nhận tác vụ từ backend qua HTTPS và thực hiện chuỗi thao tác trong
ứng dụng Facebook:

1. Mở đúng bài Fanpage vừa đăng.
2. Mở menu ba chấm.
3. Chọn **Quản lý liên kết đến sản phẩm**.
4. Nhập URL Shopee và tên liên kết.
5. Bấm **Lưu** và trả kết quả về backend.

Bài viết/ảnh và video/Reels đều mở thẳng link đích, không vào profile, không chuyển
tab và không cuộn dò caption. Backend tra `permalink_url` của đối tượng vừa đăng;
video lưu theo `PAGE_ID_VIDEO_ID` và ưu tiên route `/{PAGE_ID}/videos/{VIDEO_ID}` để
Facebook Android không rơi vào Reels feed chung. Nếu Graph chưa trả permalink, dùng
route Page/video này; link sai ID/Page hoặc link share/feed không được dùng.

Worker mở HTTPS trong ứng dụng Facebook trước; nếu Facebook mở sai màn hình,
thử cùng link qua handler Facebook rồi link trực tiếp theo ID, với số lần giới hạn.
Từ 0.4.4, Worker không so sánh caption và không yêu cầu caption phải hiện hoặc có trong job.
Link đích đã được kiểm tra ID/Page là nguồn xác định bài; chỉ kiểm tra bố cục và menu để thao tác.
Reel toàn màn hình có bộ nhận diện riêng, không bắt buộc phải có header thời gian.

Với video, sau khi mở link đích và nhận diện nút tùy chọn:

1. Mở tùy chọn của video → **Quản lý sản phẩm**.
2. Chọn **Thêm sản phẩm liên kết tiếp thị**.
3. Nhập URL Shopee, tên liên kết và bấm **Lưu**.

Điện thoại không cần USB hoặc kết nối chung Wi-Fi với máy tính.

## Kết nối HTTPS ổn định bằng Tailscale Funnel

Tailscale được cài và đăng nhập một lần trên máy Windows chạy backend. Khi vận hành bình
thường, chỉ mở file sau ở thư mục gốc dự án:

```powershell
2_CHAY_TOOL.bat
```

File này khởi động đúng một bộ Redis, Mobile Worker Gateway, Tailscale Funnel, backend và
frontend. Funnel chuyển tiếp địa chỉ HTTPS cố định `https://<máy>.<tailnet>.ts.net` tới
gateway tại `http://127.0.0.1:3100`.

Ghi URL cố định vào `MOBILE_WORKER_BASE_URL` trong `backend/.env`, sau đó chạy:

```powershell
cd backend
npm.cmd run configure:mobile-worker
npm.cmd run test:mobile-worker
npm.cmd run test:mobile-worker-gateway
npm.cmd run test:mobile-worker-public
cd ..
```

Thông tin cần nhập vào điện thoại được ghi ở:

```text
backend/config/mobile_worker_pairing.txt
```

## Cài trên Samsung

1. Cài APK và cho phép cài ứng dụng không rõ nguồn gốc.
2. Mở app, nhập URL HTTPS cố định Tailscale và token trong file pairing.
3. Bấm **Kiểm tra kết nối**.
4. Bấm **Bật quyền Trợ năng**, chọn **ZenWatch – Gắn link Shopee** và bật dịch vụ.
5. Trong cài đặt Pin của Samsung, đặt app thành **Không giới hạn**.
6. Đặt kiểu khóa màn hình thành **Không dùng** hoặc **Vuốt**. Android không cho ứng dụng
   tự vượt qua PIN, mật khẩu, hình vẽ hay sinh trắc học.
7. Nên cắm sạc điện thoại trong thời gian chạy lịch tự động.
8. Đăng nhập Facebook và chuyển đúng sang Fanpage cần quản lý.
9. Đánh dấu **Tự khởi động Worker sau khi mở máy**.
10. Quay lại app và bấm **Bắt đầu Worker**.

Worker giữ CPU hoạt động khi màn hình tắt. Khi backend có tác vụ mới, ứng dụng tự bật màn
hình, tạm bỏ màn hình khóa dạng **Vuốt**, mở Facebook và giữ màn hình sáng cho đến khi gửi
kết quả. Khi không có tác vụ, màn hình được phép tắt bình thường.

## Build

Yêu cầu JDK 17 và Android SDK 35:

```powershell
.\gradlew.bat assembleDebug
```

APK debug được tạo tại:

```text
app/build/outputs/apk/debug/app-debug.apk
```

Bản sửa điều hướng đang cần xác nhận trên điện thoại thật:

```text
dist/ZenWatch-Link-Worker-v0.4.6-visual-menu-debug.apk
```

Bản `0.4.4` bỏ hoàn toàn bộ so khớp caption. Kiểm thử bố cục tổng hợp dựa trên ảnh
người dùng (869×1884) không thay thế kiểm tra trên điện thoại thật:

- Với bài ảnh, ưu tiên nút tùy chọn có nhãn/ID hoặc dấu ba chấm; tiếp theo là icon nhỏ
  không nhãn ở mép phải, cùng hàng tên Page/thời gian của một bài duy nhất.
- Nếu Facebook không xuất nút vào cây Trợ năng, chỉ bố cục chi tiết có nút đóng,
  tìm kiếm, hàng tác giả/thời gian và ô bình luận mới được bấm dự phòng theo hàng
  tác giả thực tế. Chỉ bấm một lần; phải thấy menu sản phẩm mới được nhập link.
- Với Reel toàn màn hình, không cần caption/thời gian; vẫn phải có một nút tùy chọn
  có nhãn/ID/dấu ba chấm. Không đoán icon trong cột Thích/Chia sẻ/âm thanh.
- Chỉ click trực tiếp node tùy chọn có nhãn/ID, không click ngược lên Page/khung bài.
  Icon không nhãn dùng gesture đúng vị trí; node tùy chọn có gesture dự phòng nếu chưa mở.

### Sửa lỗi đứng im sau khi mở bài (0.4.5)

- Mỗi lần backend xác nhận quyền xử lý, Worker chủ động đánh thức vòng Trợ năng.
  Không phụ thuộc việc Facebook có phát sinh sự kiện giao diện mới hay không;
  tín hiệu đánh thức không thay đổi thời gian chờ của một thao tác đã được lên lịch.
- Android từ chối gửi gesture không làm mất lần bấm dự phòng duy nhất. Tối đa ba lần
  gửi bị từ chối; cú bấm đã được Android chấp nhận vẫn giữ giới hạn cũ. Gesture bị hủy
  được ghi riêng, không được coi là bằng chứng menu sản phẩm đã mở.
- Gộp thời gian trùng nhau ở node cha/con của cùng header. Nút tùy chọn có nhãn/ID
  được chạm trực tiếp kể cả node không hỗ trợ click. Khi không đọc được thời gian,
  chỉ dùng nút có nhãn/ID trong vùng đầu bài của màn chi tiết; không đoán icon vô danh.
- Yêu cầu Android cung cấp thêm node vốn bị loại khỏi cây Trợ năng qua
  [flagIncludeNotImportantViews](https://developer.android.com/reference/android/accessibilityservice/AccessibilityServiceInfo#FLAG_INCLUDE_NOT_IMPORTANT_VIEWS).
  Đây không phải bảo đảm Facebook sẽ cung cấp mọi nút.
- Phần Trạng thái hiển thị dịch vụ Trợ năng có thực sự kết nối hay chưa, lý do chờ,
  bước tìm ba chấm và kết quả gửi/hoàn tất/hủy cú chạm. Không ghi caption, token hay
  toàn bộ cây giao diện vào chẩn đoán.

Sau khi cài đè 0.4.5, tắt rồi bật lại quyền Trợ năng của ZenWatch, mở Worker và xác nhận
**Dịch vụ Trợ năng: đã kết nối**, sau đó chạy lại đúng job thất bại. Nếu vẫn đứng im,
chụp phần **Trạng thái / Thao tác gần nhất** trong Worker (che token). Cần thử trên
điện thoại thật; kiểm thử giả lập node và build thành công chưa chứng minh đã gắn link
thành công trên Facebook. Luồng video chưa được người dùng kiểm tra thực tế.

### Nhận diện ba chấm bị thiếu node (0.4.6)

Ảnh trạng thái 0.4.5 cho thấy `OPEN_POST`, `nodes=87`, `headers=1`, `tabs=0`,
`stale=false wrong=false boost=false`: đã đọc được giao diện nhưng chưa tìm được nút.
Đây là nhánh khác với lỗi không đánh thức vòng xử lý đã sửa trong 0.4.5.

- Khi không nhận diện được nút qua Trợ năng, bài thường trên Android 11+ có nhánh
  nhận diện hình dạng ba dấu chấm ngang trong vùng đầu bài. Không cần node tên Page,
  nút đóng/tìm kiếm hay caption; vẫn cần đúng một hàng thời gian ở đầu bài.
- Chỉ nhận một cụm ba chấm tròn, cùng hàng, đều khoảng cách, nền trắng; từ chối ảnh
  tối/che phủ, nhiều cụm, nút có nhãn Chia sẻ/Quảng bá, Feed/profile và video toàn màn hình.
  Không dùng nhánh ảnh này để đoán nút của Reel. Giao diện tối chưa được hỗ trợ.
- Dùng [AccessibilityService.takeScreenshot](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#takeScreenshot(int,java.util.concurrent.Executor,android.accessibilityservice.AccessibilityService.TakeScreenshotCallback)):
  ảnh tạm thời chỉ được phân tích phần đầu bài trên điện thoại, không lưu vào file,
  không gửi tới backend/dịch vụ khác; giải phóng bitmap và hardware buffer sau mỗi lần đọc.
- Tối đa ba lần đọc cho mỗi cách mở link; chờ callback tối đa hai giây. Trước khi bấm
  kiểm tra lại job/quyền xử lý, cửa sổ Facebook đang focus, kích thước màn hình và bố cục
  đầu bài không đổi. Callback cũ/đổi job/đổi màn hình không được bấm. Chỉ chạm một lần
  vào vị trí tìm được trên ảnh mới; vẫn phải thấy menu quản lý sản phẩm trước khi nhập link.
- Có kiểm thử pixel bằng hai ảnh tham chiếu người dùng trên máy phát triển ở năm tỉ lệ;
  ảnh riêng không đưa vào Git. Đây chưa phải kiểm thử thao tác trên điện thoại thật.

Cài đè APK **0.4.9** (không cần gỡ app), tắt/bật lại quyền Trợ năng, rồi Bắt đầu Worker.
Các sửa về chờ đồng bộ Reel và làm sạch caption nằm ở backend; máy nhân viên cần trỏ tới
backend đã cập nhật rồi retry đúng job lỗi trên giao diện quản lý, không đăng lại bài.
Nếu Android từ chối chụp ảnh hoặc không tìm thấy dấu chấm, mục Trạng thái có lý do/mã lỗi
cụ thể. Không vượt qua cửa sổ bảo mật hay chạm tọa độ cũ khi ảnh không hợp lệ.

### Reel cần cuộn menu để thấy quản lý sản phẩm (0.4.9)

Sau khi mở ba chấm của Reel, Facebook có thể đặt mục **Quản lý sản phẩm** bên dưới vùng
đang hiển thị. Worker chỉ cuộn bảng tùy chọn của Facebook (tối đa 4 lần), sau đó bấm
**Quản lý sản phẩm** → **Thêm sản phẩm liên kết tiếp thị** rồi mới nhập URL. Worker không
swipe lên video hoặc Feed.

Bản 0.4.7 ưu tiên URL `https://www.facebook.com/{PAGE_ID}/videos/{VIDEO_ID}` cho Reel
có `PAGE_ID_VIDEO_ID`, rồi mới dùng permalink Graph trả về. Trạng thái Worker hiển thị
cả URL đang mở để đối chiếu khi Facebook chuyển hướng sai.

Backend chờ mặc định 15 giây sau khi Facebook trả về `VIDEO_ID` trước khi lấy permalink
và xếp job cho Worker, để Facebook kịp hoàn tất việc dựng Reel. Có thể đặt
`MOBILE_REEL_PROPAGATION_DELAY_MS`, nhưng giá trị luôn được giới hạn trong 10.000–20.000ms.

Để chạy thêm các ca ảnh riêng (không bắt buộc cho CI): đặt biến môi trường
`ZENWATCH_MENU_REFERENCE_IMAGES` thành các đường dẫn PNG, ngăn bằng dấu `;`, rồi chạy
`testDebugUnitTest --rerun-tasks`. Các ca tổng hợp không cần ảnh ngoài repository.

Không vào profile để tìm bài. Chấp nhận menu sản phẩm chỉ sau khi lần xử lý hiện tại
đã bấm menu bài đích. Nếu Facebook chuyển về Feed/profile hoặc không cung cấp mục
quản lý sản phẩm, Worker báo lỗi. Không so caption đồng nghĩa không có lớp đối chiếu
nội dung nếu Facebook tự khôi phục một bài khác; việc mở Intent không tự chứng minh
màn hình đã hiển thị đúng ID.

Worker xác nhận lại quyền xử lý với backend trước khi mở bài,
tạm dừng thao tác khi mất kết nối và dừng Trợ năng khi bấm **Dừng Worker**.
Job đã lưu kết quả vẫn gửi lại được khi điện thoại khóa màn hình hoặc tắt Trợ năng.
Nhãn nút Lưu được đối chiếu riêng từng trường của Android; sau khi nhập, URL và tên
liên kết được đọc lại trước khi lưu. Chỉ báo thành công khi có thông báo lưu thành công
hoặc thấy đúng URL trên giao diện quản lý; đóng form đơn thuần không đủ xác nhận.

`test:mobile-worker` tạo database SQLite tạm riêng, chạy các ca nhận đồng thời,
mất phản hồi, hết hạn, retry và gửi kết quả cũ qua gateway, rồi xóa database tạm.
Job thiếu caption vẫn được nhận và retry; `postText` chỉ là metadata tùy chọn để tương thích.
Job sai URL/contentType/sản phẩm vẫn bị từ chối và không chặn các job hợp lệ phía sau.

Job đã FAILED không tự chạy lại chỉ bằng việc bấm **Bắt đầu Worker**.
Sau khi cài APK và cập nhật backend, thử lại chính job bị lỗi bằng chức năng retry;
không đăng thêm một bài mới chỉ để thay thế job cũ. Cần quay màn hình Facebook từ lúc
Worker mở link bài/video đến khi lưu hoặc báo lỗi để xác nhận luồng thực tế.

## Khi có HTTP 502

HTTP 502 là lỗi kết nối gateway/backend/tunnel, không phải kiểm tra caption hay nút ba chấm.
Dòng trạng thái hiện tại và kết quả job gần nhất là hai thông tin riêng. Cần kiểm tra URL
Worker đang dùng và các dịch vụ trên đúng máy chủ; trạng thái cổng trên máy phát triển
không chứng minh tình trạng máy nhân viên. Không gửi token khi chụp/quay màn hình.

## Cấu hình backend

- `MOBILE_WORKER_TOKEN`: token xác thực điện thoại.
- `MOBILE_WORKER_BASE_URL`: URL HTTPS cố định do Tailscale Funnel cấp.
- `MOBILE_SHOPEE_LINK_MODE=android_worker`: dùng Android Worker.
- `MOBILE_SHOPEE_LINK_MODE=disabled`: tắt bước gắn link.
- `MOBILE_SHOPEE_LINK_NAME`: tên liên kết, mặc định `Mua ở đây`.

## Giới hạn

- Selector hỗ trợ giao diện Facebook tiếng Việt trong ảnh tham chiếu và một số nhãn tiếng
  Anh tương đương.
- Facebook đổi giao diện có thể yêu cầu cập nhật selector.
- Đây là APK nội bộ. Nếu phát hành Google Play phải hoàn thành khai báo Accessibility
  Service và phần công khai/đồng ý dữ liệu theo chính sách Play.
