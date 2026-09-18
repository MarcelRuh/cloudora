-- CreateEnum
CREATE TYPE "FolderShareAccess" AS ENUM ('READ', 'WRITE');

-- CreateTable
CREATE TABLE "FolderShare" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "hostPath" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolderShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolderShareGrant" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "userId" TEXT,
    "roleId" TEXT,
    "access" "FolderShareAccess" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolderShareGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FolderShare_slug_key" ON "FolderShare"("slug");

-- CreateIndex
CREATE INDEX "FolderShareGrant_shareId_idx" ON "FolderShareGrant"("shareId");

-- CreateIndex
CREATE INDEX "FolderShareGrant_userId_idx" ON "FolderShareGrant"("userId");

-- CreateIndex
CREATE INDEX "FolderShareGrant_roleId_idx" ON "FolderShareGrant"("roleId");

-- AddForeignKey
ALTER TABLE "FolderShareGrant" ADD CONSTRAINT "FolderShareGrant_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "FolderShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderShareGrant" ADD CONSTRAINT "FolderShareGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderShareGrant" ADD CONSTRAINT "FolderShareGrant_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
