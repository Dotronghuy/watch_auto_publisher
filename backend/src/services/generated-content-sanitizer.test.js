import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTransientChatGPTAssistantText,
  sanitizeGeneratedSocialContent,
} from './generated-content-sanitizer.js';

test('removes ChatGPT Project source chips from a generated caption', () => {
  const input = [
    'TRAO NÀNG MỘT MÓN QUÀ XỨNG VỚI KHÍ CHẤT ✨',
    '',
    '#iwcarnival #quatangphidep',
    'customer-persona',
    'watch-marketing-content',
  ].join('\n');

  assert.equal(
    sanitizeGeneratedSocialContent(input),
    [
      'TRAO NÀNG MỘT MÓN QUÀ XỨNG VỚI KHÍ CHẤT ✨',
      '',
      '#iwcarnival #quatangphidep',
    ].join('\n'),
  );
});

test('removes markdown filenames and multiple source labels on one line', () => {
  assert.equal(
    sanitizeGeneratedSocialContent('Nội dung bài viết\n\ncustomer-persona.md watch-marketing-content.md'),
    'Nội dung bài viết',
  );
});

test('keeps normal prose that merely mentions a source name', () => {
  const input = 'Không đưa nhãn customer-persona vào phần cuối bài viết.';
  assert.equal(sanitizeGeneratedSocialContent(input), input);
});

test('drops transient ChatGPT Project context status', () => {
  const input = 'ChatGPT đã nói:Đang tìm kiếm ngữ cảnh dự án';

  assert.equal(isTransientChatGPTAssistantText(input), true);
  assert.equal(sanitizeGeneratedSocialContent(input), '');
});

test('removes ChatGPT screen-reader prefix from final caption', () => {
  assert.equal(
    sanitizeGeneratedSocialContent('ChatGPT đã nói:Anh không cần thả thính — cứ để mặt xanh lên tiếng.'),
    'Anh không cần thả thính — cứ để mặt xanh lên tiếng.',
  );
});
