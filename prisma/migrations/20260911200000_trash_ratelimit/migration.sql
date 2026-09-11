-- CreateTable
CREATE TABLE "TrashItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalVirtualPath" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDir" BOOLEAN NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrashItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "TrashItem_userId_idx" ON "TrashItem"("userId");

-- CreateIndex
CREATE INDEX "TrashItem_expiresAt_idx" ON "TrashItem"("expiresAt");

-- CreateIndex
CREATE INDEX "RateLimit_resetAt_idx" ON "RateLimit"("resetAt");

-- AddForeignKey
ALTER TABLE "TrashItem" ADD CONSTRAINT "TrashItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
