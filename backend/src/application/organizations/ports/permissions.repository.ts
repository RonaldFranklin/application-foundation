import { OrganizationPermission } from "../permissions";
export interface PermissionsRepository {
  list(organizationId: string): Promise<OrganizationPermission[]>;
  replace(
    organizationId: string,
    permissions: OrganizationPermission[],
  ): Promise<void>;
}
