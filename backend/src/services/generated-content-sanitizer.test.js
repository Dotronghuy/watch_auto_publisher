import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeGeneratedSocialContent } from './generated-content-sanitizer.js';

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

