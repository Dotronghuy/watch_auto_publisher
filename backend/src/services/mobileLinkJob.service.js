import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const JOB_STATUSES = new Set(['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED']);
const RESULT_STATUSES = new Set(['SUCCEEDED', 'FAILED']);
const IMMUTABLE_PAYLOAD_FIELDS = [
  'postUrl',
  'shopeeUrl',
  'linkName',
  'postText',
  'contentType',
];

const normalizeText = (value) => String(value || '').trim();

const validationError = (message) => {
  const error = new Error(message);
  error.code = 'MOBILE_LINK_JOB_VALIDATION';
  return error;
};

export const normalizeMobileLinkContentType = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized !== 'post' && normalized !== 'reel') {
    throw validationError('contentType must be post or reel');
  }
  return normalized;
};

export const mobileLinkEnqueueDisposition = (status) => {
  if (!status) return 'CREATE';
  const normalized = normalizeText(status).toUpperCase();
  if (!JOB_STATUSES.has(normalized)) {
    throw new Error(`Unsupported mobile link job status: ${normalized || '(empty)'}`);
  }
  if (normalized === 'PENDING') return 'REFRESH_PENDING';
  if (normalized === 'FAILED') return 'RETRY_REQUIRED';
  return 'IMMUTABLE';
};

export const mobileLinkCompletionDisposition = (currentStatus, requestedStatus) => {
  const current = normalizeText(currentStatus).toUpperCase();
  const requested = normalizeText(requestedStatus).toUpperCase();
  if (!RESULT_STATUSES.has(requested)) {
    throw validationError('status must be SUCCEEDED or FAILED');
  }
  if (current === 'PROCESSING') return 'COMPLETE';
  if (current === requested) return 'IDEMPOTENT';
  return 'CONFLICT';
};

export const mobileLinkPayloadMatches = (existing, payload) => (
  IMMUTABLE_PAYLOAD_FIELDS.every((field) => normalizeText(existing?.[field]) === payload[field])
);

const normalizeAttempt = (value) => {
  const attempt = Number(value);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw validationError('attempt must be a positive integer');
  }
  return attempt;
};

export const facebookObjectIdFromPostId = (postId) => {
  const normalized = normalizeText(postId);
  const separator = normalized.indexOf('_');
  return separator > 0 ? normalized.slice(separator + 1) : normalized;
};

export const fallbackFacebookPostUrl = (postId, contentType = 'post') => {
  const normalized = normalizeText(postId);
  if (normalizeMobileLinkContentType(contentType) === 'reel') {
    const reelId = facebookObjectIdFromPostId(normalized);
    return reelId ? `https://www.facebook.com/reel/${encodeURIComponent(reelId)}` : '';
  }
  const separator = normalized.indexOf('_');
  if (separator > 0) {
    const pageId = normalized.slice(0, separator);
    const storyId = normalized.slice(separator + 1);
    return `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(storyId)}&id=${encodeURIComponent(pageId)}`;
  }
  // A plain object ID does not contain enough information to construct the
  // owning Page post URL. Never turn a regular-post job into a Reel URL.
  return '';
};

export const facebookUrlReferencesPostId = (value, postId) => {
  const expectedObjectId = facebookObjectIdFromPostId(postId);
  if (!expectedObjectId) return false;

  try {
    const url = new URL(value);
    const numericParts = decodeURIComponent(`${url.pathname}${url.search}`)
      .match(/\d+/g) || [];
    return numericParts.includes(expectedObjectId);
  } catch {
    return false;
  }
};

/**
 * Graph API normally returns an absolute permalink_url, but some responses and
 * older call sites can provide a protocol-relative, root-relative, or HTTP URL.
 * Mobile jobs must always contain an HTTPS URL because Android opens it outside
 * the trusted backend process.
 */
export const normalizeFacebookPostUrl = (value, postId, { contentType = 'post' } = {}) => {
  const normalizedContentType = normalizeMobileLinkContentType(contentType);
  const fallback = fallbackFacebookPostUrl(postId, normalizedContentType);
  let candidate = normalizeText(value);
  if (!candidate) return fallback;

  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  } else if (candidate.startsWith('/')) {
    candidate = `https://www.facebook.com${candidate}`;
  } else if (/^(?:www\.)?facebook\.com\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    const isFacebookHost = hostname === 'facebook.com'
      || hostname.endsWith('.facebook.com')
      || hostname === 'fb.watch';
    if (!isFacebookHost || !['http:', 'https:'].includes(url.protocol)) return fallback;
    url.protocol = 'https:';
    // A Reel job is allowed to open only a permalink that contains the exact
    // video object ID returned by the upload. Share/Page URLs without that ID can
    // degrade to a generic Reels feed and expose an unrelated video on Android.
    if (
      normalizedContentType === 'reel'
      && !facebookUrlReferencesPostId(url.toString(), postId)
    ) {
      return fallback;
    }
    return url.toString();
  } catch {
    return fallback;
  }
};

