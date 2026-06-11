import { getMessagesByConversation } from '../utils/crm.db.js';
import { getCustomerProfile, updateCustomerProfile } from '../utils/crm.db.js';

/**
 * Hệ thống tự động gắn Tags dựa trên phân tích từ khóa tin nhắn
 * Quy tắc:
 * - "Đã đặt": Khách xác nhận đặt hàng, gửi địa chỉ ship, chuyển khoản...
 * - "Bảo hành": Khách hỏi về bảo hành, sản phẩm lỗi, đổi trả...
 * - "Quan tâm": Khách hỏi giá, hỏi mẫu nhưng chưa chốt đơn
 * - "Khách buôn": Khách hỏi giá sỉ, đại lý, số lượng lớn
 * - "Khách VIP": Khách đã mua nhiều lần (>= 2 lần xuất hiện tag "Đã đặt" trong lịch sử)
 */

const TAG_RULES = {
  'Đã đặt': {
    // Từ khóa chỉ ra khách đã chốt đơn
    keywords: [
      'đã đặt', 'đặt hàng', 'chốt', 'chốt đơn', 'mua luôn', 'lấy luôn', 'em lấy', 'anh lấy', 'mình lấy', 'chị lấy',
      'ship', 'giao', 'gửi cho shop', 'gửi về', 
      'chuyển khoản', 'ck', 'đã ck', 'ck rồi', 'thanh toán', 'cod', 
      'địa chỉ', 'sđt', 'số điện thoại', 'đ/c', 'dc', 'nhận hàng', 'order', 'đặt'
    ],
    priority: 3  // Ưu tiên cao — nếu khách đã đặt, override "Quan tâm"
  },
  'Bảo hành': {
    keywords: [
      'bảo hành', 'bh', 'hỏng', 'lỗi', 'bị lỗi', 'không chạy', 'chết máy', 'đứng kim',
      'trả hàng', 'đổi hàng', 'hoàn tiền', 
      'vỡ', 'bị vỡ', 'trầy', 'nứt', 'hư', 'tróc', 'rỉ', 'vô nước', 'vào nước',
      'sửa', 'sửa chữa', 'fix', 'repair', 
      'kính', 'kim', 'pin', 'thay pin', 
      'kiểm tra', 'ktra', 'mang qua', 'gửi qua'
    ],
    priority: 4  // Ưu tiên cao nhất — vấn đề cần giải quyết ngay
  },
  'Khách buôn': {
    keywords: [
      'đại lý', 'giá sỉ', 'sỉ', 'bán sỉ', 'lấy sỉ', 'mua sỉ', 
      'số lượng', 'số lượng lớn', 'buôn', 'giá buôn',
      'ctv', 'giá ctv', 'cộng tác viên', 'drop', 'dropship', 'hợp tác'
    ],
    priority: 2
  },
  'Quan tâm': {
    keywords: [
      'giá', 'giá sao', 'giá nhiêu', 'bao nhiêu', 'nhiêu', 'bn', 'bnhiu', 'bnhieu', 'báo giá', 'xin giá',
      'còn hàng', 'còn ko', 'còn không', 'còn', 'hết chưa',
      'tư vấn', 'xem thêm', 'mẫu', 'mẫu này', 'chiếc này',
      'inbox', 'pm', 'ib',
      'phí ship', 'freeship', 
      'size', 'kích thước', 'chống nước', 'dây', 'dây da', 'dây kim loại', 'màu',
      'ảnh', 'hình', 'ảnh thật', 'hình thật',
      'máy', 'cơ', 'quartz', 'automatic'
    ],
    priority: 1  // Ưu tiên thấp nhất — dễ bị override bởi tag khác
  }
};

/**
 * Phân tích tin nhắn và trả về danh sách tags phù hợp (Sử dụng đối sánh từ chính xác)
 */
