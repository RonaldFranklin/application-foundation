import { OrganizationPermission as DbPermission } from "@prisma/client";
import { OrganizationPermission } from "../../../application/organizations/permissions";
import { PermissionsRepository } from "../../../application/organizations/ports/permissions.repository";
import { persist, QueryClient } from "./records";
const stored: Record<OrganizationPermission, DbPermission> = {
  "organization.read": "ORGANIZATION_READ",
  "organization.update": "ORGANIZATION_UPDATE",
  "members.read": "MEMBERS_READ",
  "members.create": "MEMBERS_CREATE",
  "members.link": "MEMBERS_LINK",
  "members.roles": "MEMBERS_ROLES",
  "members.remove": "MEMBERS_REMOVE",
  "permissions.manage": "PERMISSIONS_MANAGE",
};
export class PrismaPermissionsRepository implements PermissionsRepository {
  constructor(private db: QueryClient) {}
  list(organizationId: string) {
    return persist(async () =>
      (
        await this.db.organizationPermissionGrant.findMany({
          where: { organizationId, role: "MEMBER" },
        })
      ).map((row) =>
        (Object.keys(stored) as OrganizationPermission[]).find(
          (key) => stored[key] === row.permission,
        )!,
      ),
    );
  }
  replace(organizationId: string, permissions: OrganizationPermission[]) {
    return persist(async () => {
      await this.db.organizationPermissionGrant.deleteMany({
        where: { organizationId, role: "MEMBER" },
      });
      await this.db.organizationPermissionGrant.createMany({
        data: permissions.map((permission) => ({
          organizationId,
          role: "MEMBER",
          permission: stored[permission],
        })),
      });
    });
  }
}
