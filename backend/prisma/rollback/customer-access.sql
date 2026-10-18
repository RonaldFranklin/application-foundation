-- Template for a separately reviewed corrective migration, run in ONE transaction.
-- Never delete/edit _prisma_migrations. Refuse reversal once customer data exists.
LOCK TABLE "Customer", "CustomerSession", "CustomerToken", "CustomerRecoveryCode", "OrganizationPermissionGrant", "AuditEvent" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Customer")
     OR EXISTS (SELECT 1 FROM "AuditEvent" WHERE "resourceType" = 'customer')
     OR EXISTS (SELECT 1 FROM "OrganizationPermissionGrant" WHERE "permission"::text LIKE 'customers.%')
  THEN RAISE EXCEPTION 'CUSTOMER_ROLLBACK_REQUIRES_DATA_PRESERVATION_PLAN';
  END IF;
END $$;
DROP TABLE "CustomerRecoveryCode";
DROP TABLE "CustomerToken";
DROP TABLE "CustomerSession";
DROP TABLE "Customer";
ALTER TABLE "OrganizationPermissionGrant" DROP CONSTRAINT "OrganizationPermissionGrant_no_role_delegation";
ALTER TYPE "OrganizationPermission" RENAME TO "OrganizationPermission_customer_rollback";
CREATE TYPE "OrganizationPermission" AS ENUM ('organization.read', 'organization.update', 'members.read', 'members.create', 'members.link', 'members.roles', 'members.remove', 'permissions.manage');
ALTER TABLE "OrganizationPermissionGrant" ALTER COLUMN "permission" TYPE "OrganizationPermission" USING ("permission"::text::"OrganizationPermission");
DROP TYPE "OrganizationPermission_customer_rollback";

ALTER TABLE "OrganizationPermissionGrant" ADD CONSTRAINT "OrganizationPermissionGrant_no_role_delegation" CHECK ("permission" <> 'members.roles');
