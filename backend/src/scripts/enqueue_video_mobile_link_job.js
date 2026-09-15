import process from 'node:process';
import { createInterface } from 'node:readline/promises';

import {
  enqueueMobileLinkJob,
  isAllowedShopeeUrl,
} from '../services/mobileLinkJob.service.js';
import {
  getProductInfoBySku,
  getShopeeLinkFromProductInfo,
} from '../services/sheet.service.js';

const parseArgs = (argv) => {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      result[key.slice(2)] = true;
      continue;
    }
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
};

const normalize = (value) => String(value || '').trim();

const validateFacebookUrl = (value) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      host === 'facebook.com'
      || host.endsWith('.facebook.com')
      || host === 'fb.watch'
      || host.endsWith('.fb.watch')
    );
  } catch {
    return false;
  }
};

const printHelp = () => {
  console.log(`
Tạo tác vụ gắn link Shopee cho một video/Reels Facebook đã đăng.

Cách chạy tương tác:
  node --env-file=.env src/scripts/enqueue_video_mobile_link_job.js

Hoặc truyền đủ tham số:
  node --env-file=.env src/scripts/enqueue_video_mobile_link_job.js ^
    --post-url "https://www.facebook.com/reel/VIDEO_ID" ^
    --post-id "PAGE_ID_VIDEO_ID" ^
    --post-text "Caption đúng của video vừa đăng" ^
    --sku "751L-T8" ^
    --link-name "Mua ở đây"

Nếu Sheet không có link Shopee cho SKU, thêm --shopee-url "https://s.shopee.vn/...".
`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    return;
  }

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const postUrl = normalize(args['post-url']) || normalize(await terminal.question(
      'Dán URL video/Reels Facebook đã đăng: ',
    ));
    if (!validateFacebookUrl(postUrl)) {
      throw new Error('URL video phải là HTTPS của facebook.com hoặc fb.watch.');
    }

    const postId = normalize(args['post-id']) || normalize(await terminal.question(
      'Nhập Post ID dạng PAGE_ID_VIDEO_ID do Facebook Graph API trả về: ',
    ));
    if (!/^\d+_\d+$/.test(postId)) {
      throw new Error('Post ID video phải có dạng PAGE_ID_VIDEO_ID để mở đúng Fanpage.');
    }

    const postText = normalize(args['post-text']) || normalize(await terminal.question(
      'Dán đúng caption của video vừa đăng: ',
    ));
    if (!postText) {
      throw new Error('Caption là bắt buộc để xác nhận đúng thẻ video trên Fanpage.');
    }

    const sku = normalize(args.sku) || normalize(await terminal.question(
      'Nhập đúng SKU của video (để lấy link từ Sheet Products): ',
    ));

    let shopeeUrl = normalize(args['shopee-url']);
    if (!shopeeUrl && sku) {
      const productInfo = await getProductInfoBySku(sku, { force: true });
      shopeeUrl = getShopeeLinkFromProductInfo(productInfo);
      if (shopeeUrl) {
        console.log(`Đã lấy link Shopee của SKU ${sku} từ Sheet.`);
      }
    }
    if (!shopeeUrl) {
      shopeeUrl = normalize(await terminal.question(
        'Sheet chưa có link. Dán link Shopee được Facebook chấp nhận: ',
      ));
    }
    if (!isAllowedShopeeUrl(shopeeUrl)) {
      throw new Error('Link Shopee không hợp lệ. Hãy dùng link HTTPS thuộc shopee.vn hoặc vn.shp.ee.');
    }

    const requestedName = normalize(args['link-name']) || normalize(await terminal.question(
      'Tên liên kết [Mua ở đây]: ',
    ));
    const linkName = requestedName || 'Mua ở đây';

    const job = await enqueueMobileLinkJob({
      postId,
      postUrl,
      shopeeUrl,
      linkName,
      postText,
      contentType: 'reel',
    });

    console.log('\nĐÃ TẠO TÁC VỤ VIDEO THÀNH CÔNG');
    console.log(`Job ID: ${job.id}`);
    console.log(`Post ID: ${job.postId}`);
    console.log(`Trạng thái: ${job.status}`);
    console.log(`Video: ${job.postUrl}`);
    console.log(`Shopee: ${job.shopeeUrl}`);
    console.log('Giữ Worker trên Samsung ở trạng thái đang chạy để máy nhận tác vụ.');
  } finally {
    terminal.close();
  }
};

main().catch((error) => {
  console.error(`\nKHÔNG TẠO ĐƯỢC TÁC VỤ: ${error.message}`);
  process.exitCode = 1;
});
