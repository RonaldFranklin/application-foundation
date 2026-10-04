import { UnitOfWork } from "../../auth/ports/repositories";
import { z } from "zod";
import { Sessions } from "../../auth/use-cases/sessions";
import { IdentityProtection, Passwords } from "../../auth/ports/security";
import {
  normalize,
  passwordSchema,
  profileSchema,
} from "../../auth/validators/auth-input";
import { organizationRoles } from "../../../domain/organizations/models";
import {
  MembersRepository,
  MembersTransaction,
} from "../ports/members.repository";
import { OrganizationsRepository } from "../ports/organizations.repository";
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
export class Members {
  constructor(
    private sessions: Sessions,
    private organizations: OrganizationsRepository,
    private records: MembersRepository,
    private vault: IdentityProtection,
    private passwords: Passwords,
    private work: UnitOfWork<MembersTransaction>,
  ) {}
  private async access(raw: string | undefined, id: unknown) {
    if (!(await this.sessions.authorized(raw, true))) return null;
    if (
      !z.uuid().safeParse(id).success ||
      !(await this.organizations.find(id as string))
    )
      return { missing: true as const };
    return { id: id as string };
  }
  async list(raw: string | undefined, id: unknown) {
    const access = await this.access(raw, id);
    if (!access || "missing" in access) return access;
    const records = await this.records.list(access.id);
    return {
      items: records.map((member) => ({
        ...member,
        username: this.vault.decrypt(member.username, "username"),
        email: this.vault.decrypt(member.email, "email"),
      })),
    };
  }
  async add(raw: string | undefined, id: unknown, body: unknown) {
    const access = await this.access(raw, id);
    if (!access || "missing" in access) return access;
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
    const emailIndex = this.vault.index(data.email);
    const passwordHash =
      data.mode === "new"
        ? await this.passwords.run(() => this.passwords.hash(data.password))
        : undefined;
    if (passwordHash === null) return { busy: true as const };
    if (!(await this.sessions.authorized(raw, true))) return null;
    return this.work.run(async (tx) => {
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
            conflict: (await tx.members.exists(access.id, collision.id))
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
      const count = await tx.members.insert(access.id, user.id, data.role);
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
  ) {
    const access = await this.access(raw, id);
    if (!access || "missing" in access) return access;
    if (!z.uuid().safeParse(userId).success) return { missing: true as const };
    const input = (
      remove ? z.object({}).strict() : z.object({ role }).strict()
    ).safeParse(body);
    if (!input.success)
      return { invalid: remove ? ("remove" as const) : ("role" as const) };
    const count =
      "role" in input.data
        ? await this.records.update(
            access.id,
            userId as string,
            input.data.role,
          )
        : await this.records.remove(access.id, userId as string);
    return count ? { saved: true as const } : { missing: true as const };
  }
}
