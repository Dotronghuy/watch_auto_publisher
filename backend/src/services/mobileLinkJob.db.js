import { PrismaClient } from '@prisma/client';

// An explicit override lets integration tests use a disposable SQLite database.
// Normal operation continues to use the datasource in prisma/schema.prisma.
const databaseUrl = process.env.MOBILE_WORKER_DATABASE_URL?.trim();
export const mobileLinkPrisma = new PrismaClient(databaseUrl
  ? { datasources: { db: { url: databaseUrl } } }
  : undefined);
