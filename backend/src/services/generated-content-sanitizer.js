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
  if (isTransientChatGPTAssistantText(withoutAssistantPrefix)) return '';

  return withoutAssistantPrefix
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !isProjectSourceOnlyLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
