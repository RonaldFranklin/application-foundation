import { OrganizationsRepository } from "./organizations.repository";
import { PermissionsRepository } from "./permissions.repository";
import { AuthTransaction } from "../../auth/ports/repositories";
import {
  OrganizationMember,
  OrganizationRole,
} from "../../../domain/organizations/models";
export interface MembersRepository {
  role(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationRole | null>;
  memberships(
    userId: string,
  ): Promise<{ organizationId: string; role: OrganizationRole }[]>;
  countAdmins(organizationId: string): Promise<number>;
  list(
    organizationId: string,
    deleted?: boolean,
  ): Promise<OrganizationMember[]>;
  exists(organizationId: string, userId: string): Promise<boolean>;
  insert(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ): Promise<number>;
  update(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ): Promise<number>;
  setDeletedAt(
    organizationId: string,
    userId: string,
    deletedAt: Date | null,
  ): Promise<number>;
  find(
    organizationId: string,
    userId: string,
  ): Promise<{ role: OrganizationRole; deletedAt: Date | null } | null>;
}
export interface MembersTransaction extends AuthTransaction {
  members: MembersRepository;
  organizations: Pick<OrganizationsRepository, "find" | "update" | "create">;
  permissions: PermissionsRepository;
}
