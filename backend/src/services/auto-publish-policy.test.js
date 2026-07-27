import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldTryNextSkuAfterAiFailure } from './auto-publish-policy.js';

test('AI failure with a SKU advances to the next candidate', () => {
  assert.equal(
    shouldTryNextSkuAfterAiFailure({
      error: { isAiSkuFailure: true, failedSku: '751L' },
      aborted: false,
    }),
    true,
  );
});

test('publish failures and manual stops do not switch SKU', () => {
  assert.equal(
    shouldTryNextSkuAfterAiFailure({
      error: new Error('Facebook failed'),
      aborted: false,
    }),
    false,
  );
  assert.equal(
    shouldTryNextSkuAfterAiFailure({
      error: { isAiSkuFailure: true, failedSku: '751L' },
      aborted: true,
    }),
    false,
  );
});
