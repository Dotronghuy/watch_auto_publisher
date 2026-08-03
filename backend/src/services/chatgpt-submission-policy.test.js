import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATGPT_ASSISTANT_MESSAGE_SELECTOR,
  CHATGPT_USER_MESSAGE_SELECTOR,
  hasNewAssistantMessage,
  hasNewUserMessage,
  hasRequiredAttachmentPreviews,
} from './chatgpt-submission-policy.js';

test('baseline and post-submit checks share both ChatGPT user-turn selectors', () => {
  assert.match(CHATGPT_USER_MESSAGE_SELECTOR, /data-message-author-role="user"/);
  assert.match(CHATGPT_USER_MESSAGE_SELECTOR, /data-turn="user"/);
});

test('assistant response checks share both ChatGPT assistant-turn selectors', () => {
  assert.match(CHATGPT_ASSISTANT_MESSAGE_SELECTOR, /data-message-author-role="assistant"/);
  assert.match(CHATGPT_ASSISTANT_MESSAGE_SELECTOR, /data-turn="assistant"/);
});

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

test('text wait can start only after a new assistant message exists', () => {
  assert.equal(
    hasNewAssistantMessage({ baselineCount: 4, observedCount: 5 }),
    true,
  );
  assert.equal(
    hasNewAssistantMessage({ baselineCount: 4, observedCount: 4 }),
    false,
  );
});