export const isAllowedShopeeUrl = (value) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && (
        hostname === 'shopee.vn'
        || hostname.endsWith('.shopee.vn')
        || hostname === 'vn.shp.ee'
      );
  } catch {
    return false;
  }
};

export const normalizeMobileLinkJobPayload = ({
  postId,
  postUrl,
  shopeeUrl,
  linkName = 'Mua ở đây',
  postText,
  contentType,
}) => {
  const normalizedPostId = normalizeText(postId);
  const normalizedContentType = normalizeMobileLinkContentType(contentType);
  const normalizedShopeeUrl = normalizeText(shopeeUrl);
  const normalizedPostText = normalizeText(postText);

  if (!normalizedPostId) throw validationError('postId is required');
  if (!normalizedPostText) throw validationError('postText is required');
  if (normalizedContentType === 'reel' && !/^\d+_\d+$/.test(normalizedPostId)) {
    throw validationError('Reel postId must use PAGE_ID_VIDEO_ID');
  }

  const normalizedPostUrl = normalizeFacebookPostUrl(postUrl, normalizedPostId, {
    contentType: normalizedContentType,
  });
  if (!normalizedPostUrl) throw validationError('postUrl is required');
  if (!/^https:\/\//i.test(normalizedPostUrl)) {
    throw validationError('postUrl must use HTTPS');
  }
  if (!isAllowedShopeeUrl(normalizedShopeeUrl)) {
    throw validationError('shopeeUrl must be a valid Shopee Vietnam HTTPS URL');
  }

  return {
    postId: normalizedPostId,
    postUrl: normalizedPostUrl,
    shopeeUrl: normalizedShopeeUrl,
    linkName: normalizeText(linkName) || 'Mua ở đây',
    postText: normalizedPostText,
    contentType: normalizedContentType,
  };
};

export const enqueueMobileLinkJob = async ({
  postId,
  postUrl,
  shopeeUrl,
  linkName = 'Mua ở đây',
  postText,
  contentType = 'post',
}) => {
  const payload = normalizeMobileLinkJobPayload({
    postId,
    postUrl,
    shopeeUrl,
    linkName,
    postText,
    contentType,
  });

  return prisma.$transaction(async (tx) => {
    const existing = await tx.mobileLinkJob.findUnique({
      where: { postId: payload.postId },
    });
    const disposition = mobileLinkEnqueueDisposition(existing?.status);

    if (disposition === 'CREATE') {
      return tx.mobileLinkJob.create({ data: payload });
    }
    if (disposition === 'REFRESH_PENDING') {
      return tx.mobileLinkJob.update({
        where: { id: existing.id },
        data: payload,
      });
    }
    if (disposition === 'IMMUTABLE') {
      if (mobileLinkPayloadMatches(existing, payload)) return existing;
      const error = new Error(
        `Mobile link job ${existing.id} is ${existing.status}; its payload is immutable`,
      );
      error.code = 'MOBILE_LINK_JOB_PAYLOAD_CONFLICT';
      throw error;
    }

    const error = new Error(
      `Mobile link job ${existing.id} has FAILED; retry it explicitly`,
    );
    error.code = 'MOBILE_LINK_JOB_RETRY_REQUIRED';
    throw error;
  });
};