const analyzeMessages = (messages) => {
  // Chỉ phân tích tin nhắn từ khách, loại bỏ các URL đính kèm để tránh match nhầm từ khóa
  const customerMessages = messages
    .filter(m => !m.is_from_page && m.message)
    .map(m => m.message.toLowerCase().replace(/\[(?:image|video|file|audio):.*?\]/g, ' '));
  
  const allText = customerMessages.join(' \n ');
  
  // Chuẩn hóa text: thay thế dấu câu bằng khoảng trắng, thêm khoảng trắng ở 2 đầu
  // Điều này giúp match chính xác từ (word boundary) trong tiếng Việt
  const paddedText = ` ${allText.replace(/[.,!?;:\n\r]/g, ' ')} `;
  const normalizedText = paddedText.replace(/\s+/g, ' '); // Xóa khoảng trắng thừa
  
  const matchedTags = [];
  
  for (const [tagName, rule] of Object.entries(TAG_RULES)) {
    // Kiểm tra xem có từ khóa nào được bao bọc bởi khoảng trắng không
    const matched = rule.keywords.some(kw => normalizedText.includes(` ${kw} `));
    if (matched) {
      matchedTags.push({ tag: tagName, priority: rule.priority });
    }
  }
  
  // Sắp xếp theo priority (cao trước)
  matchedTags.sort((a, b) => b.priority - a.priority);
  
  const tagNames = matchedTags.map(t => t.tag);
  
  // Logic loại trừ thông minh:
  // Nếu đã gắn "Đã đặt" hoặc "Bảo hành" thì bỏ "Quan tâm"
  if ((tagNames.includes('Đã đặt') || tagNames.includes('Bảo hành')) && tagNames.includes('Quan tâm')) {
    const idx = tagNames.indexOf('Quan tâm');
    tagNames.splice(idx, 1);
  }
  
  return tagNames;
};

/**
 * Tự động gắn tag cho 1 khách hàng dựa trên conversation
 * @param {string} senderId - ID của khách hàng
 * @param {string} conversationId - ID conversation để lấy tin nhắn
 * @returns {string[]} - Danh sách tags mới
 */
export const autoTagCustomer = async (senderId, conversationId) => {
  try {
    // Lấy tin nhắn
    const messages = await getMessagesByConversation(conversationId);
    if (!messages || messages.length === 0) return [];
    
    // Phân tích
    const suggestedTags = analyzeMessages(messages);
    if (suggestedTags.length === 0) return [];
    
    // Lấy tags hiện tại
    const profile = await getCustomerProfile(senderId);
    let currentTags = [];
    try {
      currentTags = typeof profile.tags === 'string' ? JSON.parse(profile.tags) : (profile.tags || []);
    } catch(e) { currentTags = []; }
    
    // Đếm số lần "Đã đặt" xuất hiện (nếu đã có tag "Đã đặt" trước đó VÀ lại match lần nữa → VIP)
    const orderCount = (profile.order_count || 0);
    
    // Merge: chỉ thêm tags mới, không xóa tags cũ do người dùng tự gắn
    let newTags = [...currentTags];
    let changed = false;
    
    for (const tag of suggestedTags) {
      if (!newTags.includes(tag)) {
        newTags.push(tag);
        changed = true;
        console.log(`🏷️ [Auto-Tag] Gắn "${tag}" cho khách ${senderId}`);
      }
    }
    
    // Check VIP: Nếu đã có tag "Đã đặt" từ trước VÀ có nhiều tin nhắn hỏi mua → VIP
    // Logic đơn giản: nếu có >= 10 tin nhắn từ khách + đã đặt → VIP
    const customerMsgCount = messages.filter(m => !m.is_from_page).length;
    if (newTags.includes('Đã đặt') && customerMsgCount >= 10 && !newTags.includes('Khách VIP')) {
      newTags.push('Khách VIP');
      changed = true;
      console.log(`🏷️ [Auto-Tag] Gắn "Khách VIP" cho khách ${senderId} (${customerMsgCount} tin nhắn + đã đặt)`);
    }
    
    // Lưu nếu có thay đổi
    if (changed) {
      await updateCustomerProfile(senderId, { tags: JSON.stringify(newTags) });
    }
    
    return newTags;
  } catch (err) {
    console.error('❌ Lỗi Auto-Tag:', err.message);
    return [];
  }
};

/**
 * Chạy auto-tag cho tất cả conversations
 */
export const autoTagAllConversations = async (conversations) => {
  for (const conv of conversations) {
    if (conv.sender_id && conv.type === 'inbox') {
      await autoTagCustomer(conv.sender_id, conv.id);
    }
  }
};
