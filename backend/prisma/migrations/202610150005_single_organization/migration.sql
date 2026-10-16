BEGIN;
LOCK TABLE "OrganizationMember" IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "OrganizationMember" WHERE "deletedAt" IS NULL GROUP BY "userId" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'ACTIVE_MEMBERSHIP_CONFLICT: resolve duplicate active memberships before migration; no data changed';
  END IF;
END $$;
CREATE UNIQUE INDEX "OrganizationMember_one_active_user" ON "OrganizationMember" ("userId") WHERE "deletedAt" IS NULL;
ALTER TABLE "Session" DROP COLUMN "activeOrganization", DROP COLUMN "auditOrganization";
COMMIT;
