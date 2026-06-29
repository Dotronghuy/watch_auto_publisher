const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() { 
  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);'); 
  console.log('Checkpoint successful'); 
  process.exit(0); 
} 
main();
