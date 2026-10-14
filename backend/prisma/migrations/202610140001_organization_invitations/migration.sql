CREATE TABLE "OrganizationInvitation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "email" TEXT NOT NULL,
  "emailFingerprint" TEXT NOT NULL,
  "role" "OrganizationRole" NOT NULL,
  "digest" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  CONSTRAINT "OrganizationInvitation_terminal_check" CHECK ("acceptedAt" IS NULL OR "revokedAt" IS NULL)
);
CREATE UNIQUE INDEX "OrganizationInvitation_organizationId_emailFingerprint_key" ON "OrganizationInvitation"("organizationId", "emailFingerprint");
CREATE INDEX "OrganizationInvitation_organizationId_expiresAt_idx" ON "OrganizationInvitation"("organizationId", "expiresAt");
