import assert from 'node:assert/strict';
import test from 'node:test';

import {
  facebookUrlReferencesPostId,
  fallbackFacebookPostUrl,
  normalizeFacebookPostUrl,
} from './mobileLinkJob.service.js';

const REEL_ID = '1498447018965401';
const COMPOSITE_REEL_ID = `101788945134600_${REEL_ID}`;

test('tracking parameters cannot prove the identity of another video', () => {
  assert.equal(facebookUrlReferencesPostId(
    `https://www.facebook.com/reel/999/?tracking=${REEL_ID}`, COMPOSITE_REEL_ID,
  ), false);
});

test('a regular post cannot keep a different post, Page homepage or Reel URL', () => {
  for (const url of [
    'https://www.facebook.com/999/posts/888',
    'https://www.facebook.com/profile.php?id=101',
    'https://www.facebook.com/reel/202',
    'https://www.facebook.com/permalink.php?story_fbid=202&id=999',
    'https://www.facebook.com/999/posts/pfbidAbCd',
  ]) {
    assert.equal(normalizeFacebookPostUrl(url, '101_202'),
      fallbackFacebookPostUrl('101_202'), url);
  }
});

test('exact regular post permalinks remain intact', () => {
  for (const url of [
    'https://www.facebook.com/101/posts/202',
    'https://www.facebook.com/permalink.php?story_fbid=202&id=101',
    'https://www.facebook.com/101/posts/pfbidAbCd',
  ]) assert.equal(normalizeFacebookPostUrl(url, '101_202'), url);
});

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

test('duplicate identity query fields cannot change the resolved object or owner', () => {
  for (const [type, url] of [
    ['post', 'https://www.facebook.com/permalink.php?story_fbid=202&id=101&id=999'],
    ['post', 'https://www.facebook.com/permalink.php?story_fbid=202&id=999&id=101'],
    ['post', 'https://www.facebook.com/permalink.php?story_fbid=202&story_fbid=999&id=101'],
    ['post', 'https://www.facebook.com/permalink.php?story_fbid=202&id=101&%69d=999'],
    ['post', 'https://www.facebook.com/101/posts/pfbidAbCd?id=101&id=999'],
    ['reel', 'https://www.facebook.com/watch?v=202&v=999'],
    ['reel', 'https://www.facebook.com/watch?v=202&v=202'],
  ]) {
    assert.equal(facebookUrlReferencesPostId(url, '101_202'), false, url);
    assert.equal(normalizeFacebookPostUrl(url, '101_202', { contentType: type }),
      fallbackFacebookPostUrl('101_202', type), url);
  }
});

test('numeric object segments must belong to a complete supported route', () => {
  for (const [type, url] of [
    ['post', 'https://www.facebook.com/101/posts/202/other'],
    ['post', 'https://www.facebook.com/share/101/posts/202'],
    ['post', 'https://www.facebook.com/other/permalink.php?story_fbid=202&id=101'],
    ['post', 'https://www.facebook.com/share/101/posts/pfbidAbCd'],
    ['reel', 'https://www.facebook.com/reel/202/other'],
    ['reel', 'https://www.facebook.com/share/reel/202/other'],
    ['reel', 'https://www.facebook.com/999/reels/202'],
  ]) {
    assert.equal(facebookUrlReferencesPostId(url, '101_202'), false, url);
    assert.equal(normalizeFacebookPostUrl(url, '101_202', { contentType: type }),
      fallbackFacebookPostUrl('101_202', type), url);
  }
});

test('URL identity proof rejects foreign hosts, credentials and nonstandard ports', () => {
  for (const url of [
    'https://example.com/reel/202',
    'https://facebook.com.example.com/reel/202',
    'https://secret@www.facebook.com/reel/202',
    'https://www.facebook.com:8443/reel/202',
  ]) {
    assert.equal(facebookUrlReferencesPostId(url, '101_202'), false, url);
    assert.equal(normalizeFacebookPostUrl(url, '101_202', { contentType: 'reel' }),
      fallbackFacebookPostUrl('101_202', 'reel'), url);
  }
});

test('direct routes normalize safely and keep opaque official stories', () => {
  for (const [url, expected] of [
    ['http://www.facebook.com/101/posts/202', 'https://www.facebook.com/101/posts/202'],
    ['//www.facebook.com/101/posts/202', 'https://www.facebook.com/101/posts/202'],
    ['/story.php?story_fbid=pfbidAbCd&id=101', 'https://www.facebook.com/story.php?story_fbid=pfbidAbCd&id=101'],
  ]) assert.equal(normalizeFacebookPostUrl(url, '101_202'), expected);
  assert.equal(normalizeFacebookPostUrl('https://www.facebook.com:443/watch?v=202',
    '101_202', { contentType: 'reel' }), 'https://www.facebook.com/watch?v=202');
});
