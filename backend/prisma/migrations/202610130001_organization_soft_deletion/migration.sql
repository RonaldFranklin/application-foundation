ALTER TABLE "Organization" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "OrganizationMember" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "Organization_deletedAt_createdAt_id_idx" ON "Organization"("deletedAt", "createdAt", "id");
CREATE INDEX "OrganizationMember_organizationId_deletedAt_role_idx" ON "OrganizationMember"("organizationId", "deletedAt", "role");
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_deleted_inactive_check" CHECK ("deletedAt" IS NULL OR "active" = false);
