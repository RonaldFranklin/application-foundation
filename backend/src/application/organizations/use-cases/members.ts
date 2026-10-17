import { recordAudit } from "../../audit/events";
import { z } from "zod";
import { IdentityProtection } from "../../auth/ports/security";
import { normalize } from "../../auth/validators/auth-input";
import { organizationRoles } from "../../../domain/organizations/models";
import { OrganizationAccess } from "./organization-access";
const role = z.enum(organizationRoles);
const listSchema = z
  .object({
    deleted: z.enum(["true", "false"]).default("false"),
    search: z.string().max(254).transform(normalize).default(""),
    role: role.optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();
export class Members {
  constructor(
    private access: OrganizationAccess,
    private vault: IdentityProtection,
  ) {}
  async list(
    raw: string | undefined,
    id: unknown,
    query: unknown = {},
    masterOnly = true,
  ) {
    return this.access.run(id, async (tx) => {
      const access = await this.access.check(
        tx,
        raw,
        id,
        "members.read",
        masterOnly,
      );
      if (!access || !("organization" in access)) return access;
      const input = listSchema.safeParse(query);
      if (!input.success) return { invalid: "list" as const };
      const { search, role, page, pageSize, deleted } = input.data;
      if (deleted === "true" && !access.master)
        return { forbidden: true as const };
      // Identity columns are encrypted: search only decrypted identities from this authorized organization.
      const items = (
        await tx.members.list(access.organization.id, deleted === "true")
      )
        .map((member) => ({
          ...member,
          canResetCredentials: access.master
            ? member.userId !== access.userId
            : access.role === "ORGANIZATION_ADMIN" &&
              member.role === "MEMBER" &&
              !member.deletedAt,
          organization: {
            id: access.organization.id,
            name: access.organization.name,
          },
          username: this.vault.decrypt(member.username, "username"),
          email: this.vault.decrypt(member.email, "email"),
        }))
        .filter(
          (member) =>
            (!role || member.role === role) &&
            (!search ||
              normalize(member.username).includes(search) ||
              normalize(member.email).includes(search)),
        );
      return {
        resetRequiresMfa: !!(await tx.identities.findById(access.userId))
          ?.totpVerified,
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        page,
        pageSize,
      };
    });
  }
  async add(
    raw: string | undefined,
    id: unknown,
    body: unknown,
    masterOnly = true,
  ) {
    void body;
    return this.access.run(id, async (tx) => {
      const access = await this.access.check(
        tx,
        raw,
        id,
        undefined,
        masterOnly,
      );
      if (!access || !("organization" in access)) return access;
      return { invitationRequired: true as const };
    });
  }

  async restore(
    raw: string | undefined,
    id: unknown,
    userId: unknown,
    body: unknown,
  ) {
    return this.access.run(id, async (tx) => {
      const access = await this.access.check(
        tx,
        raw,
        id,
        undefined,
        true,
        false,
        true,
      );
      if (!access || !("organization" in access)) return access;
      if (!z.uuid().safeParse(userId).success)
        return { missing: true as const };
      if (!z.object({}).strict().safeParse(body).success)
        return { invalid: "restore" as const };
      const member = await tx.members.find(
        access.organization.id,
        (userId as string).toLowerCase(),
      );
      if (!member) return { missing: true as const };
      if (member.deletedAt) {
        await tx.lock(`account:${(userId as string).toLowerCase()}`);
        if (
          (await tx.members.memberships((userId as string).toLowerCase())).some(
            (m) => m.organizationId !== access.organization.id,
          )
        )
          return { membershipConflict: true as const };
        await tx.members.setDeletedAt(
          access.organization.id,
          (userId as string).toLowerCase(),
          null,
        );
        await recordAudit(tx, {
          action: "member.restored",
          actorId: access.userId,
          organizationId: access.organization.id,
          resourceId: (userId as string).toLowerCase(),
        });
      }
      return { saved: true as const };
    });
  }

  async update(
    raw: string | undefined,
    id: unknown,
    userId: unknown,
    body: unknown,
    remove = false,
    masterOnly = true,
  ) {
    return this.access.run(id, async (tx) => {
      const access = await this.access.check(
        tx,
        raw,
        id,
        remove ? "members.remove" : "members.roles",
        masterOnly,
        false,
        true,
      );
      if (!access || !("organization" in access)) return access;
      if (!z.uuid().safeParse(userId).success)
        return { missing: true as const };
      const input = (
        remove ? z.object({}).strict() : z.object({ role }).strict()
      ).safeParse(body);
      if (!input.success)
        return { invalid: remove ? ("remove" as const) : ("role" as const) };
      const previous = await tx.members.role(
        access.organization.id,
        (userId as string).toLowerCase(),
      );
      if (!previous) return { missing: true as const };
      if (
        previous === "ORGANIZATION_ADMIN" &&
        (remove || ("role" in input.data && input.data.role === "MEMBER")) &&
        (await tx.members.countAdmins(access.organization.id)) <= 1
      )
        return { lastAdmin: true as const };
      if (
        !access.master &&
        previous === "ORGANIZATION_ADMIN" &&
        (userId as string).toLowerCase() === access.userId &&
        (remove || ("role" in input.data && input.data.role === "MEMBER"))
      )
        return { selfAdmin: true as const };
      const count =
        "role" in input.data
          ? await tx.members.update(
              access.organization.id,
              (userId as string).toLowerCase(),
              input.data.role,
            )
          : await tx.members.setDeletedAt(
              access.organization.id,
              (userId as string).toLowerCase(),
              new Date(),
            );
      if (
        count &&
        (remove || ("role" in input.data && previous !== input.data.role))
      )
        await recordAudit(tx, {
          action: remove ? "member.removed" : "member.role_changed",
          actorId: access.userId,
          organizationId: access.organization.id,
          resourceId: (userId as string).toLowerCase(),
          metadata:
            "role" in input.data
              ? { previousRole: previous, role: input.data.role }
              : {},
        });
      return count ? { saved: true as const } : { missing: true as const };
    });
  }
}
