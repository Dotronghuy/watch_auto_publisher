import assert from 'node:assert/strict';
import test from 'node:test';
import { createFacebookPermalinkResolver } from '../services/facebookPermalink.service.js';
import {
  fallbackFacebookPostUrl,
  normalizeFacebookPostUrl,
} from '../services/mobileLinkJob.service.js';

const postId = '123456_987654';
const createResolver = (response, { error = null } = {}) => {
  const calls = [];
  const warnings = [];
  const resolve = createFacebookPermalinkResolver({
    requestGraph: async (...args) => {
      calls.push(args);
      if (error) throw error;
      return { data: response };
    },
    normalizePostUrl: normalizeFacebookPostUrl,
    fallbackPostUrl: fallbackFacebookPostUrl,
    logFallback: (warning) => warnings.push(warning),
  });
  return { resolve, calls, warnings };
};

test('post queries its composite Graph node and preserves the authoritative permalink', async () => {
  const { resolve, calls } = createResolver({ id: postId, permalink_url: '/123456/posts/987654/' });
  assert.equal(await resolve(postId, 'test-token'), 'https://www.facebook.com/123456/posts/987654/');
  assert.equal(calls[0][0], `https://graph.facebook.com/v21.0/${postId}`);
  assert.deepEqual(calls[0][1], {
    params: { fields: 'id,permalink_url', access_token: 'test-token' },
    timeout: 8000,
    maxRedirects: 0,
  });
});

test('reel queries VIDEO_ID, not the synthetic PAGE_ID_VIDEO_ID', async () => {
  const { resolve, calls } = createResolver({ id: '987654', permalink_url: '/123456/videos/987654/' });
  assert.equal(await resolve(postId, 'test-token', { contentType: 'reel' }),
    'https://www.facebook.com/123456/videos/987654/');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://graph.facebook.com/v21.0/987654');
});

test('reel accepts an exact watch permalink returned by its video object', async () => {
  const { resolve } = createResolver({ id: '987654', permalink_url: '/watch/?v=987654' });
  assert.equal(await resolve(postId, 'test-token', { contentType: 'reel' }),
    'https://www.facebook.com/watch/?v=987654');
});

test('a missing fresh Reel permalink returns its exact video ID without retry polling', async () => {
  const { resolve, calls, warnings } = createResolver({ id: '987654' });
  assert.equal(await resolve(postId, 'test-token', { contentType: 'reel' }),
    'https://www.facebook.com/123456/videos/987654');
  assert.equal(calls.length, 1);
  assert.equal(warnings[0].reason, 'permalink_missing');
});

test('no Page token skips network and constructs an exact post permalink', async () => {
  const { resolve, calls } = createResolver(null);
  assert.equal(await resolve(postId, '  '),
    'https://www.facebook.com/permalink.php?story_fbid=987654&id=123456');
  assert.equal(calls.length, 0);
});

test('mismatched Graph response IDs cannot authorize an opaque post URL', async () => {
  const { resolve, warnings } = createResolver({
    id: '777777_987654', permalink_url: '/other-page/posts/pfbidWrongObject/',
  });
  assert.equal(await resolve(postId, 'test-token'), fallbackFacebookPostUrl(postId));
  assert.equal(warnings[0].reason, 'object_id_mismatch');
});

test('the shared normalizer rejects mismatched, generic, foreign and wrong-type permalinks', async () => {
  for (const [contentType, permalink] of [
    ['post', '/123456/posts/555555/'],
    ['post', '/999999/posts/987654/'],
    ['post', '/reel/987654/'],
    ['post', '/profile.php?id=123456'],
    ['post', 'https://example.com/123456/posts/987654/'],
    ['reel', '/reel/555555/'],
    ['reel', '/reels/'],
    ['reel', 'https://fb.watch/shared-link/'],
    ['reel', '/999999/videos/987654/'],
  ]) {
    const { resolve } = createResolver({
      id: contentType === 'post' ? postId : '987654', permalink_url: permalink,
    });
    assert.equal(await resolve(postId, 'test-token', { contentType }),
      fallbackFacebookPostUrl(postId, contentType), `${contentType}: ${permalink}`);
  }
});

test('request failures fall back once without leaking raw token-bearing error details', async () => {
  const { resolve, calls, warnings } = createResolver(null, {
    error: new Error('request failed: access_token=do-not-log-this-token'),
  });
  assert.equal(await resolve(postId, 'test-token'), fallbackFacebookPostUrl(postId));
  assert.equal(calls.length, 1);
  assert.equal(warnings[0].reason, 'graph_request_failed');
  assert.equal(JSON.stringify(warnings).includes('do-not-log-this-token'), false);
});

test('invalid identifiers and content types are rejected before any Graph request', async () => {
  const { resolve, calls } = createResolver(null);
  for (const invalidId of ['', '../me', '123_456_789', '123?fields=access_token']) {
    await assert.rejects(resolve(invalidId, 'test-token'), /postId/);
  }
  await assert.rejects(resolve(postId, 'test-token', { contentType: 'video' }), /contentType/);
  assert.equal(calls.length, 0);
});