export const claimNextMobileLinkJob = async ({
  deviceId,
  leaseMs = DEFAULT_LEASE_MS,
}) => {
  const normalizedDeviceId = normalizeText(deviceId);
  if (!normalizedDeviceId) throw new Error('deviceId is required');

  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  return prisma.$transaction(async (tx) => {
    await tx.mobileLinkJob.updateMany({
      where: {
        status: 'PROCESSING',
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: 'PENDING',
        deviceId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        errorMessage: 'Worker lease expired; returned to queue',
      },
    });

    const activeJob = await tx.mobileLinkJob.findFirst({
      where: {
        status: 'PROCESSING',
        deviceId: normalizedDeviceId,
        leaseExpiresAt: { gte: now },
      },
      orderBy: { claimedAt: 'asc' },
    });
    if (activeJob) return activeJob;

    const pendingJob = await tx.mobileLinkJob.findFirst({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (!pendingJob) return null;

    const claimed = await tx.mobileLinkJob.updateMany({
      where: {
        id: pendingJob.id,
        status: 'PENDING',
      },
      data: {
        status: 'PROCESSING',
        deviceId: normalizedDeviceId,
        claimedAt: now,
        leaseExpiresAt,
        attempt: { increment: 1 },
        errorMessage: null,
      },
    });
    if (claimed.count !== 1) return null;

    return tx.mobileLinkJob.findUnique({ where: { id: pendingJob.id } });
  });
};

export const heartbeatMobileLinkJob = async ({
  jobId,
  deviceId,
  attempt,
  leaseMs = DEFAULT_LEASE_MS,
}) => {
  const normalizedAttempt = normalizeAttempt(attempt);
  const leaseExpiresAt = new Date(Date.now() + leaseMs);
  const updated = await prisma.mobileLinkJob.updateMany({
    where: {
      id: normalizeText(jobId),
      deviceId: normalizeText(deviceId),
      attempt: normalizedAttempt,
      status: 'PROCESSING',
    },
    data: { leaseExpiresAt },
  });
  return updated.count === 1;
};

export const completeMobileLinkJob = async ({
  jobId,
  deviceId,
  attempt,
  status,
  message,
}) => {
  const normalizedJobId = normalizeText(jobId);
  const normalizedDeviceId = normalizeText(deviceId);
  const normalizedAttempt = normalizeAttempt(attempt);
  const requestedStatus = normalizeText(status).toUpperCase();
  mobileLinkCompletionDisposition('PROCESSING', requestedStatus);

  if (!normalizedJobId) throw validationError('jobId is required');
  if (!normalizedDeviceId) throw validationError('deviceId is required');

  return prisma.$transaction(async (tx) => {
    const existing = await tx.mobileLinkJob.findFirst({
      where: {
        id: normalizedJobId,
        deviceId: normalizedDeviceId,
        attempt: normalizedAttempt,
      },
    });
    if (!existing) return null;

    const disposition = mobileLinkCompletionDisposition(existing.status, requestedStatus);
    if (disposition === 'IDEMPOTENT') return existing;
    if (disposition === 'CONFLICT') return null;

    const succeeded = requestedStatus === 'SUCCEEDED';
    return tx.mobileLinkJob.update({
      where: { id: existing.id },
      data: {
        status: requestedStatus,
        completedAt: new Date(),
        leaseExpiresAt: null,
        resultMessage: succeeded ? normalizeText(message) : null,
        errorMessage: succeeded ? null : normalizeText(message) || 'Android worker failed',
      },
    });
  });
};

export const getMobileLinkQueueStats = async () => {
  const groups = await prisma.mobileLinkJob.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  return Object.fromEntries(groups.map((row) => [row.status, row._count._all]));
};

export const listMobileLinkJobs = async (limit = 50) => prisma.mobileLinkJob.findMany({
  take: Math.max(1, Math.min(Number(limit) || 50, 200)),
  orderBy: { createdAt: 'desc' },
});

export const getMobileLinkJob = async (jobId) => {
  const normalizedJobId = normalizeText(jobId);
  if (!normalizedJobId) return null;
  return prisma.mobileLinkJob.findUnique({ where: { id: normalizedJobId } });
};

export const getLatestFailedMobileLinkJob = async () => prisma.mobileLinkJob.findFirst({
  where: { status: 'FAILED' },
  orderBy: [
    { completedAt: 'desc' },
    { createdAt: 'desc' },
  ],
});

export const retryMobileLinkJob = async (jobId, repair = {}) => {
  const normalizedJobId = normalizeText(jobId);
  if (!normalizedJobId) throw validationError('jobId is required');
  if (!repair || typeof repair !== 'object' || Array.isArray(repair)) {
    throw validationError('repair payload must be an object');
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.mobileLinkJob.findUnique({
      where: { id: normalizedJobId },
    });
    if (!existing || existing.status !== 'FAILED') return null;

    const repairedPayload = normalizeMobileLinkJobPayload({
      postId: existing.postId,
      postUrl: Object.hasOwn(repair, 'postUrl') ? repair.postUrl : existing.postUrl,
      shopeeUrl: Object.hasOwn(repair, 'shopeeUrl') ? repair.shopeeUrl : existing.shopeeUrl,
      linkName: Object.hasOwn(repair, 'linkName') ? repair.linkName : existing.linkName,
      postText: Object.hasOwn(repair, 'postText') ? repair.postText : existing.postText,
      contentType: Object.hasOwn(repair, 'contentType')
        ? repair.contentType
        : existing.contentType,
    });
    const { postId: _postId, ...mutablePayload } = repairedPayload;

    const updated = await tx.mobileLinkJob.updateMany({
      where: { id: existing.id, status: 'FAILED' },
      data: {
        ...mutablePayload,
        status: 'PENDING',
        deviceId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        completedAt: null,
        errorMessage: null,
        resultMessage: null,
      },
    });
    if (updated.count !== 1) return null;
    return tx.mobileLinkJob.findUnique({ where: { id: existing.id } });
  });
};
