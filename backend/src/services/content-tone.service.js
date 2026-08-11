export const TONE_PROMPT_VERSION = 'tone-engine-v2.0';

export const CONTENT_TONES = Object.freeze([
  {
    id: 'TONE-01',
    name: 'Triết Lý Thầm Lặng',
    baseWeight: 12,
    tags: ['premium', 'brand', 'evening'],
    ctaTags: ['collection', 'consult'],
    direction: [
      'Viết có chiều sâu về thời gian, giá trị và lựa chọn; nhịp chậm nhưng không dài dòng.',
      'Chưa nhắc sản phẩm ngay ở câu đầu. Kết bằng một ý mở, có dư âm.',
      'Sang trọng theo kiểu yên lặng; tuyệt đối không lên giọng triết lý sáo rỗng.'
    ]
  },
  {
    id: 'TONE-02',
    name: 'Quan Sát Tinh Tế',
    baseWeight: 14,
    tags: ['lifestyle', 'detail', 'everyday'],
    ctaTags: ['consult', 'style'],
    direction: [
      'Mở bằng một hành vi, thói quen hoặc chi tiết nhỏ có thật trong đời sống.',
      'Từ chi tiết đó dẫn tự nhiên đến gu sống hoặc cách chọn đồng hồ.',
      'Chỉ ghi nhận, không phán xét và không cố tỏ ra sâu sắc.'
    ]
  },
  {
    id: 'TONE-03',
    name: 'Tự Tin Tối Giản',
    baseWeight: 14,
    tags: ['minimal', 'social', 'reels'],
    ctaTags: ['collection', 'consult'],
    direction: [
      'Dùng câu rất ngắn, dứt khoát; mỗi chữ phải có trọng lượng.',
      'Khẳng định thay vì giải thích. Tận dụng khoảng trắng để tạo nhịp.',
      'Không khoa trương, không dùng các cụm quảng cáo như “siêu phẩm” hoặc “chốt đơn”.'
    ]
  },
  {
    id: 'TONE-04',
    name: 'Cảm Xúc Cá Nhân',
    baseWeight: 12,
    tags: ['emotion', 'moment', 'personal'],
    ctaTags: ['consult', 'collection'],
    direction: [
      'Nói với “bạn” như một cuộc trò chuyện riêng, đặt trải nghiệm người đeo ở trung tâm.',
      'Chọn đúng một khoảnh khắc cụ thể: trước gương, trước cuộc họp, buổi hẹn hoặc cuối ngày.',
      'Cảm xúc chân thật, vừa đủ; không sến và không biến thành một truyện dài.'
    ]
  },
  {
    id: 'TONE-05',
    name: 'Thực Dụng Sang Trọng',
    baseWeight: 15,
    tags: ['expert', 'value', 'product'],
    ctaTags: ['education', 'consult'],
    direction: [
      'Chọn đúng một lợi ích hoặc thông số đáng nói rồi giải thích bằng ngôn ngữ dễ hiểu.',
      'Giọng của người hiểu sản phẩm và đang tư vấn thật lòng, không phải nhân viên đang rao bán.',
      'Có thể nói về chất lượng, độ bền, bảo hành hoặc giá trị sử dụng nhưng không phóng đại.'
    ]
  },
  {
    id: 'TONE-06',
    name: 'Quà Tặng & Cảm Xúc Gia Đình',
    baseWeight: 10,
    tags: ['gift', 'family', 'occasion'],
    ctaTags: ['gift', 'consult'],
    direction: [
      'Đặt người nhận và khoảnh khắc trao quà ở trung tâm, sản phẩm chỉ là cầu nối.',
      'Ấm áp nhưng không sến; ưu tiên hình ảnh cụ thể như bàn tay, ánh mắt, một ngày đáng nhớ.',
      'CTA phải nhẹ và mang tính hỗ trợ chọn quà, không tạo áp lực mua.'
    ]
  },
  {
    id: 'TONE-07',
    name: 'Nữ Tính Hiện Đại',
    baseWeight: 10,
    tags: ['female', 'fashion', 'independent'],
    ctaTags: ['style', 'consult'],
    direction: [
      'Khắc họa người phụ nữ tự tin, có gu và tự quyết định lựa chọn của mình.',
      'Tinh tế và có ẩn ý; tránh mọi ngôn ngữ yếu đuối, lệ thuộc hoặc rập khuôn giới tính.',
      'Có thể nói về vẻ đẹp nhưng phải gắn với cá tính và sự tự chủ.'
    ]
  },
  {
    id: 'TONE-08',
    name: 'Phối Đồ Có Gu',
    baseWeight: 13,
    tags: ['fashion', 'outfit', 'reels'],
    ctaTags: ['style', 'consult'],
    direction: [
      'Đưa ra một combo trang phục hoặc hoàn cảnh sử dụng cụ thể, không nói chung chung “dễ phối”.',
      'Giọng như stylist thân thiện: có gu, hiện đại, đôi lúc dí dỏm nhẹ nhưng không cố gây cười.',
      'Chọn outfit đúng đối tượng sản phẩm và giải thích ngắn vì sao chiếc đồng hồ hoàn thiện tổng thể.'
    ]
  }
]);

