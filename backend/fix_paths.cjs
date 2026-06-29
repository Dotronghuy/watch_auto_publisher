const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');

async function main() {
  const variants = await prisma.variant.findMany();
  let updatedCount = 0;
  for (const v of variants) {
    let updateData = {};
    if (v.avatarImage && path.isAbsolute(v.avatarImage)) {
      updateData.avatarImage = `uploads\\${path.basename(v.avatarImage)}`;
    }
    if (v.rawImage && path.isAbsolute(v.rawImage)) {
      updateData.rawImage = `uploads\\${path.basename(v.rawImage)}`;
    }
    
    if (Object.keys(updateData).length > 0) {
      await prisma.variant.update({
        where: { id: v.id },
        data: updateData
      });
      updatedCount++;
    }
  }
  console.log(`Updated ${updatedCount} variants with relative paths!`);
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  });
