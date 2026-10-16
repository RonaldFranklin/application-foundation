import {
  normalize,
  passwordSchema,
  profileSchema,
} from "../auth/validators/auth-input";
import { z } from "zod";
import { UnitOfWork } from "../auth/ports/repositories";
import { IdentityProtection, Passwords } from "../auth/ports/security";
import { Sessions } from "../auth/use-cases/sessions";
import { recordAudit } from "../audit/events";
import {
  InvitationPublisher,
  InvitationSecrets,
} from "../organization-invitations/ports";
import {
  PlatformInvitation,
  PlatformTransaction,
  platformContext,
  platformEmailPurpose,
} from "./ports";
import {
  platformPermissionKeys,
  platformPermissionCatalog,
} from "./permissions";
const permissions = z
  .array(z.enum(platformPermissionKeys))
  .max(platformPermissionKeys.length)
  .refine((p) => new Set(p).size === p.length);
const empty = z.object({}).strict();
const tokenSchema = z.string().regex(/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
const acceptSchema = z
  .object({
    token: tokenSchema,
    username: profileSchema.shape.username,
    password: passwordSchema.shape.password,
    confirmPassword: z.string().max(1024),
  })
  .strict()
  .refine((v) => v.password === v.confirmPassword);
export const platformMessages = {
  FORBIDDEN: "Acesso administrativo não autorizado.",
  INPUT_INVALID: "Confira os campos informados.",
  CONFLICT: "Já existe uma conta ou convite pendente para esse endereço.",
  INVITATION_INVALID:
    "Convite inválido ou limite de tentativas atingido. Solicite um novo convite.",
  INVITATION_EXPIRED: "Convite expirado. Solicite um novo convite.",
  INVITATION_USED: "Convite já utilizado. Entre pelo login administrativo.",
  INVITATION_REVOKED: "Convite cancelado. Solicite um novo convite.",
  RATE_LIMIT: "Aguarde antes de reenviar o convite.",
  UNAVAILABLE:
    "Não foi possível enfileirar o convite. Tente novamente mais tarde.",
  ACCEPT_UNAVAILABLE:
    "Não foi possível ativar a conta. Confira os dados ou solicite um novo convite.",
} as const;
const fail = (error: keyof typeof platformMessages) => ({ error });
export class PlatformAdmins {
  constructor(
    private work: UnitOfWork<PlatformTransaction>,
    private sessions: Sessions,
    private vault: IdentityProtection,
    private passwords: Passwords,
    private secrets: InvitationSecrets,
    private publisher: InvitationPublisher,
    private now: () => number = Date.now,
  ) {}
  private run<T>(action: (tx: PlatformTransaction) => Promise<T>) {
    return this.work.run(
      async (tx) => {
        await tx.lock("platform-access");
        return action(tx);
      },
      { maxWait: 15000, timeout: 15000 },
    );
  }
  async list(raw: string | undefined, query: unknown) {
    return this.run(async (tx) => {
      if (!(await this.sessions.authorized(raw, true, tx.sessions)))
        return fail("FORBIDDEN");
      const input = z
        .object({
          search: z.string().trim().max(254).default(""),
          status: z
            .enum([
              "all",
              "active",
              "inactive",
              "pending",
              "expired",
              "revoked",
              "accepted",
            ])
            .default("all"),
          page: z.coerce.number().int().min(1).max(1000000).default(1),
        })
        .strict()
        .safeParse(query);
      if (!input.success) return fail("INPUT_INVALID");
      const accounts = (await tx.platformAdmins.list()).map((a) => ({
        id: a.user.id,
        kind: "account" as const,
        email: this.vault.decrypt(a.user.email, "email"),
        username: this.vault.decrypt(a.user.username, "username"),
        permissions: a.permissions,
        status: a.active ? "active" : "inactive",
        mfa: a.user.totpVerified,
        createdAt: a.createdAt,
      }));
      const invitations = (await tx.platformAdmins.invitations()).map((i) => ({
        id: i.id,
        kind: "invitation" as const,
        email: this.vault.decrypt(i.email, platformEmailPurpose(i)),
        username: "",
        permissions: i.permissions,
        status: i.acceptedAt
          ? "accepted"
          : i.revokedAt
            ? "revoked"
            : +i.expiresAt <= this.now()
              ? "expired"
              : "pending",
        mfa: false,
        createdAt: i.createdAt,
      }));
      const { search, status, page } = input.data;
      const rows = [...accounts, ...invitations]
        .filter(
          (i) =>
            (status === "all" || i.status === status) &&
            `${i.email} ${i.username}`
              .normalize("NFKC")
              .toLowerCase()
              .includes(search.normalize("NFKC").toLowerCase()),
        )
        .sort(
          (a, b) => +b.createdAt - +a.createdAt || a.id.localeCompare(b.id),
        );
      return {
        items: rows.slice((page - 1) * 10, page * 10),
        total: rows.length,
        page,
        pageSize: 10,
        catalog: platformPermissionCatalog,
      };
    });
  }
  async change(raw: string | undefined, id: string, body: unknown) {
    return this.run(async (tx) => {
      if (!(await this.sessions.authorized(raw, true, tx.sessions)))
        return fail("FORBIDDEN");
      const input = z
        .object({ active: z.boolean(), permissions })
        .strict()
        .safeParse(body);
      if (!input.success || !z.uuid().safeParse(id).success)
        return fail("INPUT_INVALID");
      id = id.toLowerCase();
      await tx.lock(`account:${id}`);
      const actor = await this.sessions.authorized(raw, true, tx.sessions);
      const user = await tx.identities.findById(id);
      if (!actor || !user?.platformAdmin || user.master)
        return fail("FORBIDDEN");
      await tx.platformAdmins.save(
        id,
        input.data.active,
        input.data.permissions,
      );
      await tx.sessions.deleteForUser(id);
      await tx.sessions.deleteDevicesForUser(id);
      if (user.platformAdmin.active !== input.data.active)
        await recordAudit(tx, {
          action: input.data.active
            ? "platform_admin.restored"
            : "platform_admin.deactivated",
          actorId: actor.userId,
          resourceId: id,
        });
      await recordAudit(tx, {
        action: "platform_admin.permissions_changed",
        actorId: actor.userId,
        resourceId: id,
        metadata: {
          granted: input.data.permissions.filter(
            (p) => !user.platformAdmin!.permissions.includes(p),
          ),
          removed: user.platformAdmin.permissions.filter(
            (p) =>
              !input.data.permissions.includes(
                p as (typeof input.data.permissions)[number],
              ),
          ),
        },
      });
      return { saved: true };
    });
  }
  async issue(raw: string | undefined, body: unknown, resendId?: string) {
    const prepared = await this.run(async (tx) => {
      const actor = await this.sessions.authorized(raw, true, tx.sessions);
      if (!actor) return fail("FORBIDDEN");
      const schema = z
        .object({
          email: z
            .string()
            .max(254)
            .transform(normalize)
            .pipe(profileSchema.shape.email),
          permissions,
        })
        .strict();
      const input = resendId ? empty.safeParse(body) : schema.safeParse(body);
      if (!input.success || (resendId && !z.uuid().safeParse(resendId).success))
        return fail("INPUT_INVALID");
      const data = resendId ? null : schema.parse(body);
      const previous = resendId
        ? await tx.platformAdmins.invitation(resendId.toLowerCase())
        : await tx.platformAdmins.forEmail(this.vault.index(data!.email));
      if (resendId && (!previous || previous.acceptedAt || previous.revokedAt))
        return fail("INVITATION_INVALID");
      if (
        !resendId &&
        previous &&
        !previous.revokedAt &&
        !previous.acceptedAt &&
        +previous.expiresAt > this.now()
      )
        return fail("CONFLICT");
      if (previous?.acceptedAt) return fail("INVITATION_USED");
      const fingerprint = data
        ? this.vault.index(data.email)
        : previous!.emailFingerprint;
      if (await tx.identities.findCollision(fingerprint, fingerprint))
        return fail("CONFLICT");
      const key = `platform-invite:${fingerprint}`;
      const hits = ((await tx.rates.find(key))?.hits ?? []).filter(
        (d) => +d > this.now() - 86400000,
      );
      const globalKey = "platform-invite-global";
      const globalHits = ((await tx.rates.find(globalKey))?.hits ?? []).filter(
        (d) => +d > this.now() - 3600000,
      );
      if (
        hits.length >= 20 ||
        hits.filter((d) => +d > this.now() - 3600000).length >= 5 ||
        +(hits.at(-1) ?? 0) > this.now() - 60000 ||
        globalHits.length >= 100
      )
        return fail("RATE_LIMIT");
      await tx.rates.saveHits(key, [...hits, new Date(this.now())]);
      await tx.rates.saveHits(globalKey, [...globalHits, new Date(this.now())]);
      const generated = this.secrets.generate();
      const i: PlatformInvitation = {
        id: previous?.id ?? generated.id,
        email: "",
        emailFingerprint: fingerprint,
        digest: "",
        permissions: data?.permissions ?? previous!.permissions,
        createdBy: actor.userId,
        createdAt: new Date(this.now()),
        expiresAt: new Date(this.now() + 7 * 86400000),
        acceptedAt: null,
        revokedAt: null,
        deliveredAt: null,
        attempts: 0,
      };
      i.email = data
        ? this.vault.encrypt(data.email, platformEmailPurpose(i))
        : previous!.email;
      i.digest = this.secrets.digest(generated.token, platformContext(i));
      await tx.platformAdmins.saveInvitation(i);
      await recordAudit(tx, {
        action: previous
          ? "platform_invitation.resent"
          : "platform_invitation.created",
        actorId: actor.userId,
        resourceId: i.id,
      });
      return {
        i,
        job: {
          invitationId: i.id,
          encryptedToken: this.secrets.encrypt(
            generated.token,
            platformContext(i),
          ),
        },
      };
    });
    if ("error" in prepared) return prepared;
    try {
      await this.publisher.publish(prepared.job);
    } catch {
      await this.run(async (tx) => {
        const i = await tx.platformAdmins.invitation(prepared.i.id);
        if (
          i &&
          i.digest === prepared.i.digest &&
          !i.acceptedAt &&
          !i.revokedAt
        ) {
          i.revokedAt = new Date(this.now());
          await tx.platformAdmins.saveInvitation(i);
          await recordAudit(tx, {
            action: "platform_invitation.revoked",
            resourceId: i.id,
          });
        }
      });
      return fail("UNAVAILABLE");
    }
    return { queued: true, expiresAt: prepared.i.expiresAt };
  }
  async revoke(raw: string | undefined, id: string, body: unknown) {
    return this.run(async (tx) => {
      const actor = await this.sessions.authorized(raw, true, tx.sessions);
      if (!actor) return fail("FORBIDDEN");
      if (!z.uuid().safeParse(id).success || !empty.safeParse(body).success)
        return fail("INPUT_INVALID");
      const i = await tx.platformAdmins.invitation(id.toLowerCase());
      if (!i || i.acceptedAt) return fail("INVITATION_INVALID");
      if (!i.revokedAt) {
        i.revokedAt = new Date(this.now());
        await tx.platformAdmins.saveInvitation(i);
        await recordAudit(tx, {
          action: "platform_invitation.revoked",
          actorId: actor.userId,
          resourceId: i.id,
        });
      }
      return { revoked: true };
    });
  }
  private state(i: PlatformInvitation | null, token: string, reserved = false) {
    if (
      !i ||
      (reserved ? i.attempts > 10 : i.attempts >= 10) ||
      !this.secrets.matches(token, platformContext(i), i.digest)
    )
      return "INVITATION_INVALID" as const;
    if (i.acceptedAt) return "INVITATION_USED" as const;
    if (i.revokedAt) return "INVITATION_REVOKED" as const;
    if (+i.expiresAt <= this.now()) return "INVITATION_EXPIRED" as const;
    return null;
  }
  async accept(body: unknown) {
    const input = acceptSchema.safeParse(body);
    if (!input.success) return fail("INPUT_INVALID");
    const { username, password } = input.data;
    const [id, token] = input.data.token.split(".");
    if (!z.uuid().safeParse(id).success) return fail("INVITATION_INVALID");
    // Reserve each attempt before Argon2, persist failed guesses, never reset on failure.
    const initial = await this.run(async (tx) => {
      const i = await tx.platformAdmins.invitation(id);
      const error = this.state(i, token);
      if (
        i &&
        !i.acceptedAt &&
        !i.revokedAt &&
        +i.expiresAt > this.now() &&
        i.attempts < 10
      ) {
        i.attempts++;
        await tx.platformAdmins.saveInvitation(i);
      }
      if (error || !i) return fail(error ?? "INVITATION_INVALID");
      return { i };
    });
    if ("error" in initial) return initial;
    const hash = await this.passwords.run(() => this.passwords.hash(password));
    if (hash === null) return fail("UNAVAILABLE");
    return this.run(async (tx) => {
      await tx.lock("identity-update");
      const i = await tx.platformAdmins.invitation(id);
      const error = this.state(i, token, true);
      if (error || !i || i.digest !== initial.i.digest)
        return fail(error ?? "INVITATION_INVALID");
      const usernameIndex = this.vault.index(username);
      if (await tx.identities.findCollision(usernameIndex, i.emailFingerprint))
        return fail("ACCEPT_UNAVAILABLE");
      await tx.identities.create({
        username: this.vault.encrypt(username, "username"),
        email: this.vault.encrypt(
          this.vault.decrypt(i.email, platformEmailPurpose(i)),
          "email",
        ),
        usernameIndex,
        emailIndex: i.emailFingerprint,
        passwordHash: hash,
        master: false,
        mustChangePassword: false,
      });
      const user = await tx.identities.findByIndex(i.emailFingerprint, false);
      if (!user) throw new Error("PLATFORM_ADMIN_PERSISTENCE_UNAVAILABLE");
      await tx.platformAdmins.save(user.id, true, i.permissions);
      await tx.identities.updateCredentials(user.id, {
        emailVerifiedAt: new Date(this.now()),
      });
      i.acceptedAt = new Date(this.now());
      await tx.platformAdmins.saveInvitation(i);
      await recordAudit(tx, {
        action: "platform_invitation.accepted",
        actorId: user.id,
        resourceId: i.id,
      });
      await recordAudit(tx, {
        action: "platform_admin.activated",
        actorId: user.id,
        resourceId: user.id,
      });
      await recordAudit(tx, {
        action: "platform_admin.permissions_changed",
        actorId: i.createdBy,
        resourceId: user.id,
        metadata: { granted: i.permissions, removed: [] },
      });
      return { accepted: true };
    });
  }
}
