-- Absence of grants means MEMBER has no permissions, for existing and new organizations.
-- ORGANIZATION_ADMIN remains an immutable application policy; no users are promoted.
CREATE TYPE "OrganizationPermission" AS ENUM ('organization.read', 'organization.update', 'members.read', 'members.create', 'members.link', 'members.roles', 'members.remove', 'permissions.manage');
CREATE TABLE "OrganizationPermissionGrant" (
  "organizationId" TEXT NOT NULL,
  "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
  "permission" "OrganizationPermission" NOT NULL,
  CONSTRAINT "OrganizationPermissionGrant_pkey" PRIMARY KEY ("organizationId", "role", "permission"),
  CONSTRAINT "OrganizationPermissionGrant_member_only" CHECK ("role" = 'MEMBER'),
  CONSTRAINT "OrganizationPermissionGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
