-- Revoke only the obsolete role-management grant and preserve all other grants.
DELETE FROM "OrganizationPermissionGrant" WHERE "permission" = 'members.roles';
ALTER TABLE "OrganizationPermissionGrant"
  ADD CONSTRAINT "OrganizationPermissionGrant_no_role_delegation"
  CHECK ("permission" <> 'members.roles');
-- Keep historical invitations for audit. Runtime acceptance also checks the issuer.
UPDATE "OrganizationInvitation" AS i SET "revokedAt" = CURRENT_TIMESTAMP
WHERE i."role" = 'ORGANIZATION_ADMIN' AND i."acceptedAt" IS NULL
  AND i."revokedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "User" AS u WHERE u."id" = i."createdBy" AND u."master" = true);
