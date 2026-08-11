import assert from 'node:assert/strict';
import {
  CONTENT_TONES,
  buildPerformanceMultipliers,
  buildToneCandidates,
  getToneInstructionText,
  selectContentTone
} from './content-tone.service.js';

assert.equal(CONTENT_TONES.length, 8, 'Tone Engine phải có đúng 8 phong cách');
assert.equal(new Set(CONTENT_TONES.map(tone => tone.id)).size, 8, 'Mã tone không được trùng');

const first = selectContentTone({}, { random: () => 0 });
const next = selectContentTone({}, { recentSelections: [first], random: () => 0 });
assert.notEqual(next.toneId, first.toneId, 'Không được lặp lại tone vừa dùng');

const maleCandidates = buildToneCandidates({ genderLabel: 'Nam (Male)' });
assert.equal(maleCandidates.find(tone => tone.id === 'TONE-07').weight < 2, true, 'Tone nữ phải giảm mạnh với sản phẩm nam');

const giftCandidates = buildToneCandidates({ productInfoText: 'Món quà kỷ niệm dành cho bố' });
const neutralCandidates = buildToneCandidates({ productInfoText: 'Đồng hồ đeo hằng ngày' });
assert.equal(
  giftCandidates.find(tone => tone.id === 'TONE-06').weight > neutralCandidates.find(tone => tone.id === 'TONE-06').weight,
  true,
  'Ngữ cảnh quà tặng phải tăng trọng số TONE-06'
);

const instruction = getToneInstructionText('TONE-08', 'Góc nhìn stylist', 'Xem thêm bộ sưu tập.');
assert.match(instruction, /1–3 emoji/u);
assert.doesNotMatch(instruction, /4-6 emoji|4–6 emoji/u);
assert.match(instruction, /Phối Đồ Có Gu/u);

assert.deepEqual(
  buildPerformanceMultipliers(CONTENT_TONES.slice(0, 3).map(tone => ({ toneId: tone.id, posts: 20, averageScore: 10 }))),
  {},
  'Không được tự tối ưu khi chưa đủ độ phủ dữ liệu'
);
const adaptive = buildPerformanceMultipliers(CONTENT_TONES.slice(0, 4).map((tone, index) => ({
  toneId: tone.id,
  posts: 8,
  averageScore: 10 + index * 5
})));
assert.equal(Object.keys(adaptive).length, 4);
assert.equal(adaptive['TONE-04'].multiplier > adaptive['TONE-01'].multiplier, true);

console.log('✅ Content Tone Engine tests passed');
