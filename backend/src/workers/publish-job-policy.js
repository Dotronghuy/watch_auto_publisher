export const AUTO_PUBLISH_ATTEMPTS = 3;
export const AUTO_PUBLISH_BACKOFF_DELAY_MS = 60_000;
export const AUTO_PUBLISH_RECOVERY_DELAY_MS = 5 * 60_000;
export const AUTO_PUBLISH_MAX_RECOVERY_JOBS = 1;
export const AUTO_PUBLISH_POLICY_REDIS_KEY = 'auto_publish_job_policy_version';
export const AUTO_PUBLISH_POLICY_VERSION = '2026-07-27-v1';

const DEFAULT_REMOVE_ON_COMPLETE = {
  age: 24 * 60 * 60,
  count: 100,
};

const DEFAULT_REMOVE_ON_FAIL = {
  age: 7 * 24 * 60 * 60,
  count: 500,
};

export const createAutoPublishJobOptions = (overrides = {}) => ({
  attempts: AUTO_PUBLISH_ATTEMPTS,
  backoff: {
    type: 'exponential',
    delay: AUTO_PUBLISH_BACKOFF_DELAY_MS,
  },
  removeOnComplete: DEFAULT_REMOVE_ON_COMPLETE,
  removeOnFail: DEFAULT_REMOVE_ON_FAIL,
  ...overrides,
});

const normalizeJobIdPart = (value) => String(value ?? 'unknown')
  .replace(/[^a-zA-Z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'unknown';

export const buildMissedSlotJobId = (slotTimestamp) => (
  `auto-publish-missed-${normalizeJobIdPart(slotTimestamp)}`
);

export const isManualStopError = (error) => {
  const message = String(error?.message || '');
  return error?.name === 'AbortError'
    || error?.code === 'STOP_REQUESTED'
    || /STOP_REQUESTED|Abort requested|dừng theo yêu cầu|bị dừng theo yêu cầu/i.test(message);
};

export const hasExhaustedAttempts = (job) => {
  const configuredAttempts = Math.max(1, Number(job?.opts?.attempts) || 1);
  return (Number(job?.attemptsMade) || 0) >= configuredAttempts;
};

export const buildRecoveryJob = (job, error, now = Date.now()) => {
  if (!job || !hasExhaustedAttempts(job) || isManualStopError(error)) return null;

  const recoveryCount = Math.max(0, Number(job.data?.recoveryCount) || 0);
  if (recoveryCount >= AUTO_PUBLISH_MAX_RECOVERY_JOBS) return null;

  const nextRecoveryCount = recoveryCount + 1;
  const sourceJobId = normalizeJobIdPart(job.id);

  return {
    name: 'autoPublishJob',
    data: {
      ...(job.data || {}),
      catchUp: true,
      recoveryCount: nextRecoveryCount,
      recoveryForJobId: String(job.id ?? ''),
      failedAt: now,
    },
    options: createAutoPublishJobOptions({
      delay: AUTO_PUBLISH_RECOVERY_DELAY_MS,
      jobId: `auto-publish-recovery-${sourceJobId}-${nextRecoveryCount}`,
    }),
  };
};
