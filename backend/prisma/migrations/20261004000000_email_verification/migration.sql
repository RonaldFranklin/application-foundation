
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE TABLE "EmailVerification" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "id" TEXT NOT NULL,
  "digest" TEXT,
  "emailFingerprint" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "requests" TIMESTAMP(3)[] NOT NULL,
  CONSTRAINT "EmailVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailVerification_id_key" ON "EmailVerification"("id");
