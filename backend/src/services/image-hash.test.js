import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  computeHashFromBuffer,
  getHighConfidenceHashMatch,
  getHammingDistance
} from './image-hash.service.js';

const makeWatchLikeImage = async ({
  dial = '#f3f3f3',
  accent = '#111111',
  shift = 0
} = {}) => {
  const svg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
      <rect width="256" height="256" fill="#ffffff"/>
      <rect x="${108 + shift}" y="5" width="40" height="246" rx="12" fill="#b7b7b7"/>
      <circle cx="${128 + shift}" cy="128" r="67" fill="${dial}" stroke="#777777" stroke-width="12"/>
      <circle cx="${128 + shift}" cy="128" r="48" fill="none" stroke="${accent}" stroke-width="4"/>
      <line x1="${128 + shift}" y1="128" x2="${128 + shift}" y2="88" stroke="${accent}" stroke-width="5"/>
      <line x1="${128 + shift}" y1="128" x2="${162 + shift}" y2="145" stroke="${accent}" stroke-width="5"/>
      <circle cx="${128 + shift}" cy="128" r="7" fill="${accent}"/>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};

test('image signature uses 512 detail bits and remains stable for the same image', async () => {
  const image = await makeWatchLikeImage();
  const first = await computeHashFromBuffer(image);
  const second = await computeHashFromBuffer(image);

  assert.equal(first.length, 512);
  assert.match(first, /^[01]+$/);
  assert.equal(getHammingDistance(first, second), 0);
});

test('image signature ranks a small variation closer than another watch layout', async () => {
  const original = await computeHashFromBuffer(await makeWatchLikeImage());
  const smallVariation = await computeHashFromBuffer(
    await makeWatchLikeImage({ shift: 2 })
  );
  const differentLayout = await computeHashFromBuffer(
    await makeWatchLikeImage({ dial: '#151515', accent: '#f5f5f5', shift: 22 })
  );

  assert.ok(
    getHammingDistance(original, smallVariation)
      < getHammingDistance(original, differentLayout)
  );
});

test('avatar fast path requires both a close signature and a clear runner-up gap', () => {
  assert.equal(
    getHighConfidenceHashMatch([
      { sku: '55886G1-T1', distance: 9 },
      { sku: '55886G1-T4', distance: 21 }
    ]),
    '55886G1-T1'
  );
  assert.equal(
    getHighConfidenceHashMatch([
      { sku: '55886G1-T1', distance: 9 },
      { sku: '55886G1-T4', distance: 14 }
    ]),
    null
  );
  assert.equal(
    getHighConfidenceHashMatch([
      { sku: 'OTHER-T1', distance: 18 },
      { sku: 'OTHER-T2', distance: 40 }
    ]),
    null
  );
});
