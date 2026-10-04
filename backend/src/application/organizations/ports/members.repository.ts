import { AuthTransaction } from "../../auth/ports/repositories";
import {
  OrganizationMember,
  OrganizationRole,
} from "../../../domain/organizations/models";
export interface MembersRepository {
  list(organizationId: string): Promise<OrganizationMember[]>;
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
  remove(organizationId: string, userId: string): Promise<number>;
}
export interface MembersTransaction extends AuthTransaction {
  members: MembersRepository;
}
