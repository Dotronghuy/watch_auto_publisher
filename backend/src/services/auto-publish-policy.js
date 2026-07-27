export const shouldTryNextSkuAfterAiFailure = ({
  error,
  aborted = false,
}) => (
  !aborted
  && error?.isAiSkuFailure === true
  && typeof error?.failedSku === 'string'
  && error.failedSku.trim().length > 0
);
