import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const failedJob = await prisma.mobileLinkJob.findFirst({
    where: {
      status: 'FAILED',
    },
    orderBy: [
      {
        completedAt: 'desc',
      },
      {
        createdAt: 'desc',
      },
    ],
  });

  if (!failedJob) {
    console.log('Không có tác vụ gắn link thất bại nào để thử lại.');
    process.exitCode = 2;
  } else {
    const retriedJob = await prisma.mobileLinkJob.update({
      where: {
        id: failedJob.id,
      },
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

    console.log('Đã đưa tác vụ gắn link gần nhất về hàng chờ.');
    console.log(`Job ID: ${retriedJob.id}`);
    console.log(`Facebook Post ID: ${retriedJob.postId}`);
    console.log(`SKU: ${retriedJob.sku || '(không có)'}`);
    console.log(`Shopee URL: ${retriedJob.shopeeUrl}`);
    console.log('Giữ Android Worker đang chạy để điện thoại nhận lại tác vụ này.');
  }
} catch (error) {
  console.error('Không thể thử lại tác vụ gắn link gần nhất:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