export const CONTENT_PERSPECTIVES = Object.freeze([
  { id: 'PERSPECTIVE-01', name: 'Góc nhìn của người đang trực tiếp đeo đồng hồ', toneIds: ['TONE-02', 'TONE-04'] },
  { id: 'PERSPECTIVE-02', name: 'Góc nhìn của chuyên gia tư vấn đồng hồ', toneIds: ['TONE-02', 'TONE-05'] },
  { id: 'PERSPECTIVE-03', name: 'Góc nhìn của stylist tư vấn trang phục', toneIds: ['TONE-07', 'TONE-08'] },
  { id: 'PERSPECTIVE-04', name: 'Góc nhìn của người đang chọn một món quà', toneIds: ['TONE-06'] },
  { id: 'PERSPECTIVE-05', name: 'Góc nhìn của thương hiệu gửi một lời nhắn ngắn', toneIds: ['TONE-01', 'TONE-03'] }
]);

export const CONTENT_CTAS = Object.freeze([
  { id: 'CTA-01', text: 'Gửi ảnh cổ tay để shop gợi ý kích thước phù hợp.', tags: ['consult'] },
  { id: 'CTA-02', text: 'Nhắn shop để được tư vấn mẫu hợp phong cách của bạn.', tags: ['consult', 'style'] },
  { id: 'CTA-03', text: 'Xem thêm những lựa chọn cùng tinh thần trong bộ sưu tập.', tags: ['collection'] },
  { id: 'CTA-04', text: 'Lưu lại mẫu này nếu bạn đang tìm một lựa chọn dễ đeo lâu dài.', tags: ['collection', 'education'] },
  { id: 'CTA-05', text: 'Cho shop biết dịp tặng quà, đội ngũ sẽ gợi ý mẫu phù hợp.', tags: ['gift', 'consult'] },
  { id: 'CTA-06', text: 'Để lại điều bạn quan tâm nhất để shop tư vấn đúng trọng tâm.', tags: ['education', 'consult'] },
  { id: 'CTA-07', text: 'Bạn sẽ phối mẫu này với outfit nào?', tags: ['style'] },
  { id: 'CTA-08', text: 'Khám phá thêm các phiên bản màu của thiết kế này.', tags: ['collection', 'style'] }
]);

