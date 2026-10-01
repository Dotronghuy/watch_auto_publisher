// Kiểm tra "tiêu chuẩn bài đăng" FB/IG trước khi đăng + tách nội dung FB/IG
// từ phản hồi ChatGPT gộp 1 lần gọi.

export const PLATFORM_LIMITS = {
    fb: { maxLength: 63206, minLength: 20, maxHashtags: null },
    ig: { maxLength: 2200, minLength: 15, maxHashtags: 30 },
    threads: { maxLength: 500, minLength: 15, maxHashtags: null },
};

const FB_MARK = /(?:^|\n)\s*(?:#{1,3}\s*)?\*{0,2}FACEBOOK\*{0,2}\s*:?\s*\n/i;
const IG_MARK = /(?:^|\n)\s*(?:#{1,3}\s*)?\*{0,2}INSTAGRAM\*{0,2}\s*:?\s*\n/i;

const normalize = (text) => (text || '')
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:()\[\]{}"'“”‘’—–\-–*#]/g, ' ')
    .trim()
    .toLowerCase();

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
    if (platform === 'ig' && limits.maxHashtags) {
        const hashtags = (text.match(/#[\w\u00C0-\u024F]+/g) || []).length;
        if (hashtags > limits.maxHashtags) {
            return { ok: false, reason: 'too-many-hashtags' };
        }
    }
    return { ok: true, reason: null };
};
