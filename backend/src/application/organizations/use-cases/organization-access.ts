import {
  Organization,
  OrganizationRole,
} from "../../../domain/organizations/models";
import { z } from "zod";
import { Sessions } from "../../auth/use-cases/sessions";
import { UnitOfWork } from "../../auth/ports/repositories";
import { MembersTransaction } from "../ports/members.repository";
import { OrganizationPermission, permissionKeys } from "../permissions";
type AccessResult =
  | null
  | { forbidden: true }
  | { missing: true }
  | {
      organization: Organization;
      permissions: OrganizationPermission[];
      role: OrganizationRole | null;
      master: boolean;
      userId: string;
    };
export class OrganizationAccess {
  constructor(
    private sessions: Sessions,
    private work: UnitOfWork<MembersTransaction>,
  ) {}
  async check(
    tx: MembersTransaction,
    raw: string | undefined,
    id: unknown,
    permission?: OrganizationPermission,
    masterOnly = true,
  ): Promise<AccessResult> {
    const session = await this.sessions.authorized(
      raw,
      masterOnly ? true : undefined,
      tx.sessions,
    );
    if (!session) return null;
    if (!z.uuid().safeParse(id).success)
      return session.user.master ? { missing: true } : { forbidden: true };
    const organizationId = (id as string).toLowerCase();
    const role = session.user.master
      ? null
      : await tx.members.role(organizationId, session.userId);
    const permissions =
      session.user.master || role === "ORGANIZATION_ADMIN"
        ? [...permissionKeys]
        : role === "MEMBER"
          ? await tx.permissions.list(organizationId)
          : [];
    if (permission ? !permissions.includes(permission) : !permissions.length)
      return { forbidden: true as const };
    const organization = await tx.organizations.find(organizationId);
    if (!organization) return { missing: true as const };
    return {
      organization,
      permissions,
      role,
      master: session.user.master,
      userId: session.userId,
    };
  }
  run<T>(id: unknown, action: (tx: MembersTransaction) => Promise<T>) {
    return this.work.run(
      async (tx) => {
        // All membership, grant and organization mutations share this lock, including authorization.
        // Normalize UUID route identifiers so equivalent spellings share a lock.
        if (typeof id === "string")
          await tx.lock(`organization:${id.toLowerCase()}`);
        return action(tx);
      },
      { maxWait: 15000, timeout: 15000 },
    );
  }
  describe(raw: string | undefined, id: unknown, masterOnly = true) {
    return this.run(id, async (tx) => {
      const access = await this.check(tx, raw, id, undefined, masterOnly);
      if (!access || !("organization" in access)) return access;
      return {
        id: access.organization.id,
        name: access.organization.name,
        active: access.organization.active,
        permissions: access.permissions,
      };
    });
  }
  async directory(raw: string | undefined) {
    return this.work.run(async (tx) => {
      const session = await this.sessions.authorized(raw, false, tx.sessions);
      if (!session) return null;
      const memberships = await tx.members.memberships(session.userId);
      const items = [];
      for (const membership of memberships) {
        const access = await this.check(
          tx,
          raw,
          membership.organizationId,
          undefined,
          false,
        );
        if (access && "organization" in access)
          items.push({
            id: access.organization.id,
            name: access.organization.name,
            active: access.organization.active,
            permissions: access.permissions,
          });
      }
      return { items };
    });
  }
}
