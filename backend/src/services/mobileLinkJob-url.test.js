import assert from 'node:assert/strict';
import test from 'node:test';

import {
  facebookUrlReferencesPostId,
  fallbackFacebookPostUrl,
  normalizeFacebookPostUrl,
} from './mobileLinkJob.service.js';

const REEL_ID = '1498447018965401';
const COMPOSITE_REEL_ID = `101788945134600_${REEL_ID}`;

test('keeps the official permalink for the exact Reel object', () => {
  const permalink = `https://www.facebook.com/reel/${REEL_ID}/?mibextid=test`;

  assert.equal(
    normalizeFacebookPostUrl(permalink, REEL_ID, { contentType: 'reel' }),
    permalink,
  );
});

test('normalizes a relative exact Reel permalink to HTTPS', () => {
  assert.equal(
    normalizeFacebookPostUrl(`/reel/${REEL_ID}/`, REEL_ID, { contentType: 'reel' }),
    `https://www.facebook.com/reel/${REEL_ID}/`,
  );
});

test('rejects a Reel permalink that points at a different object', () => {
  assert.equal(
    normalizeFacebookPostUrl(
      'https://www.facebook.com/reel/9999999999999999/',
      COMPOSITE_REEL_ID,
      { contentType: 'reel' },
    ),
    fallbackFacebookPostUrl(COMPOSITE_REEL_ID, 'reel'),
  );
});

test('does not accept a generic Page Reels route as exact identity proof', () => {
  const genericPageUrl = 'https://www.facebook.com/101788945134600/reels/';

  assert.equal(facebookUrlReferencesPostId(genericPageUrl, COMPOSITE_REEL_ID), false);
  assert.equal(
    normalizeFacebookPostUrl(genericPageUrl, COMPOSITE_REEL_ID, { contentType: 'reel' }),
    fallbackFacebookPostUrl(COMPOSITE_REEL_ID, 'reel'),
  );
});
