import test from 'node:test';
import assert from 'node:assert/strict';
import { splitFbIgContent, containsPromptEcho, validateSocialPostContent } from './content-validator.js';

test('splitFbIgContent tách đúng format ## FACEBOOK / ## INSTAGRAM', () => {
    const text = '## FACEBOOK:\nĐỒNG HỒ ĐẲNG CẤP CHO PHÁI MẠNH — nội dung bài Facebook.\n#iwcarnivalvietnam\n## INSTAGRAM:\nChất riêng trên cổ tay bạn.\n#iwcarnival';
    const { fb, ig } = splitFbIgContent(text);
    assert.ok(fb.includes('ĐỒNG HỒ ĐẲNG CẤP'));
    assert.ok(!fb.includes('INSTAGRAM'));
    assert.ok(ig.includes('Chất riêng'));
    assert.ok(!ig.includes('FACEBOOK'));
});

test('splitFbIgContent tách đúng format FACEBOOK: / INSTAGRAM: (template)', () => {
    const text = 'FACEBOOK:\nBài FB với câu mở đầu viết hoa.\n#iwcarnivalvietnam\nINSTAGRAM:\nCaption ngắn cho IG.\n#iwcarnival';
    const { fb, ig } = splitFbIgContent(text);
    assert.equal(fb, 'Bài FB với câu mở đầu viết hoa.\n#iwcarnivalvietnam');
    assert.equal(ig, 'Caption ngắn cho IG.\n#iwcarnival');
});

test('splitFbIgContent chỉ có marker FACEBOOK thì IG rỗng', () => {
    const { fb, ig } = splitFbIgContent('Mở đầu\nFACEBOOK:\nNội dung FB duy nhất.');
    assert.equal(fb, 'Nội dung FB duy nhất.');
    assert.equal(ig, '');
});

test('splitFbIgContent không có marker thì trả cả bài vào fb', () => {
    const { fb, ig } = splitFbIgContent('Chỉ một đoạn nội dung không có tiêu đề.');
    assert.equal(fb, 'Chỉ một đoạn nội dung không có tiêu đề.');
    assert.equal(ig, '');
});

test('containsPromptEcho phát hiện trả về nguyên prompt', () => {
    const prompt = 'Hãy viết 2 bài theo đúng format gồm FACEBOOK và INSTAGRAM cho sản phẩm đồng hồ SKU ABC. Không kèm giải thích.';
    assert.equal(containsPromptEcho(prompt, prompt), true);
    assert.equal(containsPromptEcho('Mở đầu: ' + prompt, prompt), true);
});

test('containsPromptEcho phát hiện phần lớn prompt bị lặp', () => {
    const prompt = 'Bạn là chuyên gia content marketing cho thương hiệu đồng hồ I&W Carnival Việt Nam. Viết bài quảng cáo cho đồng hồ nam cao cấp với tông giọng sang trọng.';
    const echoed = prompt.slice(0, 120) + ' và phần còn lại là nội dung thật.';
    assert.equal(containsPromptEcho(echoed, prompt), true);
});

test('containsPromptEcho không gắn cờ nội dung bình thường', () => {
    const prompt = 'Hãy viết 2 bài theo đúng format gồm FACEBOOK và INSTAGRAM cho sản phẩm đồng hồ SKU ABC. Không kèm giải thích.';
    assert.equal(containsPromptEcho('ĐỒNG HỒ MỚI VỀ — thiết kế sang trọng, bộ máy bền bỉ cho phái mạnh. #iwcarnivalvietnam', prompt), false);
});

test('validateSocialPostContent chấp nhận nội dung đạt chuẩn', () => {
    const content = 'ĐỒNG HỒ CƠ KHÍ ĐẲNG CẤP — thiết kế tinh xảo, bộ máy bền bỉ dành cho phái mạnh hiện đại.\n\nGhé I&W Carnival để chọn cho mình một chiếc thật ưng ý nhé!\n\n#iwcarnivalvietnam #iwcarnival #donghoiwcarnival';
    assert.deepEqual(validateSocialPostContent(content, { platform: 'fb' }), { ok: true, reason: null });
});

test('validateSocialPostContent từ chối nội dung quá ngắn', () => {
    const res = validateSocialPostContent('OK', { platform: 'fb' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'too-short-or-empty');
});

test('validateSocialPostContent từ chối IG quá dài', () => {
    const res = validateSocialPostContent('a'.repeat(2500), { platform: 'ig' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'too-long');
});

test('validateSocialPostContent từ chối nội dung lấy nhầm prompt', () => {
    const prompt = 'Hãy viết 2 bài theo đúng format gồm FACEBOOK và INSTAGRAM cho sản phẩm đồng hồ SKU ABC. Không kèm giải thích.';
    const res = validateSocialPostContent(prompt, { platform: 'fb', prompt });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'prompt-echo');
});

test('validateSocialPostContent từ chối nội dung còn placeholder template', () => {
    const res = validateSocialPostContent('FACEBOOK:\n[Viết bài Facebook tại đây]', { platform: 'fb' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'template-instruction');
});

test('validateSocialPostContent từ chối IG quá 30 hashtag', () => {
    const hashtags = ['#iwcarnivalvietnam', '#iwcarnival', ...Array.from({ length: 29 }, (_, i) => `#tag${i}`)].join(' ');
    const res = validateSocialPostContent(`Chiếc đồng hồ đẹp nhất hôm nay. ${hashtags}`, { platform: 'ig' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'too-many-hashtags');
});

test('validateSocialPostContent từ chối từ ngữ bị cấm', () => {
    const content = 'ĐỒNG HỒ CỰC ĐẸP — sale sốc giảm giá hôm nay, mua ngay kẻo lỡ! #iwcarnivalvietnam #iwcarnival';
    const res = validateSocialPostContent(content, { platform: 'fb' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'banned-phrase');
});

test('validateSocialPostContent từ chối hashtag có dấu tiếng Việt', () => {
    const content = 'ĐỒNG HỒ SANG TRỌNG cho phái mạnh. #iwcarnivalvietnam #đồnghồnam';
    const res = validateSocialPostContent(content, { platform: 'fb' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'diacritic-hashtag');
});

test('validateSocialPostContent từ chối thiếu hashtag thương hiệu', () => {
    const content = 'ĐỒNG HỒ MỚI VỀ — thiết kế sang trọng, bộ máy bền bỉ dành cho phái mạnh. #dongho #dothegioi';
    const res = validateSocialPostContent(content, { platform: 'fb' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'missing-brand-hashtag');
});

test('validateSocialPostContent chấp nhận khi đủ 2 hashtag thương hiệu', () => {
    const content = 'ĐỒNG HỒ MỚI VỀ — thiết kế sang trọng, bộ máy bền bỉ dành cho phái mạnh hiện đại. #iwcarnivalvietnam #iwcarnival';
    assert.deepEqual(validateSocialPostContent(content, { platform: 'fb' }), { ok: true, reason: null });
});
