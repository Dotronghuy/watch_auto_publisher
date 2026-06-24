import fs from 'fs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const migrate = async () => {
  const usersStr = fs.readFileSync('./users.json', 'utf8');
  const users = JSON.parse(usersStr);

  let defaultShop = await prisma.shop.findFirst({ where: { name: 'Admin Shop' } });
  if (!defaultShop) {
    defaultShop = await prisma.shop.create({
      data: { name: 'Admin Shop', publishMode: 'GROUPED' }
    });
  }

  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { username: u.username } });
    if (!existing) {
      await prisma.user.create({
        data: {
          id: u.id,
          username: u.username,
          password: u.password,
          role: u.role,
          permissions: JSON.stringify(u.permissions),
          shopId: defaultShop.id
        }
      });
      console.log(`Migrated user ${u.username}`);
    }
  }
  console.log('Migration done');
  process.exit(0);
};

migrate();
