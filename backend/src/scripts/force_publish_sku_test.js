import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { publishToFacebook } from '../services/meta.service.js';
import {
  enqueueMobileLinkJob,
  isAllowedShopeeUrl,
} from '../services/mobileLinkJob.service.js';
import { getProductInfoBySku } from '../services/sheet.service.js';

const prisma = new PrismaClient();
const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED']);

const readArgument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
};

const sku = readArgument('--sku').toUpperCase();
const shopeeUrl = readArgument('--shopee-url');
const confirmed = process.argv.includes('--confirm-publish');

const fallbackFacebookPostUrl = (postId) => {
  const [pageId, objectId] = String(postId || '').split('_');
  return pageId && objectId
    ? `https://www.facebook.com/${pageId}/posts/${objectId}`
    : `https://www.facebook.com/${postId}`;
};

const resolveFacebookPostUrl = async (postId, pageToken) => {
  try {
    const response = await axios.get(`${GRAPH_API_BASE}/${postId}`, {
      params: {
        fields: 'permalink_url',
        access_token: pageToken,
      },
      timeout: 15_000,
    });
    return response.data?.permalink_url || fallbackFacebookPostUrl(postId);
  } catch {
    return fallbackFacebookPostUrl(postId);
  }
};

const waitForMobileResult = async (jobId, timeoutMs = 3 * 60 * 1000) => {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const job = await prisma.mobileLinkJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error(`Mobile job ${jobId} disappeared`);

    if (job.status !== lastStatus) {
      console.log(`[Android Worker] ${job.status}${job.deviceId ? ` on ${job.deviceId}` : ''}`);
      lastStatus = job.status;
    }
    if (TERMINAL_STATUSES.has(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return prisma.mobileLinkJob.findUnique({ where: { id: jobId } });
};

try {
  if (!confirmed) {
    throw new Error('Refusing to publish without --confirm-publish');
  }
  if (!/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(sku)) {
    throw new Error('Invalid --sku');
  }
  if (!isAllowedShopeeUrl(shopeeUrl)) {
    throw new Error('Invalid --shopee-url');
  }

  const pageToken = String(process.env.FB_PAGE_ACCESS_TOKEN || '').trim();
  if (!pageToken) throw new Error('FB_PAGE_ACCESS_TOKEN is not configured');

  const activeJobs = await prisma.mobileLinkJob.count({
    where: { status: { in: ['PENDING', 'PROCESSING'] } },
  });
  if (activeJobs > 0) {
    throw new Error(`Refusing to publish while ${activeJobs} mobile job(s) are active`);
  }

  const product = await getProductInfoBySku(sku);
  if (!product || String(product['Mã sản phẩm'] || '').trim().toUpperCase() !== sku) {
    throw new Error(`SKU ${sku} was not found in Google Sheets`);
  }

  const imageUrl = String(product['Link ảnh sản phẩm'] || '').trim();
  if (!/^https:\/\//i.test(imageUrl)) {
    throw new Error(`SKU ${sku} does not have a public HTTPS product image`);
  }

  const productName = String(product['Tên sản phẩm'] || sku).trim();
  const caption = [
    `${productName.toUpperCase()} — THANH LỊCH TRÊN MỌI CỔ TAY ✨`,
    '',
    'Mặt trắng tinh tế, kính Sapphire, dây thép không gỉ 316L và bộ máy Quartz Nhật Bản bền bỉ. Thiết kế nữ 33 mm gọn gàng, dễ phối cùng trang phục công sở hay dự tiệc.',
    '',
    'Nhắn tin Fanpage để được tư vấn.',
  ].join('\n');

  console.log(`[Facebook] Publishing one-photo test for ${sku}...`);
  const published = await publishToFacebook(caption, imageUrl, {
    fbAccessToken: pageToken,
  });
  const postId = String(published?.post_id || published?.id || '').trim();
  if (!postId) throw new Error('Facebook did not return a post ID');

  const postUrl = await resolveFacebookPostUrl(postId, pageToken);
  console.log(`[Facebook] Published: ${postId}`);
  console.log(`[Facebook] URL: ${postUrl}`);

  const job = await enqueueMobileLinkJob({
    postId,
    postUrl,
    shopeeUrl,
    linkName: process.env.MOBILE_SHOPEE_LINK_NAME || 'Mua ở đây',
    postText: caption,
    contentType: 'post',
  });
  console.log(`[Android Worker] Queued: ${job.id}`);

  const completed = await waitForMobileResult(job.id);
  console.log(JSON.stringify({
    sku,
    postId,
    postUrl,
    shopeeUrl,
    mobileJobId: completed?.id || job.id,
    mobileStatus: completed?.status || 'UNKNOWN',
    mobileMessage: completed?.resultMessage || completed?.errorMessage || null,
  }, null, 2));

  if (completed?.status !== 'SUCCEEDED') process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
