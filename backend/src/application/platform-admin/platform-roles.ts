import { z } from "zod";
import { UnitOfWork } from "../auth/ports/repositories";
import { Sessions } from "../auth/use-cases/sessions";
import { recordAudit } from "../audit/events";
import { normalize } from "../auth/validators/auth-input";
import { PlatformTransaction } from "./ports";
import { platformGrantsSchema, platformPermissionCatalog } from "./permissions";
const roleInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(
        (name) =>
          ![
            "master",
            "platform-admin",
            "platform_admin",
            "organization_admin",
            "member",
          ].includes(normalize(name)),
      ),
    permissions: platformGrantsSchema,
    version: z.number().int().positive().optional(),
  })
  .strict();
const fail = (
  error: "FORBIDDEN" | "INPUT_INVALID" | "ROLE_CONFLICT" | "ROLE_IN_USE",
) => ({ error });
export class PlatformRoles {
  constructor(
    private work: UnitOfWork<PlatformTransaction>,
    private sessions: Sessions,
  ) {}
  private run<T>(
    raw: string | undefined,
    action: (tx: PlatformTransaction, actorId: string) => Promise<T>,
  ) {
    return this.work.run(
      async (tx) => {
        await tx.lock("platform-access");
        const actor = await this.sessions.authorized(raw, true, tx.sessions);
        if (!actor) return fail("FORBIDDEN");
        return action(tx, actor.userId);
      },
      { maxWait: 15000, timeout: 15000 },
    );
  }
  list(raw: string | undefined) {
    return this.run(raw, async (tx) => ({
      roles: (await tx.platformAdmins.roles()).map(
        ({ id, name, permissions, version }) => ({
          id,
          name,
          permissions,
          version,
        }),
      ),
      catalog: platformPermissionCatalog,
    }));
  }
  save(raw: string | undefined, body: unknown, id?: string) {
    return this.run(raw, async (tx, actorId) => {
      const input = roleInput.safeParse(body);
      if (!input.success || (id && !z.uuid().safeParse(id).success))
        return fail("INPUT_INVALID");
      id = id?.toLowerCase();
      const roles = await tx.platformAdmins.roles();
      const previous = roles.find((r) => r.id === id);
      if (
        id
          ? !previous || previous.version !== input.data.version
          : input.data.version !== undefined || roles.length >= 50
      )
        return fail("ROLE_CONFLICT");
      const nameKey = normalize(input.data.name);
      if (roles.some((r) => r.id !== id && r.nameKey === nameKey))
        return fail("ROLE_CONFLICT");
      const changed =
        !previous ||
        previous.permissions.length !== input.data.permissions.length ||
        previous.permissions.some(
          (p) =>
            !input.data.permissions.includes(
              p as (typeof input.data.permissions)[number],
            ),
        );
      // Policy is applied here; repositories only persist the resolved grants.
      const accounts =
        changed && id
          ? (await tx.platformAdmins.list())
              .filter((a) => a.user.platformAdmin?.roleId === id)
              .sort((a, b) => a.user.id.localeCompare(b.user.id))
          : [];
      for (const account of accounts)
        await tx.lock(`account:${account.user.id}`);
      if (!(await this.sessions.authorized(raw, true, tx.sessions)))
        return fail("FORBIDDEN");
      const role = await tx.platformAdmins.saveRole(
        { name: input.data.name, nameKey, permissions: input.data.permissions },
        id,
      );
      for (const account of accounts) {
        if (account.user.master) throw new Error("INCOMPATIBLE_ACCOUNT_SCOPE");
        await tx.platformAdmins.save(
          account.user.id,
          account.active,
          role.permissions,
          role.id,
        );
        await tx.sessions.deleteForUser(account.user.id);
        await tx.sessions.deleteDevicesForUser(account.user.id);
      }
      if (changed && id)
        for (const invitation of await tx.platformAdmins.invitations()) {
          if (
            invitation.roleId === id &&
            !invitation.acceptedAt &&
            !invitation.revokedAt
          ) {
            await tx.platformAdmins.saveInvitation({
              ...invitation,
              permissions: role.permissions,
            });
          }
        }
      await recordAudit(tx, {
        action: id ? "platform_role.updated" : "platform_role.created",
        actorId,
        resourceId: role.id,
      });
      return { saved: true };
    });
  }
  remove(raw: string | undefined, id: string, body: unknown) {
    return this.run(raw, async (tx, actorId) => {
      const input = z
        .object({ version: z.number().int().positive() })
        .strict()
        .safeParse(body);
      if (!input.success || !z.uuid().safeParse(id).success)
        return fail("INPUT_INVALID");
      id = id.toLowerCase();
      const role = await tx.platformAdmins.role(id);
      if (!role || role.version !== input.data.version)
        return fail("ROLE_CONFLICT");
      if (
        (await tx.platformAdmins.list()).some(
          (a) => a.user.platformAdmin?.roleId === id,
        ) ||
        (await tx.platformAdmins.invitations()).some((i) => i.roleId === id)
      )
        return fail("ROLE_IN_USE");
      await tx.platformAdmins.deleteRole(id);
      await recordAudit(tx, {
        action: "platform_role.deleted",
        actorId,
        resourceId: id,
      });
      return { saved: true };
    });
  }
  assign(
    raw: string | undefined,
    id: string,
    body: unknown,
    invitation: boolean,
  ) {
    return this.run(raw, async (tx, actorId) => {
      const input = z
        .object({ roleId: z.uuid().nullable() })
        .strict()
        .safeParse(body);
      if (!input.success || !z.uuid().safeParse(id).success)
        return fail("INPUT_INVALID");
      id = id.toLowerCase();
      const roleId = input.data.roleId?.toLowerCase() ?? null;
      const role = roleId ? await tx.platformAdmins.role(roleId) : null;
      if (roleId && !role) return fail("ROLE_CONFLICT");
      if (invitation) {
        const target = await tx.platformAdmins.invitation(id);
        if (!target || target.acceptedAt || target.revokedAt)
          return fail("FORBIDDEN");
        await tx.platformAdmins.saveInvitation({
          ...target,
          roleId,
          permissions: role?.permissions ?? target.permissions,
        });
      } else {
        await tx.lock(`account:${id}`);
        if (!(await this.sessions.authorized(raw, true, tx.sessions)))
          return fail("FORBIDDEN");
        const target = await tx.identities.findById(id);
        if (!target?.platformAdmin || target.master) return fail("FORBIDDEN");
        await tx.platformAdmins.save(
          id,
          target.platformAdmin.active,
          role?.permissions ?? target.platformAdmin.permissions,
          roleId,
        );
        await tx.sessions.deleteForUser(id);
        await tx.sessions.deleteDevicesForUser(id);
      }
      await recordAudit(tx, {
        action: invitation
          ? "platform_invitation.role_assigned"
          : "platform_admin.role_assigned",
        actorId,
        resourceId: id,
        metadata: { roleId },
      });
      return { saved: true };
    });
  }
}
