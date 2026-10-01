// Kiểm tra "tiêu chuẩn bài đăng" FB/IG trước khi đăng + tách nội dung FB/IG
// từ phản hồi ChatGPT gộp 1 lần gọi.

export const PLATFORM_LIMITS = {
    fb: { maxLength: 63206, minLength: 20, maxHashtags: null },
    ig: { maxLength: 2200, minLength: 15, maxHashtags: 30 },
    threads: { maxLength: 500, minLength: 15, maxHashtags: null },
};

// Hashtag thương hiệu bắt buộc — mỗi bài phải có ÍT NHẤT 2 trong 3 hashtag này
export const BRAND_HASHTAGS = ['iwcarnivalvietnam', 'iwcarnival', 'donghoiwcarnival'];

// Từ ngữ bị cấm trong template (sale sốc, giá rẻ...)
const BANNED_PHRASES = [
    'sale soc', 'gia re', 'mua ngay keo lo', 'freeship', 'inbox gia',
    'khuyen mai soc', 'giam gia soc', 'gia soc', 'tra gop 0',
];

const VIETNAMESE_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

const FB_MARK = /(?:^|\n)\s*(?:#{1,3}\s*)?\*{0,2}FACEBOOK\*{0,2}\s*:?\s*\n/i;
const IG_MARK = /(?:^|\n)\s*(?:#{1,3}\s*)?\*{0,2}INSTAGRAM\*{0,2}\s*:?\s*\n/i;

// Bỏ dấu tiếng Việt để so khớp từ khóa không phân biệt dấu (sale sốc = sale soc)
const stripVietnameseDiacritics = (text) => text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');

const normalize = (text) => stripVietnameseDiacritics((text || '')
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:()\[\]{}"'“”‘’—–\-–*#]/g, ' ')
    .trim()
    .toLowerCase());

// Lời nhắc sửa cho ChatGPT khi nội dung bị đánh giá dở theo từng lý do
export const REASON_FIX_TEXT = {
    'too-short-or-empty': 'bài quá ngắn hoặc rỗng — viết đầy đủ hơn',
    'too-long': 'bài quá dài — rút gọn lại',
    'prompt-echo': 'bài lặp lại chính yêu cầu/prompt — phải viết nội dung thật, không nhắc lại yêu cầu',
    'template-instruction': 'bài còn placeholder/hướng dẫn mẫu — viết nội dung hoàn chỉnh',
    'banned-phrase': 'bài dùng từ ngữ bị cấm (sale sốc, giá rẻ, mua ngay kẻo lỡ, freeship, inbox giá...)',
    'diacritic-hashtag': 'hashtag có dấu tiếng Việt — viết không dấu',
    'missing-brand-hashtag': `thiếu hashtag thương hiệu — phải có ít nhất 2 trong 3 hashtag: #${BRAND_HASHTAGS.join(' #')}`,
    'too-many-hashtags': 'quá 30 hashtag — giảm xuống',
};

export const splitFbIgContent = (text) => {
    if (!text) return { fb: '', ig: '' };
    const fbMatch = text.match(FB_MARK);
    const igMatch = text.match(IG_MARK);
    const fbStart = fbMatch ? fbMatch.index + fbMatch[0].length : -1;
    const igStart = igMatch ? igMatch.index + igMatch[0].length : -1;

    let fb = '';
    let ig = '';
    if (fbStart >= 0 && igStart > fbStart) {
        fb = text.slice(fbStart, igMatch.index).trim();
        ig = text.slice(igStart).trim();
    } else if (fbStart >= 0) {
        fb = text.slice(fbStart).trim();
    } else if (igStart >= 0) {
        fb = text.slice(0, igMatch.index).trim();
        ig = text.slice(igStart).trim();
    } else {
        fb = text.trim();
    }
    return { fb, ig };
};

// Phát hiện nội dung trả về là "echo" lại chính prompt đã gửi cho ChatGPT
// (tool lấy nhầm prompt thay vì câu trả lời).
export const containsPromptEcho = (text, prompt) => {
    if (!text || !prompt) return false;
    const nText = normalize(text);
    const nPrompt = normalize(prompt);
    if (!nText || !nPrompt) return false;
    // Trùng toàn bộ prompt hoặc phần lớn prompt (>= 120 ký tự liên tiếp)
    if (nText.includes(nPrompt)) return true;
    const chunkLen = Math.min(120, nPrompt.length);
    if (chunkLen < 60) return false;
    for (let i = 0; i <= nPrompt.length - chunkLen; i += 20) {
        if (nText.includes(nPrompt.slice(i, i + chunkLen))) return true;
    }
    return false;
};

// Phát hiện ChatGPT trả về "chỉ dẫn" của template thay vì bài viết thật.
const TEMPLATE_INSTRUCTION_RE = /\[(viết|write)[^\]]*tại đây|here\]|50\s*—?\s*80\s*từ|15\s*—?\s*35\s*từ|BÀI FB|CAPTION IG|bấm "xem thêm"/i;

const getHashtags = (text) => (text.match(/#[\w\u00C0-\u024F]+/g) || []);

export const validateSocialPostContent = (text, { platform = 'fb', prompt = null } = {}) => {
    const limits = PLATFORM_LIMITS[platform] || PLATFORM_LIMITS.fb;
    if (!text || text.trim().length < limits.minLength) {
        return { ok: false, reason: 'too-short-or-empty' };
    }
    if (text.length > limits.maxLength) {
        return { ok: false, reason: 'too-long' };
    }
    if (containsPromptEcho(text, prompt)) {
        return { ok: false, reason: 'prompt-echo' };
    }
    if (TEMPLATE_INSTRUCTION_RE.test(text)) {
        return { ok: false, reason: 'template-instruction' };
    }
    const normalized = normalize(text);
    if (BANNED_PHRASES.some((phrase) => normalized.includes(phrase))) {
        return { ok: false, reason: 'banned-phrase' };
    }
    const hashtags = getHashtags(text);
    if (hashtags.some((tag) => VIETNAMESE_DIACRITICS.test(tag))) {
        return { ok: false, reason: 'diacritic-hashtag' };
    }
    const brandCount = BRAND_HASHTAGS.filter((brand) =>
        hashtags.some((tag) => tag.slice(1).toLowerCase() === brand)
    ).length;
    if (brandCount < 2) {
        return { ok: false, reason: 'missing-brand-hashtag' };
    }
    if (platform === 'ig' && limits.maxHashtags && hashtags.length > limits.maxHashtags) {
        return { ok: false, reason: 'too-many-hashtags' };
    }
    return { ok: true, reason: null };
};
