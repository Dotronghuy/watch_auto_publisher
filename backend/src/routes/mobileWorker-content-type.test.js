import assert from 'node:assert/strict';
import test from 'node:test';

import { mobileJobContentType } from './mobileWorker.routes.js';

test('keeps a Facebook Reel on the Reel flow when its permalink looks like a post', () => {
  assert.equal(
    mobileJobContentType(
      { postUrl: 'https://www.facebook.com/101788945134600/posts/1498447018965401' },
      { platform: 'facebook_reels' },
    ),
    'reel',
  );
});
test('recognizes a manual Reel job from its URL without a metric', () => {
  assert.equal(
    mobileJobContentType({ postUrl: 'https://www.facebook.com/reel/1498447018965401' }, null),
    'reel',
  );
});

test('keeps a regular Facebook post on the post flow', () => {
  assert.equal(
    mobileJobContentType(
      { postUrl: 'https://www.facebook.com/permalink.php?story_fbid=123&id=456' },
      { platform: 'facebook' },
    ),
    'post',
  );
});
