import { generateContentOnChatGPT } from './services/playwright.service.js';
const rules = '[SYSTEM INSTRUCTION - HUẤN LUYỆN BẮT BUỘC TỪ BÂY GIỜ]:\nKể từ thời điểm này, mỗi khi tôi yêu cầu bạn tạo ảnh ghép chiếc đồng hồ vào ảnh mẫu, bạn PHẢI tuân thủ nghiêm ngặt các quy tắc sau để ảnh không bị giả trân (fake):\n1. GIỮ NGUYÊN BẢN 100%: Tuyệt đối không tự ý vẽ thêm, làm méo mó, hay thay đổi chi tiết, mặt số, dây đeo của chiếc đồng hồ gốc.\n2. ÁNH SÁNG VÀ BÓNG ĐỔ THẬT: Phải tính toán hướng sáng của bức ảnh mẫu. Đồng hồ phải có bóng đổ (shadow) tự nhiên dưới đáy ăn khớp với bối cảnh, tuyệt đối không để đồng hồ có cảm giác lơ lửng hay dán đè lên.\n3. MÀU SẮC ĐỒNG BỘ: Cân bằng màu (Blend) của đồng hồ sao cho tiệp với tone màu của bức ảnh mẫu.\n4. TỶ LỆ THỰC TẾ: Đặt đồng hồ vào đúng tỷ lệ kích thước thật so với các vật thể xung quanh.\nChỉ cần trả lời ngắn gọn: Đã ghi nhận! Tôi sẽ áp dụng các tiêu chuẩn thiết kế chân thực này cho mọi yêu cầu tạo ảnh từ nay về sau.';
(async () => {
    try {
        console.log('Đang mở trình duyệt để nạp lệnh huấn luyện vào não AI tạo ảnh...');
        await generateContentOnChatGPT(rules, 'image_feedback', null);
        console.log('Đã huấn luyện xong AI tạo ảnh!');
        process.exit(0);
    } catch (e) {
        console.error('Lỗi:', e);
        process.exit(1);
    }
})();