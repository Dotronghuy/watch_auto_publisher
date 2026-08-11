import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

const normalizeText = (value) => String(value || '').trim();

const fallbackFacebookPostUrl = (postId) => {
  const normalized = normalizeText(postId);
  const separator = normalized.indexOf('_');
  if (separator > 0) {
    const pageId = normalized.slice(0, separator);
    const storyId = normalized.slice(separator + 1);
    return `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(storyId)}&id=${encodeURIComponent(pageId)}`;
  }
  return normalized ? `https://www.facebook.com/reel/${encodeURIComponent(normalized)}` : '';
};

/**
 * Graph API normally returns an absolute permalink_url, but some responses and
 * older call sites can provide a protocol-relative, root-relative, or HTTP URL.
 * Mobile jobs must always contain an HTTPS URL because Android opens it outside
 * the trusted backend process.
 */
export const normalizeFacebookPostUrl = (value, postId) => {
  const fallback = fallbackFacebookPostUrl(postId);
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

export const enqueueMobileLinkJob = async ({
  postId,
  postUrl,
  shopeeUrl,
  linkName = 'Mua ở đây',
  force = false,
}) => {
  const normalizedPostId = normalizeText(postId);
  const normalizedShopeeUrl = normalizeText(shopeeUrl);

  if (!normalizedPostId) throw new Error('postId is required');
  const normalizedPostUrl = normalizeFacebookPostUrl(postUrl, normalizedPostId);
  if (!normalizedPostUrl) throw new Error('postUrl is required');
  if (!/^https:\/\//i.test(normalizedPostUrl)) throw new Error('postUrl must use HTTPS');
  if (!isAllowedShopeeUrl(normalizedShopeeUrl)) {
    throw new Error('shopeeUrl must be a valid Shopee Vietnam HTTPS URL');
  }

  const existing = await prisma.mobileLinkJob.findUnique({
    where: { postId: normalizedPostId },
  });

  if (!force && existing && ['PENDING', 'PROCESSING', 'SUCCEEDED'].includes(existing.status)) {
    return existing;
  }

  if (existing) {
    return prisma.mobileLinkJob.update({
      where: { id: existing.id },
      data: {
        postUrl: normalizedPostUrl,
        shopeeUrl: normalizedShopeeUrl,
        linkName: normalizeText(linkName) || 'Mua ở đây',
        status: 'PENDING',
        deviceId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        completedAt: null,
        errorMessage: null,
        resultMessage: null,
      },
    });
  }

  return prisma.mobileLinkJob.create({
    data: {
      postId: normalizedPostId,
      postUrl: normalizedPostUrl,
      shopeeUrl: normalizedShopeeUrl,
      linkName: normalizeText(linkName) || 'Mua ở đây',
    },
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
  leaseMs = DEFAULT_LEASE_MS,
}) => {
  const leaseExpiresAt = new Date(Date.now() + leaseMs);
  const updated = await prisma.mobileLinkJob.updateMany({
    where: {
      id: normalizeText(jobId),
      deviceId: normalizeText(deviceId),
      status: 'PROCESSING',
    },
    data: { leaseExpiresAt },
  });
  return updated.count === 1;
};

export const completeMobileLinkJob = async ({
  jobId,
  deviceId,
  success,
  message,
}) => {
  const existing = await prisma.mobileLinkJob.findFirst({
    where: {
      id: normalizeText(jobId),
      deviceId: normalizeText(deviceId),
    },
  });
  if (!existing) return null;

  if (existing.status === 'SUCCEEDED') return existing;
  if (existing.status !== 'PROCESSING') return null;

  return prisma.mobileLinkJob.update({
    where: { id: existing.id },
    data: {
      status: success ? 'SUCCEEDED' : 'FAILED',
      completedAt: new Date(),
      leaseExpiresAt: null,
      resultMessage: success ? normalizeText(message) : null,
      errorMessage: success ? null : normalizeText(message) || 'Android worker failed',
    },
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

export const retryMobileLinkJob = async (jobId) => prisma.mobileLinkJob.update({
  where: { id: normalizeText(jobId) },
  data: {
    status: 'PENDING',
    deviceId: null,
    claimedAt: null,
    leaseExpiresAt: null,
    completedAt: null,
    errorMessage: null,
    resultMessage: null,
  },
});
