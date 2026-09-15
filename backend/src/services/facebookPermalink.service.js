/**
 * Resolve the exact published object, never a Page/feed/share URL. Dependencies
 * are injected so this policy can be tested without booting the publisher,
 * opening a database, or contacting a real Facebook account.
 */
export const createFacebookPermalinkResolver = ({
  requestGraph,
  normalizePostUrl,
  fallbackPostUrl,
  logFallback = () => {},
}) => async (postId, pageToken, { contentType = 'post' } = {}) => {
  const normalizedId = String(postId || '').trim();
  if (!/^\d+(?:_\d+)?$/.test(normalizedId)) {
    throw new Error('Facebook postId must be a numeric object ID or PAGE_ID_OBJECT_ID');
  }
  if (contentType !== 'post' && contentType !== 'reel') {
    throw new Error('contentType must be post or reel');
  }

  const objectId = normalizedId.split('_').at(-1);
  // publishFBReels stores PAGE_ID_VIDEO_ID for ownership, but Meta's Video
  // node is /VIDEO_ID. A regular Page post keeps its composite Graph node ID.
  const graphObjectId = contentType === 'reel' ? objectId : normalizedId;
  const fallback = normalizePostUrl(
    fallbackPostUrl(normalizedId, contentType), normalizedId, { contentType },
  );
  const token = String(pageToken || '').trim();
  if (!token) return fallback;

  let failure = 'permalink_missing';
  try {
    // One bounded lookup also covers newly published Reels; an absent permalink
    // must not leave the mobile queue waiting indefinitely for video processing.
    const response = await requestGraph(`https://graph.facebook.com/v21.0/${graphObjectId}`, {
      params: { fields: 'id,permalink_url', access_token: token },
      timeout: 8000,
      maxRedirects: 0,
    });
    const returnedId = String(response.data?.id || '').trim();
    const permalink = String(response.data?.permalink_url || '').trim();
    if (returnedId !== graphObjectId) {
      failure = 'object_id_mismatch';
    } else if (permalink) {
      // URL normalization is the shared identity/host/content-type gate. It
      // replaces a rejected or generic URL with the exact-ID fallback.
      return normalizePostUrl(permalink, normalizedId, { contentType });
    }
  } catch {
    // Never forward raw Axios errors: they can contain the Page access token.
    failure = 'graph_request_failed';
  }
  logFallback({ postId: normalizedId, contentType, reason: failure });
  return fallback;
};
