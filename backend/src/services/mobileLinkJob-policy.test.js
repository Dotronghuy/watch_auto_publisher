import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fallbackFacebookPostUrl,
  mobileLinkCompletionDisposition,
  mobileLinkEnqueueDisposition,
  mobileLinkPayloadMatches,
  normalizeMobileLinkContentType,
  normalizeMobileLinkJobPayload,
} from './mobileLinkJob.service.js';

test('accepts only the two canonical content types', () => {
  assert.equal(normalizeMobileLinkContentType(' POST '), 'post');
  assert.equal(normalizeMobileLinkContentType('Reel'), 'reel');
  assert.throws(() => normalizeMobileLinkContentType('video'), /post or reel/);
  assert.throws(() => normalizeMobileLinkContentType(''), /post or reel/);
});

test('keeps optional caption metadata and requires an allowed Shopee Vietnam URL', () => {
  const valid = normalizeMobileLinkJobPayload({
    postId: '101_202',
    postUrl: 'https://www.facebook.com/101/posts/202',
    shopeeUrl: 'https://vn.shp.ee/example',
    postText: 'Caption nhận diện đúng bài',
    contentType: 'post',
  });
  assert.equal(valid.postText, 'Caption nhận diện đúng bài');
  assert.equal(valid.contentType, 'post');

  assert.throws(
    () => normalizeMobileLinkJobPayload({
      postId: '101_202',
      postUrl: valid.postUrl,
      shopeeUrl: 'https://example.com/not-shopee',
      postText: valid.postText,
      contentType: 'post',
    }),
    /Shopee Vietnam HTTPS URL/,
  );
  assert.throws(
    () => normalizeMobileLinkJobPayload({
      postId: '202',
      postUrl: 'https://www.facebook.com/reel/202',
      shopeeUrl: valid.shopeeUrl,
      postText: valid.postText,
      contentType: 'reel',
    }),
    /PAGE_ID_VIDEO_ID/,
  );
});

test('accepts missing, null and blank captions for exact post and video destinations', () => {
  for (const contentType of ['post', 'reel']) {
    const input = {
      postId: '101_202',
      postUrl: contentType === 'post'
        ? 'https://www.facebook.com/101/posts/202'
        : 'https://www.facebook.com/reel/202',
      shopeeUrl: 'https://vn.shp.ee/example',
      contentType,
    };
    assert.equal(normalizeMobileLinkJobPayload(input).postText, '');
    for (const postText of [undefined, null, '', ' \n\t ']) {
      const normalized = normalizeMobileLinkJobPayload({ ...input, postText });
      assert.equal(normalized.postText, '');
      assert.equal(normalized.postUrl, input.postUrl);
      assert.equal(normalized.contentType, contentType);
    }
    assert.throws(() => normalizeMobileLinkJobPayload({ ...input, postId: '' }), /postId is required/);
    assert.throws(() => normalizeMobileLinkJobPayload({ ...input, contentType: 'video' }), /post or reel/);
    assert.throws(() => normalizeMobileLinkJobPayload({ ...input, shopeeUrl: 'http://shopee.vn/product/1/2' }),
      /Shopee Vietnam HTTPS URL/);
  }
});

test('does not invent a Reel URL for a plain regular-post ID', () => {
  assert.equal(fallbackFacebookPostUrl('202', 'post'), '');
  assert.equal(
    fallbackFacebookPostUrl('101_202', 'post'),
    'https://www.facebook.com/permalink.php?story_fbid=202&id=101',
  );
  assert.equal(fallbackFacebookPostUrl('101_202', 'reel'), 'https://www.facebook.com/reel/202');
});

test('enqueue policy refreshes only pending jobs', () => {
  assert.equal(mobileLinkEnqueueDisposition(undefined), 'CREATE');
  assert.equal(mobileLinkEnqueueDisposition('PENDING'), 'REFRESH_PENDING');
  assert.equal(mobileLinkEnqueueDisposition('FAILED'), 'RETRY_REQUIRED');
  assert.equal(mobileLinkEnqueueDisposition('PROCESSING'), 'IMMUTABLE');
  assert.equal(mobileLinkEnqueueDisposition('SUCCEEDED'), 'IMMUTABLE');
});

test('claimed and terminal jobs accept only their original payload', () => {
  const payload = {
    postUrl: 'https://www.facebook.com/101/posts/202',
    shopeeUrl: 'https://vn.shp.ee/example',
    linkName: 'Mua ở đây',
    postText: 'Caption nhận diện đúng bài',
    contentType: 'post',
  };
  assert.equal(mobileLinkPayloadMatches({ ...payload }, payload), true);
  assert.equal(
    mobileLinkPayloadMatches({ ...payload, shopeeUrl: 'https://vn.shp.ee/old' }, payload),
    false,
  );
  assert.equal(mobileLinkPayloadMatches({ ...payload, postText: 'Changed metadata' }, payload), false);
  assert.equal(mobileLinkPayloadMatches({ ...payload, postText: null }, { ...payload, postText: '' }), true);
});

test('result reporting is idempotent but rejects contradictory terminal results', () => {
  assert.equal(mobileLinkCompletionDisposition('PROCESSING', 'SUCCEEDED'), 'COMPLETE');
  assert.equal(mobileLinkCompletionDisposition('SUCCEEDED', 'SUCCEEDED'), 'IDEMPOTENT');
  assert.equal(mobileLinkCompletionDisposition('FAILED', 'FAILED'), 'IDEMPOTENT');
  assert.equal(mobileLinkCompletionDisposition('SUCCEEDED', 'FAILED'), 'CONFLICT');
  assert.equal(mobileLinkCompletionDisposition('FAILED', 'SUCCEEDED'), 'CONFLICT');
  assert.throws(
    () => mobileLinkCompletionDisposition('PROCESSING', 'PENDING'),
    /SUCCEEDED or FAILED/,
  );
});
