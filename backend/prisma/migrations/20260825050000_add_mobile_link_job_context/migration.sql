-- Persist the exact Facebook caption and content type with each mobile job.
-- The Android worker must not depend on a second SQLite history lookup to
-- identify the post that was just published.
ALTER TABLE "MobileLinkJob" ADD COLUMN "postText" TEXT;
ALTER TABLE "MobileLinkJob" ADD COLUMN "contentType" TEXT NOT NULL DEFAULT 'post';
