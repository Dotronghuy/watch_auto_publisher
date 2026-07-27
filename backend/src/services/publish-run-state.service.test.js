import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSuccessfulPublishResult } from './publish-run-state.service.js';

test('last_run is eligible only when at least one platform succeeded', () => {
  assert.equal(hasSuccessfulPublishResult(null), false);
  assert.equal(
    hasSuccessfulPublishResult({
      publishSucceeded: false,
      publishedPlatforms: [],
    }),
    false,
  );
  assert.equal(
    hasSuccessfulPublishResult({
      publishSucceeded: true,
      publishedPlatforms: [],
    }),
    false,
  );
  assert.equal(
    hasSuccessfulPublishResult({
      publishSucceeded: true,
      publishedPlatforms: ['facebook'],
    }),
    true,
  );
});
