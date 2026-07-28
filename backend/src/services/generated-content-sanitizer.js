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

/**
 * Loại các nhãn nguồn của ChatGPT Project khỏi caption trước khi đăng.
 * Chỉ xóa dòng đứng riêng hoàn toàn là tên nguồn; nội dung bình thường có nhắc
 * đến các từ này vẫn được giữ nguyên.
 */
export const sanitizeGeneratedSocialContent = (value) => {
  if (value === null || value === undefined) return value;

  return String(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !isProjectSourceOnlyLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

