import { z } from "zod";
import { UnitOfWork } from "../auth/ports/repositories";
import { IdentityProtection, Passwords } from "../auth/ports/security";
import { Sessions } from "../auth/use-cases/sessions";
import {
  normalize,
  passwordSchema,
  profileSchema,
} from "../auth/validators/auth-input";
import { OrganizationAccess } from "../organizations/use-cases/organization-access";
import { organizationRoles } from "../../domain/organizations/models";
import {
  Invitation,
  InvitationPublisher,
  InvitationSecrets,
  InvitationsTransaction,
  invitationContext,
  invitationEmailPurpose,
} from "./ports";
const issueSchema = z
  .object({
    email: z
      .string()
      .max(254)
      .transform(normalize)
      .pipe(profileSchema.shape.email),
    role: z.enum(organizationRoles).default("MEMBER"),
  })
  .strict();
const tokenSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/)
  .max(80);
const previewSchema = z.object({ token: tokenSchema }).strict();
const acceptSchema = z.discriminatedUnion("mode", [
  z.object({ token: tokenSchema, mode: z.literal("existing") }).strict(),
  z
    .object({
      token: tokenSchema,
      mode: z.literal("new"),
      username: z
        .string()
        .max(100)
        .transform(normalize)
        .pipe(profileSchema.shape.username),
      password: passwordSchema.shape.password,
      confirmPassword: z.string().max(1024),
    })
    .strict()
    .refine((v) => v.password === v.confirmPassword),
]);
export const invitationMessages = {
  INPUT_INVALID: "Revise os dados do convite.",
  SESSION_REQUIRED:
    "Entre na conta correspondente ao convite e tente novamente.",
  FORBIDDEN:
    "Você não tem permissão para gerenciar convites nesta organização.",
  INVITATION_INVALID:
    "Convite inválido ou substituído. Solicite um novo convite.",
  INVITATION_EXPIRED: "Este convite expirou. Solicite um novo convite.",
  INVITATION_REVOKED: "Este convite foi cancelado. Solicite um novo convite.",
  INVITATION_USED: "Este convite já foi aceito. Entre pelo login normal.",
  INVITATION_PENDING:
    "Já existe um convite pendente para este endereço nesta organização.",
  ACCEPT_UNAVAILABLE:
    "Não foi possível aceitar. Confira seus dados ou entre na conta correspondente. Um vínculo removido deve ser restaurado pelo Master.",
  UNAVAILABLE:
    "Não foi possível enfileirar o convite. Tente novamente mais tarde.",
  RATE_LIMIT: "Aguarde antes de enviar outro convite.",
} as const;
export type InvitationError = keyof typeof invitationMessages;
const failure = (error: InvitationError, retryAfter?: number) => ({
  error,
  ...(retryAfter ? { retryAfter } : {}),
});
export class Invitations {
  constructor(
    private work: UnitOfWork<InvitationsTransaction>,
    private access: OrganizationAccess,
    private sessions: Sessions,
    private vault: IdentityProtection,
    private passwords: Passwords,
    private secrets: InvitationSecrets,
    private publisher: InvitationPublisher,
    private now: () => number = Date.now,
  ) {}
  private run<T>(
    id: string,
    action: (tx: InvitationsTransaction) => Promise<T>,
  ) {
    return this.work.run(
      async (tx) => {
        await tx.lock(`organization:${id}`);
        return action(tx);
      },
      { maxWait: 15000, timeout: 15000 },
    );
  }
  private async authorize(
    tx: InvitationsTransaction,
    raw: string | undefined,
    id: string,
    masterOnly: boolean,
    write: boolean,
  ) {
    const a = await this.access.check(
      tx,
      raw,
      id,
      write ? "members.create" : "members.read",
      masterOnly,
    );
    if (!a) return failure("SESSION_REQUIRED");
    if (
      !("organization" in a) ||
      !a.organization.active ||
      a.organization.deletedAt ||
      (write && !a.permissions.includes("members.link"))
    )
      return failure("FORBIDDEN");
    return a;
  }
  async list(raw: string | undefined, id: string, masterOnly: boolean) {
    id = id.toLowerCase();
    return this.run(id, async (tx) => {
      const a = await this.authorize(tx, raw, id, masterOnly, false);
      if ("error" in a) return a;
      const items = await tx.invitations.pending(id, new Date(this.now()));
      return {
        items: items.map((i) => ({
          id: i.id,
          email: this.vault.decrypt(i.email, invitationEmailPurpose(i)),
          role: i.role,
          expiresAt: i.expiresAt,
          createdAt: i.createdAt,
        })),
      };
    });
  }
  private async budget(
    tx: InvitationsTransaction,
    id: string,
    fingerprint: string,
  ) {
    const now = this.now();
    const keys = [
      `invitation-address:${id}:${fingerprint}`,
      `invitation-org:${id}`,
    ];
    const hits = await Promise.all(
      keys.map(async (key) =>
        ((await tx.rates.find(key))?.hits ?? []).filter(
          (d) => +d > now - 86400000,
        ),
      ),
    );
    const recent = hits[0].at(-1);
    if (recent && +recent + 60000 > now)
      return Math.ceil((+recent + 60000 - now) / 1000);
    if (hits[0].length >= 20)
      return Math.ceil((+hits[0][0] + 86400000 - now) / 1000);
    const hour = hits[0].filter((d) => +d > now - 3600000);
    const org = hits[1].filter((d) => +d > now - 3600000);
    if (hour.length >= 5) return Math.ceil((+hour[0] + 3600000 - now) / 1000);
    if (org.length >= 100) return Math.ceil((+org[0] + 3600000 - now) / 1000);
    await tx.rates.saveHits(keys[0], [...hits[0], new Date(now)]);
    await tx.rates.saveHits(keys[1], [...org, new Date(now)]);
    return 0;
  }
  async issue(
    raw: string | undefined,
    id: string,
    body: unknown,
    masterOnly: boolean,
    resendId?: string,
  ) {
    id = id.toLowerCase();
    const prepared = await this.run(id, async (tx) => {
      const a = await this.authorize(tx, raw, id, masterOnly, true);
      if ("error" in a) return a;
      const input = resendId
        ? z.object({}).strict().safeParse(body)
        : issueSchema.safeParse(body);
      if (!input.success || (resendId && !z.uuid().safeParse(resendId).success))
        return failure("INPUT_INVALID");
      const data = resendId ? null : issueSchema.parse(body);
      const fingerprint = data ? this.vault.index(data.email) : "";
      const previous = resendId
        ? await tx.invitations.find(id, resendId.toLowerCase())
        : await tx.invitations.forEmail(id, fingerprint);
      if (resendId && (!previous || previous.acceptedAt || previous.revokedAt))
        return failure("INVITATION_INVALID");
      if (
        !resendId &&
        previous &&
        !previous.acceptedAt &&
        !previous.revokedAt &&
        +previous.expiresAt > this.now()
      )
        return failure("INVITATION_PENDING");
      if (previous?.acceptedAt) return failure("INVITATION_USED");
      const role = data?.role ?? previous!.role;
      if (
        role === "ORGANIZATION_ADMIN" &&
        !a.permissions.includes("members.roles")
      )
        return failure("FORBIDDEN");
      const retry = await this.budget(
        tx,
        id,
        data ? fingerprint : previous!.emailFingerprint,
      );
      if (retry) return failure("RATE_LIMIT", retry);
      const generated = this.secrets.generate();
      const i: Invitation = {
        id: previous?.id ?? generated.id,
        organizationId: id,
        email: "",
        emailFingerprint: data ? fingerprint : previous!.emailFingerprint,
        role,
        digest: "",
        createdBy: a.userId,
        createdAt: new Date(this.now()),
        expiresAt: new Date(this.now() + 7 * 86400000),
        acceptedAt: null,
        revokedAt: null,
        deliveredAt: null,
      };
      i.email = data
        ? this.vault.encrypt(data.email, invitationEmailPurpose(i))
        : previous!.email;
      i.digest = this.secrets.digest(generated.token, invitationContext(i));
      await tx.invitations.save(i);
      return {
        i,
        job: {
          invitationId: i.id,
          encryptedToken: this.secrets.encrypt(
            generated.token,
            invitationContext(i),
          ),
        },
      };
    });
    if ("error" in prepared) return prepared;
    try {
      await this.publisher.publish(prepared.job);
    } catch {
      await this.run(id, async (tx) => {
        const current = await tx.invitations.find(id, prepared.i.id);
        if (
          current &&
          current.digest === prepared.i.digest &&
          !current.acceptedAt
        ) {
          current.revokedAt = new Date(this.now());
          await tx.invitations.save(current);
        }
      });
      return failure("UNAVAILABLE");
    }
    return { queued: true, expiresAt: prepared.i.expiresAt };
  }
  async revoke(
    raw: string | undefined,
    id: string,
    invitationId: string,
    body: unknown,
    masterOnly: boolean,
  ) {
    id = id.toLowerCase();
    return this.run(id, async (tx) => {
      const a = await this.authorize(tx, raw, id, masterOnly, true);
      if ("error" in a) return a;
      if (
        !z.uuid().safeParse(invitationId).success ||
        !z.object({}).strict().safeParse(body).success
      )
        return failure("INPUT_INVALID");
      const i = await tx.invitations.find(id, invitationId.toLowerCase());
      if (!i || i.acceptedAt) return failure("INVITATION_INVALID");
      i.revokedAt ??= new Date(this.now());
      await tx.invitations.save(i);
      return { revoked: true };
    });
  }
  private state(i: Invitation | null, token: string): InvitationError | null {
    if (!i || !this.secrets.matches(token, invitationContext(i), i.digest))
      return "INVITATION_INVALID";
    if (i.acceptedAt) return "INVITATION_USED";
    if (i.revokedAt) return "INVITATION_REVOKED";
    if (+i.expiresAt <= this.now()) return "INVITATION_EXPIRED";
    return null;
  }
  async preview(body: unknown) {
    const input = previewSchema.safeParse(body);
    if (!input.success) return failure("INVITATION_INVALID");
    const [id, token] = input.data.token.split(".");
    if (!z.uuid().safeParse(id).success) return failure("INVITATION_INVALID");
    return this.work.run(async (tx) => {
      const i = await tx.invitations.locate(id);
      const error = this.state(i, token);
      if (error || !i) return failure(error ?? "INVITATION_INVALID");
      const org = await tx.organizations.find(i.organizationId);
      if (!org?.active || org.deletedAt) return failure("INVITATION_INVALID");
      return { organization: org.name, role: i.role, expiresAt: i.expiresAt };
    });
  }
  async accept(raw: string | undefined, body: unknown) {
    const input = acceptSchema.safeParse(body);
    if (!input.success) return failure("INPUT_INVALID");
    const data = input.data,
      [id, token] = data.token.split(".");
    if (!z.uuid().safeParse(id).success) return failure("INVITATION_INVALID");
    const initial = await this.work.run((tx) => tx.invitations.locate(id));
    const error = this.state(initial, token);
    if (error || !initial) return failure(error ?? "INVITATION_INVALID");
    const session =
      data.mode === "existing"
        ? await this.sessions.authorized(raw, false)
        : null;
    if (data.mode === "existing" && !session)
      return failure("SESSION_REQUIRED");
    const hash =
      data.mode === "new"
        ? await this.passwords.run(() => this.passwords.hash(data.password))
        : undefined;
    if (hash === null) return failure("UNAVAILABLE");
    return this.run(initial.organizationId, async (tx) => {
      // Global order: organization -> account (existing only) -> identity-update.
      if (session) await tx.lock(`account:${session.userId}`);
      await tx.lock("identity-update");
      const i = await tx.invitations.find(initial.organizationId, id);
      const error = this.state(i, token);
      if (error || !i) return failure(error ?? "INVITATION_INVALID");
      const org = await tx.organizations.find(i.organizationId);
      if (!org?.active || org.deletedAt) return failure("INVITATION_INVALID");
      let user;
      if (data.mode === "existing") {
        const s = await this.sessions.authorized(raw, false, tx.sessions);
        if (!s || s.userId !== session!.userId)
          return failure("SESSION_REQUIRED");
        if (s.user.emailIndex !== i.emailFingerprint)
          return failure("ACCEPT_UNAVAILABLE");
        user = s.user;
        const member = await tx.members.find(i.organizationId, s.userId);
        if (member?.deletedAt) return failure("ACCEPT_UNAVAILABLE");
        // Existing active membership is preserved, including its current role.
        if (!member)
          await tx.members.insert(i.organizationId, s.userId, i.role);
      } else {
        const usernameIndex = this.vault.index(data.username);
        if (
          await tx.identities.findCollision(usernameIndex, i.emailFingerprint)
        )
          return failure("ACCEPT_UNAVAILABLE");
        await tx.identities.create({
          username: this.vault.encrypt(data.username, "username"),
          email: this.vault.encrypt(
            this.vault.decrypt(i.email, invitationEmailPurpose(i)),
            "email",
          ),
          usernameIndex,
          emailIndex: i.emailFingerprint,
          passwordHash: hash!,
          master: false,
          mustChangePassword: false,
        });
        user = await tx.identities.findByIndex(i.emailFingerprint, false);
        if (!user) throw new Error("INVITATION_PERSISTENCE_UNAVAILABLE");
        await tx.members.insert(i.organizationId, user.id, i.role);
      }
      await tx.identities.updateCredentials(user.id, {
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(this.now()),
      });
      await tx.verifications.invalidate(user.id, new Date(this.now()));
      i.acceptedAt = new Date(this.now());
      await tx.invitations.save(i);
      return { accepted: true };
    });
  }
}
