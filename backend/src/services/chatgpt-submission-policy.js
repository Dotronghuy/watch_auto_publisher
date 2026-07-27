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
