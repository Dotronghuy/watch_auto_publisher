export const CHATGPT_USER_MESSAGE_SELECTOR = [
  '[data-message-author-role="user"]',
  '[data-turn="user"]',
].join(', ');

export const hasRequiredAttachmentPreviews = ({
  baselineCount,
  observedCount,
  expectedIncrease,
}) => (
  Number(observedCount) >= (
    Number(baselineCount)
    + Math.max(1, Number(expectedIncrease) || 0)
  )
);

export const hasNewUserMessage = ({
  baselineCount,
  observedCount,
}) => Number(observedCount) > Number(baselineCount);
