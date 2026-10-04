import { z } from "zod";
import { IdentityProtection, Passwords } from "../../auth/ports/security";
import {
  normalize,
  passwordSchema,
  profileSchema,
} from "../../auth/validators/auth-input";
import { organizationRoles } from "../../../domain/organizations/models";
import { OrganizationAccess } from "./organization-access";
const role = z.enum(organizationRoles);
const email = z
  .string()
  .max(254)
  .transform(normalize)
  .pipe(profileSchema.shape.email);
const addSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("existing"),
      email,
      role: role.default("MEMBER"),
    })
    .strict(),
  z
    .object({
      mode: z.literal("new"),
      email,
      username: z
        .string()
        .max(100)
        .transform(normalize)
        .pipe(profileSchema.shape.username),
      password: passwordSchema.shape.password,
      role: role.default("MEMBER"),
    })
    .strict(),
]);
const listSchema = z
  .object({
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
    private passwords: Passwords,
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
      const { search, role, page, pageSize } = input.data;
      // Identity columns are encrypted: search only decrypted identities from this authorized organization.
      const items = (await tx.members.list(access.organization.id))
        .map((member) => ({
          ...member,
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
    const initial = await this.access.run(id, (tx) =>
      this.access.check(tx, raw, id, undefined, masterOnly),
    );
    if (!initial || !("organization" in initial)) return initial;
    const input = addSchema.safeParse(body);
    if (!input.success) {
      const mode =
        body && typeof body === "object" && "mode" in body
          ? body.mode
          : undefined;
      return {
        invalid:
          mode === "new"
            ? ("new" as const)
            : mode === "existing"
              ? ("existing" as const)
              : ("request" as const),
      };
    }
    const data = input.data;
    const permission = data.mode === "new" ? "members.create" : "members.link";
    if (
      !initial.permissions.includes(permission) ||
      (data.role === "ORGANIZATION_ADMIN" &&
        !initial.permissions.includes("members.roles"))
    )
      return { forbidden: true as const };
    const emailIndex = this.vault.index(data.email);
    const passwordHash =
      data.mode === "new"
        ? await this.passwords.run(() => this.passwords.hash(data.password))
        : undefined;
    if (passwordHash === null) return { busy: true as const };
    return this.access.run(id, async (tx) => {
      const access = await this.access.check(
        tx,
        raw,
        id,
        permission,
        masterOnly,
      );
      if (!access || !("organization" in access)) return access;
      if (
        data.role === "ORGANIZATION_ADMIN" &&
        !access.permissions.includes("members.roles")
      )
        return { forbidden: true as const };
      // Serializes both identifier namespaces with bootstrap and profile edits.
      await tx.lock("identity-update");
      let user = await tx.identities.findByIndex(emailIndex, false);
      if (data.mode === "new") {
        const usernameIndex = this.vault.index(data.username);
        const collision = await tx.identities.findCollision(
          usernameIndex,
          emailIndex,
        );
        if (collision)
          return {
            conflict: (await tx.members.exists(
              access.organization.id,
              collision.id,
            ))
              ? ("membership" as const)
              : ("identity" as const),
          };
        await tx.identities.create({
          username: this.vault.encrypt(data.username, "username"),
          email: this.vault.encrypt(data.email, "email"),
          usernameIndex,
          emailIndex,
          passwordHash: passwordHash!,
          master: false,
          mustChangePassword: true,
        });
        user = await tx.identities.findByIndex(emailIndex, false);
        if (!user) throw new Error("Conta criada indisponível.");
      }
      // Only an exact normalized email of a common account may be linked.
      if (!user || user.master || user.emailIndex !== emailIndex)
        return { unavailable: true as const };
      const count = await tx.members.insert(
        access.organization.id,
        user.id,
        data.role,
      );
      return count
        ? { saved: true as const }
        : { conflict: "membership" as const };
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
        userId as string,
      );
      if (!previous) return { missing: true as const };
      if (
        previous === "ORGANIZATION_ADMIN" &&
        (remove || ("role" in input.data && input.data.role === "MEMBER")) &&
        (await tx.members.countAdmins(access.organization.id)) <= 1
      )
        return { lastAdmin: true as const };
      const count =
        "role" in input.data
          ? await tx.members.update(
              access.organization.id,
              userId as string,
              input.data.role,
            )
          : await tx.members.remove(access.organization.id, userId as string);
      return count ? { saved: true as const } : { missing: true as const };
    });
  }
}
