export const MIN_REEL_PROPAGATION_DELAY_MS = 10_000;
export const MAX_REEL_PROPAGATION_DELAY_MS = 20_000;
export const DEFAULT_REEL_PROPAGATION_DELAY_MS = 15_000;

/** Keep the Facebook video-processing pause bounded to the requested 10–20 seconds. */
export const reelPropagationDelayMs = (value = process.env.MOBILE_REEL_PROPAGATION_DELAY_MS) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_REEL_PROPAGATION_DELAY_MS;
  return Math.min(MAX_REEL_PROPAGATION_DELAY_MS,
    Math.max(MIN_REEL_PROPAGATION_DELAY_MS, Math.round(parsed)));
};

export const waitForReelPropagation = ({
  signal,
  delayMs = reelPropagationDelayMs(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new Error('Chờ Facebook cập nhật Reels bị dừng theo yêu cầu.'));
    return;
  }

  let settled = false;
  let timer;
  const cleanup = () => {
    if (signal) signal.removeEventListener('abort', onAbort);
    if (timer !== undefined) clearTimeoutImpl(timer);
  };
  const finish = (callback) => {
    if (settled) return;
    settled = true;
    cleanup();
    callback();
  };
  const onAbort = () => finish(() => reject(new Error('Chờ Facebook cập nhật Reels bị dừng theo yêu cầu.')));

  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  timer = setTimeoutImpl(() => finish(resolve), Math.max(0, Number(delayMs) || 0));
});
