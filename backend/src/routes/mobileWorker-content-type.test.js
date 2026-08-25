import assert from 'node:assert/strict';
import test from 'node:test';

import { mobileJobContentType, mobileJobPostText } from './mobileWorker.routes.js';

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

test('uses the caption persisted with the mobile job before history fallback', () => {
  assert.equal(
    mobileJobPostText(
      { postText: 'Caption chính xác vừa gửi lên Facebook' },
      { content: 'Caption cũ trong lịch sử' },
    ),
    'Caption chính xác vừa gửi lên Facebook',
  );
});

test('falls back to history content for legacy jobs without persisted caption', () => {
  assert.equal(
    mobileJobPostText({ postText: '' }, { content: 'Caption từ lịch sử cũ' }),
    'Caption từ lịch sử cũ',
  );
});

test('uses stored Reel type even when Page Posts URL has no Reel path', () => {
  assert.equal(
    mobileJobContentType(
      {
        contentType: 'reel',
        postUrl: 'https://www.facebook.com/profile.php?id=101788945134600&sk=posts',
      },
      null,
    ),
    'reel',
  );
});
