import { PlatformPermission } from "../../platform-admin/permissions";
import { attemptAudit } from "../../audit/events";
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
    includeDeleted = false,
    auditDenied = false,
    platformPermission?: PlatformPermission,
  ): Promise<AccessResult> {
    let session = await this.sessions.authorized(raw, undefined, tx.sessions);
    if (!session) return null;
    const denied = async () => {
      if (auditDenied && session)
        await attemptAudit(tx, {
          action: "administration.denied",
          actorId: session.userId,
          resourceId: session.userId,
          metadata: {
            permission: masterOnly
              ? "master"
              : (permission ?? "organization.access"),
          },
        });
    };
    if (session.user.platformAdmin) {
      await tx.lock("platform-access");
      session = await this.sessions.authorized(raw, undefined, tx.sessions);
      if (!session?.user.platformAdmin) return null;
      const required =
        platformPermission ??
        (permission === "organization.read"
          ? "organizations.read"
          : permission === "organization.update"
            ? "organizations.update"
            : !permission && !includeDeleted
              ? "organizations.read"
              : undefined);
      if (
        !masterOnly ||
        !required ||
        !(await this.sessions.administrative(raw, required, tx.sessions))
      )
        return { forbidden: true };
      if (!z.uuid().safeParse(id).success) return { missing: true };
      const organization = await tx.organizations.find(
        (id as string).toLowerCase(),
      );
      if (!organization || (organization.deletedAt && !includeDeleted))
        return { missing: true };
      return {
        organization,
        permissions: session.user.platformAdmin.permissions.flatMap((p) =>
          p === "organizations.read"
            ? ["organization.read" as const]
            : p === "organizations.update"
              ? ["organization.update" as const]
              : [],
        ),
        role: null,
        master: false,
        userId: session.userId,
      };
    }
    if (masterOnly && !session.user.master) {
      await denied();
      return null;
    }
    if (!z.uuid().safeParse(id).success)
      return session.user.master ? { missing: true } : { forbidden: true };
    const organizationId = (id as string).toLowerCase();
    if (!session.user.master) {
      const memberships = await tx.members.memberships(session.userId);
      if (
        memberships.length !== 1 ||
        memberships[0].organizationId !== organizationId
      ) {
        await denied();
        return { forbidden: true };
      }
    }
    const role = session.user.master
      ? null
      : await tx.members.role(organizationId, session.userId);
    const permissions =
      session.user.master || role === "ORGANIZATION_ADMIN"
        ? [...permissionKeys]
        : role === "MEMBER"
          ? await tx.permissions.list(organizationId)
          : [];
    if (permission ? !permissions.includes(permission) : !permissions.length) {
      await denied();
      return { forbidden: true as const };
    }
    const organization = await tx.organizations.find(organizationId);
    if (
      !organization ||
      (organization.deletedAt && !(includeDeleted && session.user.master)) ||
      (!session.user.master && !organization.active)
    )
      return session.user.master
        ? { missing: true as const }
        : { forbidden: true as const };
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
        role: access.role,
        userId: access.userId,
      };
    });
  }
  async directory(raw: string | undefined) {
    return this.work.run(async (tx) => {
      const session = await this.sessions.authorized(raw, false, tx.sessions);
      if (!session) return null;
      const memberships = await tx.members.memberships(session.userId);
      if (memberships.length > 1) return { forbidden: true as const };
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
            role: access.role,
            userId: access.userId,
          });
      }
      return { items };
    });
  }
}
