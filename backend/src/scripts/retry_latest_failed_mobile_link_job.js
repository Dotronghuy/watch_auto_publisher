import {
  getLatestFailedMobileLinkJob,
  getMobileLinkJob,
  retryMobileLinkJob,
} from '../services/mobileLinkJob.service.js';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);

const flagValue = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return '';
  const value = String(args[index + 1] || '').trim();
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
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

const validatedFacebookUrl = (value) => {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  const facebookHost = hostname === 'facebook.com'
    || hostname.endsWith('.facebook.com')
    || hostname === 'fb.watch';
  if (parsed.protocol !== 'https:' || !facebookHost) {
    throw new Error('--post-url must be an HTTPS Facebook URL');
  }
  return parsed.toString();
};

try {
  const jobId = flagValue('--job-id');
  const selectedJob = jobId
    ? await getMobileLinkJob(jobId)
    : await getLatestFailedMobileLinkJob();

  if (!selectedJob) {
    console.log(jobId
      ? `Không tìm thấy tác vụ gắn link có Job ID ${jobId}.`
      : 'Không có tác vụ gắn link thất bại nào để thử lại.');
    process.exitCode = 2;
  } else if (selectedJob.status !== 'FAILED') {
    throw new Error(
      `Chỉ được retry job FAILED; job ${selectedJob.id} đang là ${selectedJob.status}.`,
    );
  } else {
    const repair = {};
    const explicitPostUrl = flagValue('--post-url');
    const explicitShopeeUrl = flagValue('--shopee-url');
    const explicitPostText = flagValue('--post-text');
    const explicitLinkName = flagValue('--link-name');
    const forceReel = hasFlag('--reel');
    const forcePost = hasFlag('--post');
    if (forceReel && forcePost) throw new Error('Chỉ chọn một trong --reel hoặc --post.');

    if (explicitPostUrl) repair.postUrl = validatedFacebookUrl(explicitPostUrl);
    if (explicitShopeeUrl) repair.shopeeUrl = explicitShopeeUrl;
    if (explicitPostText) repair.postText = explicitPostText;
    if (explicitLinkName) repair.linkName = explicitLinkName;
    if (forceReel) {
      if (!/^\d+_\d+$/.test(String(selectedJob.postId || '').trim())) {
        throw new Error('Job Reel phải có Post ID dạng PAGE_ID_VIDEO_ID để mở đúng Fanpage.');
      }
      repair.contentType = 'reel';
      if (!explicitPostUrl) repair.postUrl = canonicalReelUrl(selectedJob.postId);
    }
    if (forcePost) {
      if (selectedJob.contentType !== 'post' && !explicitPostUrl) {
        throw new Error('Khi đổi job sang bài viết, bắt buộc truyền --post-url chính xác.');
      }
      repair.contentType = 'post';
    }

    const retriedJob = await retryMobileLinkJob(selectedJob.id, repair);
    if (!retriedJob) {
      throw new Error('Job đã đổi trạng thái trong lúc retry; không có gì được xếp lại.');
    }

    console.log('Đã đưa đúng tác vụ FAILED về hàng chờ.');
    console.log(`Job ID: ${retriedJob.id}`);
    console.log(`Facebook Post ID: ${retriedJob.postId}`);
    console.log(`Loại nội dung: ${retriedJob.contentType === 'reel' ? 'Reels/Video' : 'Bài viết'}`);
    console.log(`Facebook URL: ${retriedJob.postUrl}`);
    console.log(`Shopee URL: ${retriedJob.shopeeUrl}`);
    console.log('Giữ Android Worker 0.4.0 đang chạy để điện thoại nhận tác vụ.');
  }
} catch (error) {
  const legacyHint = /postText is required/i.test(String(error?.message || ''))
    ? ' Job cũ thiếu caption; hãy thêm --post-text "caption đúng" và --reel/--post.'
    : '';
  console.error(`Không thể thử lại tác vụ gắn link: ${error.message}.${legacyHint}`);
  process.exitCode = 1;
}
