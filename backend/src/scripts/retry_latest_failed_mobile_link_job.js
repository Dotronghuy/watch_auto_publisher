import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);

const hasFlag = (name) => args.includes(name);

const flagValue = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return '';
  const value = String(args[index + 1] || '').trim();
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
};

const facebookObjectId = (postId) => {
  const normalized = String(postId || '').trim();
  const separator = normalized.indexOf('_');
  return separator > 0 ? normalized.slice(separator + 1) : normalized;
};

const canonicalReelUrl = (postId) => {
  const reelId = facebookObjectId(postId);
  if (!/^\d+$/.test(reelId)) {
    throw new Error(`Cannot derive a numeric Reel ID from postId: ${postId}`);
  }
  return `https://www.facebook.com/reel/${encodeURIComponent(reelId)}`;
};

const validateFacebookUrl = (value) => {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  const facebookHost = hostname === 'facebook.com' || hostname.endsWith('.facebook.com');
  if (parsed.protocol !== 'https:' || !facebookHost) {
    throw new Error('--post-url must be an HTTPS facebook.com URL');
  }
  return parsed.toString();
};

const validateShopeeUrl = (value) => {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  const shopeeHost = hostname === 'shopee.vn'
    || hostname.endsWith('.shopee.vn')
    || hostname === 'vn.shp.ee';
  if (parsed.protocol !== 'https:' || !shopeeHost) {
    throw new Error('--shopee-url must be a Shopee Vietnam HTTPS URL');
  }
  return parsed.toString();
};

try {
  const jobId = flagValue('--job-id');
  const explicitPostUrl = flagValue('--post-url');
  const explicitShopeeUrl = flagValue('--shopee-url');
  const forceReel = hasFlag('--reel');

  const selectedJob = jobId
    ? await prisma.mobileLinkJob.findUnique({ where: { id: jobId } })
    : await prisma.mobileLinkJob.findFirst({
      where: { status: 'FAILED' },
      orderBy: [
        { completedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

  if (!selectedJob) {
    console.log(jobId
      ? `Không tìm thấy tác vụ gắn link có Job ID ${jobId}.`
      : 'Không có tác vụ gắn link thất bại nào để thử lại.');
    process.exitCode = 2;
  } else {
    let repairedPostUrl = selectedJob.postUrl;
    if (explicitPostUrl) repairedPostUrl = validateFacebookUrl(explicitPostUrl);
    if (forceReel) repairedPostUrl = canonicalReelUrl(selectedJob.postId);
    const repairedShopeeUrl = explicitShopeeUrl
      ? validateShopeeUrl(explicitShopeeUrl)
      : selectedJob.shopeeUrl;

    const retriedJob = await prisma.mobileLinkJob.update({
      where: { id: selectedJob.id },
      data: {
        postUrl: repairedPostUrl,
        shopeeUrl: repairedShopeeUrl,
        status: 'PENDING',
        deviceId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        completedAt: null,
        errorMessage: null,
        resultMessage: null,
      },
    });

    const isReel = /\/(?:reel|reels|videos)\//i.test(retriedJob.postUrl);
    console.log('Đã đưa đúng tác vụ gắn link về hàng chờ.');
    console.log(`Job ID: ${retriedJob.id}`);
    console.log(`Facebook Post ID: ${retriedJob.postId}`);
    console.log(`Loại nội dung: ${isReel ? 'Reels/Video' : 'Bài viết'}`);
    console.log(`Facebook URL: ${retriedJob.postUrl}`);
    console.log(`Shopee URL: ${retriedJob.shopeeUrl}`);
    console.log('Giữ Android Worker đang chạy để điện thoại nhận lại đúng tác vụ này.');
  }
} catch (error) {
  console.error('Không thể thử lại tác vụ gắn link:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
