CREATE TABLE "MasterDevice" (
    "digest" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MasterDevice_pkey" PRIMARY KEY ("digest")
);
CREATE INDEX "MasterDevice_userId_createdAt_idx" ON "MasterDevice"("userId", "createdAt");
CREATE INDEX "MasterDevice_expiresAt_idx" ON "MasterDevice"("expiresAt");
ALTER TABLE "MasterDevice" ADD CONSTRAINT "MasterDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
