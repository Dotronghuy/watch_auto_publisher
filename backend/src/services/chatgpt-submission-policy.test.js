import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasNewUserMessage,
  hasRequiredAttachmentPreviews,
} from './chatgpt-submission-policy.js';

test('all newly attached thumbnails must be visible before sending', () => {
  assert.equal(
    hasRequiredAttachmentPreviews({
      baselineCount: 1,
      observedCount: 3,
      expectedIncrease: 2,
    }),
    true,
  );
  assert.equal(
    hasRequiredAttachmentPreviews({
      baselineCount: 1,
      observedCount: 2,
      expectedIncrease: 2,
    }),
    false,
  );
});

test('image wait can start only after a new user message exists', () => {
  assert.equal(
    hasNewUserMessage({ baselineCount: 4, observedCount: 5 }),
    true,
  );
  assert.equal(
    hasNewUserMessage({ baselineCount: 4, observedCount: 4 }),
    false,
  );
});
