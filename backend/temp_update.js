import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const updates = [
  { sku: '522G-T1', id: '49662649000' },
  { sku: '55886G1-T1', id: '46112649892' },
  { sku: '55886G1-T2', id: '44862665268' },
  { sku: '55886G1-T3', id: '42731909897' },
  { sku: '55886G1-T4', id: '51012640590' },
  { sku: '55886G1-T5', id: '46312665517' },
  { sku: '55883G-D1', id: '58012645570' },
  { sku: '55883G-D2', id: '53062645619' },
  { sku: '55883G-D4', id: '49962670742' },
  { sku: '55883G-D5', id: '50612645728' }
];

async function main() {
  for (const item of updates) {
    try {
      const variant = await prisma.variant.findFirst({ where: { sku: item.sku } });
      if (variant) {
        await prisma.variant.update({
          where: { id: variant.id },
          data: { shopeeProductId: item.id }
        });
        console.log(`Updated ${item.sku} with ID ${item.id}`);
      } else {
        console.log(`Variant ${item.sku} not found`);
      }
    } catch (err) {
      console.error(`Error updating ${item.sku}:`, err.message);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
