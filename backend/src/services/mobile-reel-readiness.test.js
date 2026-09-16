import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REEL_PROPAGATION_DELAY_MS,
  MAX_REEL_PROPAGATION_DELAY_MS,
  MIN_REEL_PROPAGATION_DELAY_MS,
  reelPropagationDelayMs,
  waitForReelPropagation,
} from './mobile-reel-readiness.js';

test('Reels propagation delay defaults to 15 seconds and stays within 10–20 seconds', () => {
  assert.equal(reelPropagationDelayMs(undefined), DEFAULT_REEL_PROPAGATION_DELAY_MS);
  assert.equal(reelPropagationDelayMs('5000'), MIN_REEL_PROPAGATION_DELAY_MS);
  assert.equal(reelPropagationDelayMs('25000'), MAX_REEL_PROPAGATION_DELAY_MS);
  assert.equal(reelPropagationDelayMs('not-a-number'), DEFAULT_REEL_PROPAGATION_DELAY_MS);
});

test('Reels readiness wait can be aborted and cleans up its timer', async () => {
  const controller = new AbortController();
  let timerCleared = false;
  const pending = waitForReelPropagation({
    signal: controller.signal,
    delayMs: 10_000,
    setTimeoutImpl: () => 123,
    clearTimeoutImpl: (timer) => { timerCleared = timer === 123; },
  });
  controller.abort();
  await assert.rejects(pending, /dừng theo yêu cầu/);
  assert.equal(timerCleared, true);
});
