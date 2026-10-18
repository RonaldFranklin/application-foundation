-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrganizationPermission" ADD VALUE 'customers.read';
ALTER TYPE "OrganizationPermission" ADD VALUE 'customers.invite';
ALTER TYPE "OrganizationPermission" ADD VALUE 'customers.manage';

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailIndex" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "totpSecret" TEXT,
    "pendingTotpSecret" TEXT,
    "pendingTotpExpiresAt" TIMESTAMP(3),
    "lastTotpStep" BIGINT NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSession" (
    "digest" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("digest")
);

-- CreateTable
CREATE TABLE "CustomerToken" (
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRecoveryCode" (
    "digest" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "CustomerRecoveryCode_pkey" PRIMARY KEY ("digest")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_emailIndex_key" ON "Customer"("emailIndex");

-- CreateIndex
CREATE INDEX "Customer_organizationId_createdAt_id_idx" ON "Customer"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSession_publicId_key" ON "CustomerSession"("publicId");

-- CreateIndex
CREATE INDEX "CustomerSession_customerId_idx" ON "CustomerSession"("customerId");

-- CreateIndex
CREATE INDEX "CustomerSession_expiresAt_idx" ON "CustomerSession"("expiresAt");

-- CreateIndex
CREATE INDEX "CustomerToken_customerId_kind_idx" ON "CustomerToken"("customerId", "kind");

-- CreateIndex
CREATE INDEX "CustomerRecoveryCode_customerId_idx" ON "CustomerRecoveryCode"("customerId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerToken" ADD CONSTRAINT "CustomerToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRecoveryCode" ADD CONSTRAINT "CustomerRecoveryCode_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Customer" ADD CONSTRAINT "Customer_status_check" CHECK ("status" IN ('pending', 'active', 'suspended'));
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_activation_check" CHECK ("status" = 'pending' OR ("emailVerifiedAt" IS NOT NULL AND "passwordHash" IS NOT NULL AND "name" IS NOT NULL));
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_stage_check" CHECK ("stage" IN ('mfa', 'full'));
ALTER TABLE "CustomerToken" ADD CONSTRAINT "CustomerToken_kind_check" CHECK ("kind" IN ('invitation', 'reset'));
ALTER TABLE "CustomerToken" ADD CONSTRAINT "CustomerToken_consumption_check" CHECK ("consumedAt" IS NULL OR "revokedAt" IS NULL);

ALTER TABLE "CustomerToken" ADD CONSTRAINT "CustomerToken_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5);
