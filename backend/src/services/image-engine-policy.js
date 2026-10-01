// Thứ tự engine tạo ảnh cho MỘT lần gọi. Engine đầu tiên chạy trước; nếu thất
// bại (không trả về ảnh nào) hệ thống tự chuyển engine dự phòng kế tiếp để đảm
// bảo luôn có ảnh. 'rotate' = luân phiên ChatGPT ↔ Gemini qua từng lần gọi.
export const resolveEngineOrder = (engineSetting, rotatedEngine) => {
  switch (engineSetting) {
    case 'sd':
      return ['sd'];
    case 'gemini':
      return ['gemini', 'chatgpt'];
    case 'rotate':
      return rotatedEngine === 'gemini' ? ['gemini', 'chatgpt'] : ['chatgpt', 'gemini'];
    case 'chatgpt':
    default:
      return ['chatgpt', 'gemini'];
  }
};
