import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_PUBLISH_ATTEMPTS,
  AUTO_PUBLISH_BACKOFF_DELAY_MS,
  AUTO_PUBLISH_RECOVERY_DELAY_MS,
  buildMissedSlotJobId,
  buildRecoveryJob,
  createAutoPublishJobOptions,
  hasExhaustedAttempts,
} from './publish-job-policy.js';

test('auto publish jobs use attempts and exponential backoff', () => {
  const options = createAutoPublishJobOptions();

  assert.equal(options.attempts, AUTO_PUBLISH_ATTEMPTS);
  assert.deepEqual(options.backoff, {
    type: 'exponential',
    delay: AUTO_PUBLISH_BACKOFF_DELAY_MS,
  });
});

test('recovery job is only created after attempts are exhausted', () => {
  const retryingJob = {
    id: 'repeat:slot:1',
    data: {},
    opts: { attempts: 3 },
    attemptsMade: 2,
  };
  assert.equal(hasExhaustedAttempts(retryingJob), false);
  assert.equal(buildRecoveryJob(retryingJob, new Error('temporary')), null);

  const failedJob = { ...retryingJob, attemptsMade: 3 };
  const recovery = buildRecoveryJob(failedJob, new Error('temporary'), 1234);

  assert.equal(recovery.name, 'autoPublishJob');
  assert.equal(recovery.data.catchUp, true);
  assert.equal(recovery.data.recoveryCount, 1);
  assert.equal(recovery.options.delay, AUTO_PUBLISH_RECOVERY_DELAY_MS);
  assert.equal(recovery.options.attempts, AUTO_PUBLISH_ATTEMPTS);
  assert.doesNotMatch(recovery.options.jobId, /:/);
});

test('manual stop and a failed recovery job do not create another recovery', () => {
  const exhaustedJob = {
    id: '42',
    data: {},
    opts: { attempts: 3 },
    attemptsMade: 3,
  };
  const stopError = Object.assign(new Error('dừng theo yêu cầu'), {
    name: 'AbortError',
  });

  assert.equal(buildRecoveryJob(exhaustedJob, stopError), null);
  assert.equal(
    buildRecoveryJob(
      { ...exhaustedJob, data: { recoveryCount: 1 } },
      new Error('still failing'),
    ),
    null,
  );
});

test('missed slot IDs are deterministic and Redis-safe', () => {
  assert.equal(
    buildMissedSlotJobId(1785123000000),
    'auto-publish-missed-1785123000000',
  );
});
