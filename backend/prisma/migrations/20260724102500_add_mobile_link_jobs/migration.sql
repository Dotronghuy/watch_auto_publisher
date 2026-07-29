-- CreateTable
CREATE TABLE "MobileLinkJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "shopeeUrl" TEXT NOT NULL,
    "linkName" TEXT NOT NULL DEFAULT 'Mua ở đây',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "deviceId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" DATETIME,
    "leaseExpiresAt" DATETIME,
    "completedAt" DATETIME,
    "errorMessage" TEXT,
    "resultMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileLinkJob_postId_key" ON "MobileLinkJob"("postId");

-- CreateIndex
CREATE INDEX "MobileLinkJob_status_createdAt_idx" ON "MobileLinkJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MobileLinkJob_deviceId_status_idx" ON "MobileLinkJob"("deviceId", "status");
