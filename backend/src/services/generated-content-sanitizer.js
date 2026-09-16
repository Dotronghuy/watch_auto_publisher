const PROJECT_SOURCE_LABELS = new Set([
  'customer-persona',
  'customer-persona.md',
  'watch-marketing-content',
  'watch-marketing-content.md',
]);

const normalizeSourceLabel = (line) => String(line || '')
  .trim()
  .replace(/^[-*•]\s*/, '')
  .replace(/^[`*_]+|[`*_]+$/g, '')
  .trim()
  .toLowerCase();

const isProjectSourceOnlyLine = (line) => {
  const normalized = normalizeSourceLabel(line);
  if (!normalized) return false;

  const labels = normalized.split(/\s+/).filter(Boolean);
  return labels.length > 0 && labels.every((label) => PROJECT_SOURCE_LABELS.has(label));
};

const normalizeAssistantText = (value) => String(value || '')
  .replace(/\r\n?/g, '\n')
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .trim();

const stripAssistantSpeechPrefix = (value) => normalizeAssistantText(value)
  .replace(/^(?:ChatGPT\s*(?:đã nói|said)|Assistant)\s*[:：]\s*/i, '')
  .trim();

// ChatGPT Projects can expose the generated-message title next to the markdown
// body. The browser text extractor may concatenate both, so remove the title
// before it becomes a Facebook caption. This is intentionally limited to the
// beginning of a Reels/TikTok response; normal prose mentioning the phrase stays.
const stripReelsCaptionHeading = (value) => {
  const normalized = normalizeAssistantText(value);
  if (!/^Caption\s+Reels?\s*\/\s*TikTok\b/i.test(normalized)) return normalized;

  let body = normalized.replace(/^Caption\s+Reels?\s*\/\s*TikTok\b\s*/i, '').trimStart();
  // The common project title is "I&W Carnival <SKU>". Match the SKU shape so
  // concatenated extraction such as "...525G-D2MUỐN ..." is also repaired.
  body = body.replace(/^I&W\s+Carnival(?:\s+\d+[A-Z](?:-[A-Z]\d+)?)?\s*(?=[:：\n]|[A-ZÀ-ỸĐ][A-ZÀ-ỸĐ0-9]|$)/i, '');
  // If the title was separated by a newline and used another product wording,
  // discard only that first heading line, never the generated caption body.
  if (body.includes('\n')) {
    const [first, ...rest] = body.split('\n');
    if (/^(?:I&W\s+Carnival|Reels?\s+caption|TikTok\s+caption)\b/i.test(first.trim())) {
      body = rest.join('\n');
    }
  }
  return body.replace(/^[\s:：-]+/, '').trim();
};

const foldForStatusMatch = (value) => stripAssistantSpeechPrefix(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/\s+/g, ' ')
  .replace(/[.。…]+$/g, '')
  .trim();

const TRANSIENT_CHATGPT_STATUS_TEXTS = [
  'dang tim kiem ngu canh du an',
  'searching project context',
  'dang suy luan',
  'thinking',
  'da ngung suy luan',
  'stopped reasoning',
];

export const isTransientChatGPTAssistantText = (value) => {
  const normalized = foldForStatusMatch(value);
  if (!normalized) return true;

  return TRANSIENT_CHATGPT_STATUS_TEXTS.some((status) => (
    normalized === status || normalized.startsWith(`${status} `)
  ));
};

/**
 * Loại các nhãn nguồn của ChatGPT Project khỏi caption trước khi đăng.
 * Chỉ xóa dòng đứng riêng hoàn toàn là tên nguồn; nội dung bình thường có nhắc
 * đến các từ này vẫn được giữ nguyên.
 */
export const sanitizeGeneratedSocialContent = (value) => {
  if (value === null || value === undefined) return value;

  const withoutAssistantPrefix = stripAssistantSpeechPrefix(value);
  const withoutReelsHeading = stripReelsCaptionHeading(withoutAssistantPrefix);
  if (isTransientChatGPTAssistantText(withoutReelsHeading)) return '';

  return withoutReelsHeading
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !isProjectSourceOnlyLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