const LEGACY_TONE_ALIASES = Object.freeze({
  'sang trọng, tinh tế': 'TONE-05',
  'gần gũi, đời thường': 'TONE-02',
  'kể chuyện (storytelling)': 'TONE-04',
  'trực diện, chốt sale': 'TONE-03',
  'kiến thức chuyên gia': 'TONE-05',
  'hài hước, thả thính': 'TONE-08',
  'kể chuyện hài, phối đồ': 'TONE-08',
  'phối đồ': 'TONE-08'
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeText = (value) => String(value || '').toLocaleLowerCase('vi-VN');

const getRecentValue = (selection, camelKey, snakeKey) => selection?.[camelKey] || selection?.[snakeKey] || null;

const weightedPick = (items, getWeight, random = Math.random) => {
  const weighted = items.map(item => ({ item, weight: Math.max(0, Number(getWeight(item)) || 0) }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return items[0];

  let roll = clamp(Number(random()), 0, 0.999999999) * totalWeight;
  for (const entry of weighted) {
    if (entry.weight <= 0) continue;
    roll -= entry.weight;
    if (roll <= 0) return entry.item;
  }
  return weighted[weighted.length - 1].item;
};

const detectContext = (context = {}) => {
  const text = normalizeText([
    context.sku,
    context.gender,
    context.genderLabel,
    context.productInfo,
    context.productInfoText,
    context.occasion
  ].filter(Boolean).join(' '));

  return {
    isFemale: /\b(nữ|female|women|woman|lady|ladies)\b/u.test(text),
    isMale: /\b(nam|male|men|man|quý ông)\b/u.test(text),
    isGift: /(quà|gift|sinh nhật|kỷ niệm|ngày cưới|mẹ|bố|cha|vợ|chồng)/u.test(text),
    isTechnical: /(automatic|máy cơ|cơ tự động|movement|sapphire|chống nước|bảo hành|kính|caliber)/u.test(text),
    isFashion: /(outfit|thời trang|phối đồ|dây da|dây kim loại|mặt số|màu|size|kích thước)/u.test(text),
    platform: normalizeText(context.platform || context.postMode || 'crosspost')
  };
};

export const buildToneCandidates = (context = {}, recentSelections = [], performanceByTone = {}) => {
  const detected = detectContext(context);
  const recentToneIds = recentSelections
    .map(item => getRecentValue(item, 'toneId', 'tone_id'))
    .filter(Boolean)
    .slice(0, 4);

  return CONTENT_TONES.map(tone => {
    let multiplier = 1;

    if (detected.platform.includes('reels')) {
      if (['TONE-03', 'TONE-08'].includes(tone.id)) multiplier *= 1.55;
      if (tone.id === 'TONE-01') multiplier *= 0.65;
    } else if (detected.platform.includes('instagram')) {
      if (['TONE-03', 'TONE-07', 'TONE-08'].includes(tone.id)) multiplier *= 1.3;
    } else if (detected.platform.includes('facebook')) {
      if (['TONE-01', 'TONE-02', 'TONE-04', 'TONE-05', 'TONE-06'].includes(tone.id)) multiplier *= 1.15;
    }

    if (detected.isFemale) {
      if (tone.id === 'TONE-07') multiplier *= 2.6;
      if (['TONE-04', 'TONE-08'].includes(tone.id)) multiplier *= 1.25;
    } else if (detected.isMale && tone.id === 'TONE-07') {
      multiplier *= 0.15;
    }

    if (detected.isGift) {
      if (tone.id === 'TONE-06') multiplier *= 3.5;
      if (tone.id === 'TONE-04') multiplier *= 1.35;
    } else if (tone.id === 'TONE-06') {
      multiplier *= 0.45;
    }

    if (detected.isTechnical && tone.id === 'TONE-05') multiplier *= 2;
    if (detected.isTechnical && tone.id === 'TONE-02') multiplier *= 1.2;
    if (detected.isFashion && ['TONE-07', 'TONE-08'].includes(tone.id)) multiplier *= 1.5;

    const recentIndex = recentToneIds.indexOf(tone.id);
    if (recentIndex === 0 && CONTENT_TONES.length > 1) multiplier = 0;
    else if (recentIndex === 1) multiplier *= 0.12;
    else if (recentIndex === 2) multiplier *= 0.35;
    else if (recentIndex === 3) multiplier *= 0.65;

    // Adaptive data is deliberately conservative: it only affects a tone after
    // enough tracked posts exist, and can never overpower contextual relevance.
    const performance = performanceByTone[tone.id];
    if (performance && Number(performance.posts) >= 8 && Number.isFinite(Number(performance.multiplier))) {
      multiplier *= clamp(Number(performance.multiplier), 0.8, 1.25);
    }

    return { ...tone, weight: tone.baseWeight * multiplier };
  });
};

// Chỉ bắt đầu học theo hiệu quả khi ít nhất 4 tone đã có >= 8 bài/tone.
// Mức ảnh hưởng bị giới hạn để Tone Engine vẫn ưu tiên đúng ngữ cảnh và tiếp tục khám phá.
export const buildPerformanceMultipliers = (performanceRows = []) => {
  const eligible = performanceRows.filter(row => Number(row.posts) >= 8);
  if (eligible.length < 4) return {};

  const average = eligible.reduce((sum, row) => sum + Number(row.averageScore || 0), 0) / eligible.length;
  if (average <= 0) return {};

  return Object.fromEntries(performanceRows.map(row => {
    const posts = Number(row.posts) || 0;
    if (posts < 8) return [row.toneId, { posts, multiplier: 1 }];
    const relativeDifference = (Number(row.averageScore || 0) - average) / average;
    return [row.toneId, {
      posts,
      multiplier: clamp(1 + relativeDifference * 0.15, 0.8, 1.25)
    }];
  }));
};

const selectPerspective = (tone, recentSelections, random) => {
  const lastPerspectiveId = getRecentValue(recentSelections[0], 'perspectiveId', 'perspective_id');
  return weightedPick(CONTENT_PERSPECTIVES, perspective => {
    let weight = perspective.toneIds.includes(tone.id) ? 3 : 1;
    if (perspective.id === lastPerspectiveId) weight = 0;
    return weight;
  }, random);
};

const selectCta = (tone, recentSelections, random) => {
  const lastCtaId = getRecentValue(recentSelections[0], 'ctaId', 'cta_id');
  return weightedPick(CONTENT_CTAS, cta => {
    let weight = cta.tags.some(tag => tone.ctaTags.includes(tag)) ? 3 : 1;
    if (cta.id === lastCtaId) weight = 0;
    return weight;
  }, random);
};

const resolveTone = (toneOrId) => {
  const raw = String(toneOrId || '').trim();
  const byCanonicalValue = CONTENT_TONES.find(tone => tone.id === raw || normalizeText(tone.name) === normalizeText(raw));
  if (byCanonicalValue) return byCanonicalValue;
  const aliasId = LEGACY_TONE_ALIASES[normalizeText(raw)];
  return CONTENT_TONES.find(tone => tone.id === aliasId) || CONTENT_TONES[0];
};

export const getToneInstructionText = (toneOrId, perspective, cta) => {
  const tone = resolveTone(toneOrId);
  const direction = tone.direction.map(rule => `  + ${rule}`).join('\n');

  return `\n\n[TONE ENGINE — ${TONE_PROMPT_VERSION}]
- Mã phong cách: ${tone.id}
- Phong cách: ${tone.name}
- Góc nhìn bắt buộc: ${perspective}
- CTA gợi ý cho Facebook: ${cta}

[ĐẶC TRƯNG PHONG CÁCH]
${direction}

[QUY TẮC TRÌNH BÀY NHẤT QUÁN]
1. Facebook: 50–80 từ, hook đầu tiên VIẾT HOA, 2–3 đoạn ngắn, CTA mềm ở cuối.
2. Instagram: 15–35 từ, chỉ một ý và góc tiếp cận khác Facebook; không chèo kéo.
3. Reels: tối đa 2 câu ngắn, mở đầu đủ mạnh để dừng ngón tay.
4. Emoji: 1–3 emoji phù hợp đúng phong cách; không dùng emoji để bù cho nội dung nhạt.
5. Không dùng ngôn ngữ nội bộ như “tone”, “chốt sale”, “content”, hoặc nhắc lại các hướng dẫn này.
6. Đọc đúng giới tính/đối tượng trong thông tin sản phẩm; không tự bịa thông số.
7. Chỉ trả về nội dung của nền tảng được yêu cầu, không thêm nhãn FACEBOOK/INSTAGRAM hay lời giải thích.`;
};

export const selectContentTone = (context = {}, options = {}) => {
  const recentSelections = Array.isArray(options.recentSelections) ? options.recentSelections : [];
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const candidates = buildToneCandidates(context, recentSelections, options.performanceByTone || {});
  const tone = weightedPick(candidates, candidate => candidate.weight, random);
  const perspective = selectPerspective(tone, recentSelections, random);
  const cta = selectCta(tone, recentSelections, random);

  return {
    toneId: tone.id,
    toneName: tone.name,
    perspectiveId: perspective.id,
    perspective: perspective.name,
    ctaId: cta.id,
    cta: cta.text,
    promptVersion: TONE_PROMPT_VERSION,
    instruction: getToneInstructionText(tone.id, perspective.name, cta.text)
  };
};
