import axios from 'axios';

const contentKind = String(process.argv[2] || '').trim().toLowerCase();

if (!['video', 'post'].includes(contentKind)) {
  console.error('Usage: node src/scripts/trigger_publish_once.js <video|post>');
  process.exit(1);
}

const port = Number(process.env.PORT || 3000);
const endpoint = `http://127.0.0.1:${port}/api/trigger-workflow`;
const label = contentKind === 'video' ? 'video/Reels' : 'bai viet anh';

try {
  const response = await axios.post(
    endpoint,
    { contentKind },
    {
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    },
  );

  if (!response.data?.success) {
    throw new Error(response.data?.message || 'Backend did not accept the request');
  }

  console.log(`Da yeu cau dang dung 1 ${label}.`);
  console.log('Theo doi cua so CHAY_TOOL va Android Worker de xem ket qua.');
} catch (error) {
  if (error.response) {
    console.error(
      `Backend tu choi (${error.response.status}): ${error.response.data?.message || 'Unknown error'}`,
    );
  } else if (error.code === 'ECONNREFUSED') {
    console.error(`Khong ket noi duoc backend tai ${endpoint}. Hay chay CHAY_TOOL truoc.`);
  } else {
    console.error(`Khong the khoi dong bai test: ${error.message}`);
  }
  process.exit(1);
}
