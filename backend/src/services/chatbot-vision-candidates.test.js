import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getVisionCatalogCandidates,
  getHashFamilyVisionCandidates
} from './chatbot.service.js';

test('hash family hints keep the matching 751G white steel variant in visual verification', () => {
  const visionAnalysis = {
    text_in_image: 'I&W Carnival AUTOMATIC FRI 10',
    brand: 'I&W Carnival',
    brand_confidence: 0.99,
    brand_evidence: 'Logo I&W Carnival is visible on the dial',
    model_code: null,
    description:
      'Đồng hồ nam mặt trắng bạc, vành đa giác, cọc số La Mã xen đá, dây thép bạc và lịch thứ ngày ở vị trí 3 giờ.'
  };
  const hashHints = [
    '55883G-T1',
    '751G-T2',
    '751G-T16',
    '550G-T3',
    '593L-D2'
  ];

  const catalogCandidates = getVisionCatalogCandidates(
    visionAnalysis,
    null,
    hashHints
  );
  const visualCandidates = getHashFamilyVisionCandidates(
    catalogCandidates,
    hashHints
  );

  assert.ok(
    visualCandidates.includes('751G-T1'),
    `Expected 751G-T1 in visual candidates, received: ${visualCandidates.join(', ')}`
  );
});

test('real-world Nautilus photo ranks the matching angular black steel family first', () => {
  const visionAnalysis = {
    text_in_image: 'I&W Carnival AUTOMATIC',
    brand: 'I&W Carnival',
    brand_confidence: 1,
    brand_evidence: 'Logo I&W Carnival is visible on the dial',
    model_code: 'Nautilus Black Dial',
    description:
      'Đồng hồ nam mặt đen, vỏ bo vuông màu bạc, dây thép, ba kim và lịch ngày ở vị trí 3 giờ.',
    visual_features: {
      case_shape: 'other',
      dial_color: 'black',
      strap_type: 'steel',
      dial_layout: 'three hand date',
      index_style: 'baton',
      date_position: '3',
      bezel_style: 'plain',
      distinctive_features: [
        'integrated bracelet',
        'vành bezel hình bát giác bo tròn'
      ]
    }
  };

  const candidates = getVisionCatalogCandidates(visionAnalysis)
    .slice(0, 5)
    .map(candidate => candidate.sku);

  assert.ok(candidates.includes('750G1-T5'));
  assert.ok(!candidates.includes('3002L-D1'));
});
