const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.setting.findUnique({where:{key:'shopee_cookies'}})
  .then(res => {
    if (res && res.value) {
      console.log('Cookies exist:', res.value.length, 'bytes');
      console.log(res.value.substring(0, 100) + '...');
    } else {
      console.log('NO COOKIES FOUND');
    }
  })
  .finally(() => prisma.$disconnect());
