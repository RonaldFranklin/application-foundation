import { z } from "zod";
import {
  Customer,
  CustomerSession,
  CustomerToken,
} from "../../domain/customers/models";
import { UnitOfWork } from "../auth/ports/repositories";
import {
  IdentityProtection,
  Passwords,
  Tokens,
  Totp,
} from "../auth/ports/security";
import { Sessions } from "../auth/use-cases/sessions";
import { Rates } from "../auth/use-cases/rate-limits";
import { OrganizationAccess } from "../organizations/use-cases/organization-access";
import { OrganizationPermission } from "../organizations/permissions";
import {
  InvitationPublisher,
  InvitationSecrets,
} from "../organization-invitations/ports";
import { recordAudit, attemptAudit, AuditAction } from "../audit/events";
import { CustomerTransaction } from "./ports";
const empty = z.object({}).strict();
const email = z
  .string()
  .max(254)
  .transform((v) => v.normalize("NFKC").trim().toLowerCase())
  .pipe(z.email());
const password = z.string().min(15).max(1024);
const name = z.string().trim().min(1).max(100);
const code = z.string().min(6).max(64);
const tokenInput = z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
export class CustomerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const invalid = () =>
  new CustomerError(400, "Solicitação inválida ou indisponível.");
const denied = () => new CustomerError(401, "Acesso inválido.");
export const customerPurpose = (c: Pick<Customer, "id">, field: string) =>
  `customer:${c.id}:${field}`;
export const customerTokenContext = (
  t: Pick<CustomerToken, "id" | "customerId" | "kind">,
) => JSON.stringify([t.id, t.customerId, t.kind]);
export class CustomerAccess {
  private access: OrganizationAccess;
  constructor(
    private work: UnitOfWork<CustomerTransaction>,
    private internal: Sessions,
    private vault: IdentityProtection,
    private passwords: Passwords,
    private tokens: Tokens,
    private totp: Totp,
    private rates: Rates,
    private secrets: InvitationSecrets,
    private publisher: InvitationPublisher,
    private sessionHours = 8,
  ) {
    this.access = new OrganizationAccess(internal, work);
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw invalid();
    return result.data;
  }
  private audit(
    tx: CustomerTransaction,
    c: Customer,
    action: AuditAction,
    actorId = c.id,
  ) {
    return recordAudit(tx, {
      action,
      actorId,
      organizationId: c.organizationId,
      resourceId: c.id,
    });
  }
  private async organization(tx: CustomerTransaction, id: string) {
    const org = await tx.organizations.find(id);
    return !!org?.active && !org.deletedAt;
  }
  private async admin<T>(
    raw: string | undefined,
    permission: OrganizationPermission,
    action: (
      tx: CustomerTransaction,
      organizationId: string,
      actorId: string,
    ) => Promise<T>,
  ) {
    return this.work.run(
      async (tx) => {
        const s = await this.internal.authorized(raw, false, tx.sessions);
        if (!s || s.user.master || s.user.platformAdmin) throw denied();
        const memberships = await tx.members.memberships(s.userId);
        if (memberships.length !== 1)
          throw new CustomerError(403, "Acesso não permitido.");
        const id = memberships[0].organizationId;
        await tx.lock(`organization:${id}`);
        const a = await this.access.check(tx, raw, id, permission, false);
        if (!a || !("organization" in a) || a.master)
          throw new CustomerError(403, "Acesso não permitido.");
        return action(tx, id, a.userId);
      },
      { maxWait: 15000, timeout: 15000 },
    );
  }
  private async scoped(tx: CustomerTransaction, org: string, id: unknown) {
    const customer = await tx.customers.find(this.parse(z.uuid(), id), org);
    if (!customer || customer.organizationId !== org)
      throw new CustomerError(404, "Cliente não encontrado.");
    await tx.lock(`customer:${customer.id}`);
    return (await tx.customers.find(customer.id, org))!;
  }
  private view(c: Customer) {
    return {
      id: c.id,
      email: this.vault.decrypt(c.email, customerPurpose(c, "email")),
      name: c.name
        ? this.vault.decrypt(c.name, customerPurpose(c, "name"))
        : null,
      status: c.status,
      emailVerifiedAt: c.emailVerifiedAt,
      mfaEnabled: !!c.totpSecret,
      createdAt: c.createdAt,
    };
  }
  async list(raw: string | undefined, query: unknown) {
    const q = this.parse(
      z
        .object({
          search: email.optional(),
          page: z.coerce.number().int().min(1).max(1000000).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(10),
        })
        .strict(),
      query,
    );
    return this.admin(raw, "customers.read", async (tx, org) => {
      const r = await tx.customers.list(
        org,
        q.search ? this.vault.index(q.search, "customer-email") : undefined,
        (q.page - 1) * q.pageSize,
        q.pageSize,
      );
      return {
        items: r.items.map((c) => this.view(c)),
        total: r.total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }
  async detail(raw: string | undefined, id: unknown, query: unknown) {
    this.parse(empty, query);
    return this.admin(raw, "customers.read", async (tx, org) => {
      const c = await this.scoped(tx, org, id);
      const t = await tx.customers.latestToken(c.id, "invitation");
      return {
        ...this.view(c),
        invitation: t
          ? {
              status: t.consumedAt
                ? "aceito"
                : t.revokedAt
                  ? "cancelado"
                  : +t.expiresAt <= Date.now()
                    ? "expirado"
                    : "pendente",
              expiresAt: t.expiresAt,
              consumedAt: t.consumedAt,
              revokedAt: t.revokedAt,
              deliveredAt: t.deliveredAt,
            }
          : null,
      };
    });
  }
  private async budget(
    tx: CustomerTransaction,
    key: string,
    max: number,
    window: number,
    cooldown = 0,
  ) {
    await tx.lock(key);
    const hits = ((await tx.rates.find(key))?.hits ?? []).filter(
      (d) => +d > Date.now() - window,
    );
    if (
      hits.length >= max ||
      (hits.length && +hits[hits.length - 1] > Date.now() - cooldown)
    )
      throw new CustomerError(429, "Tente novamente mais tarde.");
    await tx.rates.saveHits(key, [...hits, new Date()]);
  }
  private async issueToken(
    tx: CustomerTransaction,
    c: Customer,
    kind: string,
    actorId = c.id,
  ) {
    await tx.customers.revokeTokens(c.id, kind);
    const generated = this.secrets.generate();
    const t: CustomerToken = {
      attempts: 0,
      id: generated.id,
      customerId: c.id,
      kind,
      digest: "",
      expiresAt: new Date(
        Date.now() + (kind === "invitation" ? 7 * 86400000 : 15 * 60000),
      ),
      createdAt: new Date(),
      consumedAt: null,
      revokedAt: null,
      deliveredAt: null,
    };
    const context = customerTokenContext(t);
    t.digest = this.secrets.digest(generated.token, context);
    await tx.customers.saveToken(t);
    await this.audit(
      tx,
      c,
      kind === "invitation" ? "customer.invited" : "customer.reset_requested",
      actorId,
    );
    return {
      t,
      job: {
        invitationId: t.id,
        encryptedToken: this.secrets.encrypt(generated.token, context),
      },
    };
  }
  private async publish(
    issued: Awaited<ReturnType<CustomerAccess["issueToken"]>>,
  ) {
    try {
      await this.publisher.publish(issued.job);
    } catch {
      await this.work.run(async (tx) => {
        const c = await tx.customers.find(issued.t.customerId);
        if (!c) return;
        await tx.lock(`organization:${c.organizationId}`);
        await tx.lock(`customer:${c.id}`);
        const t = await tx.customers.token(issued.t.id);
        if (t && !t.consumedAt && !t.revokedAt) {
          t.revokedAt = new Date();
          await tx.customers.saveToken(t);
          await this.audit(tx, c, "customer.delivery_failed");
        }
      });
      throw new CustomerError(503, "Entrega temporariamente indisponível.");
    }
  }
  async invite(raw: string | undefined, body: unknown, id?: string) {
    const input = id
      ? (this.parse(empty, body), null)
      : this.parse(z.object({ email }).strict(), body);
    const issued = await this.admin(
      raw,
      "customers.invite",
      async (tx, org, actor) => {
        let c: Customer;
        if (id) c = await this.scoped(tx, org, id);
        else {
          const index = this.vault.index(input!.email, "customer-email");
          await tx.lock(`customer-email:${index}`);
          const old = await tx.customers.byEmail(index);
          if (old && (old.organizationId !== org || old.status !== "pending"))
            throw new CustomerError(
              409,
              "Não foi possível emitir este convite.",
            );
          c = old ?? {
            id: this.secrets.generate().id,
            organizationId: org,
            email: "",
            emailIndex: index,
            name: null,
            status: "pending",
            passwordHash: null,
            emailVerifiedAt: null,
            totpSecret: null,
            pendingTotpSecret: null,
            pendingTotpExpiresAt: null,
            lastTotpStep: -1n,
            createdAt: new Date(),
          };
          if (!old) {
            c.email = this.vault.encrypt(
              input!.email,
              customerPurpose(c, "email"),
            );
            await tx.customers.save(c);
          }
          await tx.lock(`customer:${c.id}`);
        }
        if (c.status !== "pending") throw invalid();
        await this.budget(tx, `customer-invite-org:${org}`, 100, 3600000);
        await this.budget(tx, `customer-invite:${c.id}`, 5, 3600000, 60000);
        await this.budget(tx, `customer-invite-day:${c.id}`, 20, 86400000);
        return this.issueToken(tx, c, "invitation", actor);
      },
    );
    await this.publish(issued);
    return { queued: true, expiresAt: issued.t.expiresAt };
  }
  async cancel(raw: string | undefined, id: string, body: unknown) {
    this.parse(empty, body);
    return this.admin(raw, "customers.invite", async (tx, org, actor) => {
      const c = await this.scoped(tx, org, id);
      if (c.status !== "pending") throw invalid();
      await tx.customers.revokeTokens(c.id, "invitation");
      await this.audit(tx, c, "customer.invitation_cancelled", actor);
      return { cancelled: true };
    });
  }
  async status(raw: string | undefined, id: string, body: unknown) {
    const input = this.parse(
      z.object({ status: z.enum(["active", "suspended"]) }).strict(),
      body,
    );
    return this.admin(raw, "customers.manage", async (tx, org, actor) => {
      const c = await this.scoped(tx, org, id);
      if (c.status === "pending") throw invalid();
      if (c.status !== input.status) {
        c.status = input.status;
        c.pendingTotpSecret = null;
        c.pendingTotpExpiresAt = null;
        await tx.customers.save(c);
        await tx.customers.revokeSessions(c.id);
        await tx.customers.revokeTokens(c.id, "reset");
        await this.audit(
          tx,
          c,
          c.status === "active" ? "customer.reactivated" : "customer.suspended",
          actor,
        );
      }
      return { status: c.status };
    });
  }
  private async hash(value: string) {
    const result = await this.passwords.run(() => this.passwords.hash(value));
    if (!result) throw new CustomerError(503, "Tente novamente mais tarde.");
    return result;
  }
  private async verify(hash: string | null, value: string) {
    const result = await this.passwords.run(() =>
      this.passwords.verify(hash ?? this.passwords.dummy, value),
    );
    if (result === null)
      throw new CustomerError(503, "Tente novamente mais tarde.");
    return !!hash && result;
  }
  private async tokenOperation<T>(
    raw: string,
    kind: string,
    action: (
      tx: CustomerTransaction,
      c: Customer,
      t: CustomerToken,
    ) => Promise<T>,
  ) {
    const [id, secret] = this.parse(tokenInput, raw).split(".");
    const result = await this.work.run(async (tx) => {
      const initial = await tx.customers.token(id);
      if (!initial) throw invalid();
      const first = await tx.customers.find(initial.customerId);
      if (!first) throw invalid();
      await tx.lock(`organization:${first.organizationId}`);
      await tx.lock(`customer:${first.id}`);
      const t = await tx.customers.token(id),
        c = await tx.customers.find(first.id);
      if (
        !t ||
        !c ||
        t.kind !== kind ||
        t.consumedAt ||
        t.revokedAt ||
        +t.expiresAt <= Date.now() ||
        !(await this.organization(tx, c.organizationId)) ||
        c.status !== (kind === "invitation" ? "pending" : "active")
      )
        throw invalid();
      if (!this.secrets.matches(secret, customerTokenContext(t), t.digest)) {
        t.attempts += 1;
        if (t.attempts >= 5) t.revokedAt = new Date();
        await tx.customers.saveToken(t);
        return { rejected: true as const };
      }
      return { value: await action(tx, c, t) };
    });
    if ("rejected" in result) throw invalid();
    return result.value;
  }
  async accept(body: unknown) {
    const i = this.parse(
      z
        .object({
          token: tokenInput,
          name,
          password,
          confirmPassword: password,
        })
        .strict()
        .refine((v) => v.password === v.confirmPassword),
      body,
    );
    // Validate capability before spending Argon2, then revalidate under the consumption lock.
    await this.tokenOperation(i.token, "invitation", async () => true);
    const hash = await this.hash(i.password);
    return this.tokenOperation(i.token, "invitation", async (tx, c, t) => {
      c.passwordHash = hash;
      c.name = this.vault.encrypt(i.name, customerPurpose(c, "name"));
      c.status = "active";
      c.emailVerifiedAt = new Date();
      t.consumedAt = new Date();
      await tx.customers.save(c);
      await tx.customers.saveToken(t);
      await this.audit(tx, c, "customer.activated");
      return { accepted: true };
    });
  }
  async requestReset(body: unknown) {
    const i = this.parse(z.object({ email }).strict(), body);
    const issued = await this.work.run(async (tx) => {
      const initial = await tx.customers.byEmail(
        this.vault.index(i.email, "customer-email"),
      );
      if (!initial) return null;
      await tx.lock(`organization:${initial.organizationId}`);
      await tx.lock(`customer:${initial.id}`);
      const c = await tx.customers.find(initial.id);
      if (
        !c ||
        c.status !== "active" ||
        !c.emailVerifiedAt ||
        !(await this.organization(tx, c.organizationId))
      )
        return null;
      const key = `customer-reset:${c.id}`;
      const hits = ((await tx.rates.find(key))?.hits ?? []).filter(
        (d) => +d > Date.now() - 3600000,
      );
      if (hits.length >= 5 || hits.some((d) => +d > Date.now() - 60000))
        return null;
      await tx.rates.saveHits(key, [...hits, new Date()]);
      return this.issueToken(tx, c, "reset");
    });
    if (issued) {
      try {
        await this.publish(issued);
      } catch {
        /* Public result must not reveal account or delivery state. */
      }
    }
    return {
      message: "Se a conta puder recuperar a senha, enviaremos as instruções.",
    };
  }
  async reset(body: unknown) {
    const i = this.parse(
      z
        .object({ token: tokenInput, password, confirmPassword: password })
        .strict()
        .refine((v) => v.password === v.confirmPassword),
      body,
    );
    await this.tokenOperation(i.token, "reset", async () => true);
    const hash = await this.hash(i.password);
    return this.tokenOperation(i.token, "reset", async (tx, c, t) => {
      c.passwordHash = hash;
      c.pendingTotpSecret = null;
      c.pendingTotpExpiresAt = null;
      t.consumedAt = new Date();
      await tx.customers.save(c);
      await tx.customers.saveToken(t);
      await tx.customers.revokeSessions(c.id);
      await this.audit(tx, c, "customer.password_reset");
      return { changed: true };
    });
  }
  private async newSession(
    tx: CustomerTransaction,
    c: Customer,
    stage: string,
  ) {
    const raw = this.tokens.generate(),
      seconds = stage === "full" ? this.sessionHours * 3600 : 600;
    await tx.customers.saveSession({
      digest: this.tokens.digest(raw),
      publicId: this.secrets.generate().id,
      customerId: c.id,
      stage,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + seconds * 1000),
    });
    await this.audit(
      tx,
      c,
      stage === "full" ? "customer.login" : "customer.password_accepted",
    );
    return { raw, stage, seconds };
  }
  async login(body: unknown, ip: string) {
    const i = this.parse(
      z.object({ email, password: z.string().max(1024) }).strict(),
      body,
    );
    const initial = await this.work.run((tx) =>
      tx.customers.byEmail(this.vault.index(i.email, "customer-email")),
    );
    const key = `customer-login:${initial?.id ?? this.vault.index(ip, "customer-unknown-ip")}`;
    const allowed = await this.work.run(async (tx) => {
      await tx.lock(key);
      if ((await this.rates.state(tx, key)).blocked) return false;
      await this.rates.failure(tx, key);
      return true;
    });
    const valid = await this.verify(initial?.passwordHash ?? null, i.password);
    if (!initial || !valid || !allowed) {
      await this.work.run((tx) =>
        attemptAudit(tx, {
          action: "customer.login_failed",
          organizationId: initial?.organizationId,
          resourceId: initial?.id,
        }),
      );
      throw new CustomerError(401, "E-mail ou senha inválidos.");
    }
    const result = await this.work.run(async (tx) => {
      await tx.lock(`organization:${initial.organizationId}`);
      await tx.lock(`customer:${initial.id}`);
      const c = await tx.customers.find(initial.id);
      if (
        !c ||
        c.passwordHash !== initial.passwordHash ||
        c.status !== "active" ||
        !c.emailVerifiedAt ||
        !(await this.organization(tx, c.organizationId))
      )
        return null;
      await tx.lock(key);
      await this.rates.clear(tx, key);
      return this.newSession(tx, c, c.totpSecret ? "mfa" : "full");
    });
    if (!result) {
      await this.work.run((tx) =>
        attemptAudit(tx, {
          action: "customer.login_failed",
          organizationId: initial.organizationId,
          resourceId: initial.id,
        }),
      );
      throw new CustomerError(401, "E-mail ou senha inválidos.");
    }
    return result;
  }
  private async session<T>(
    raw: string | undefined,
    stages: string[],
    action: (
      tx: CustomerTransaction,
      c: Customer,
      s: CustomerSession,
    ) => Promise<T>,
  ) {
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw denied();
    return this.work.run(async (tx) => {
      const first = await tx.customers.session(this.tokens.digest(raw));
      if (!first) throw denied();
      const initial = await tx.customers.find(first.customerId);
      if (!initial) throw denied();
      await tx.lock(`organization:${initial.organizationId}`);
      await tx.lock(`customer:${initial.id}`);
      const s = await tx.customers.session(this.tokens.digest(raw)),
        c = await tx.customers.find(initial.id);
      if (
        !s ||
        !c ||
        +s.expiresAt <= Date.now() ||
        !stages.includes(s.stage) ||
        c.status !== "active" ||
        !c.emailVerifiedAt ||
        !(await this.organization(tx, c.organizationId))
      )
        throw denied();
      return action(tx, c, s);
    });
  }
  async state(raw: string | undefined, query: unknown) {
    this.parse(empty, query);
    return this.session(raw, ["mfa", "full"], async (_tx, _c, s) => ({
      stage: s.stage,
    }));
  }
  async profile(raw: string | undefined, query: unknown) {
    this.parse(empty, query);
    return this.session(raw, ["full"], async (_tx, c) => this.view(c));
  }
  async update(raw: string | undefined, body: unknown) {
    const i = this.parse(z.object({ name }).strict(), body);
    return this.session(raw, ["full"], async (tx, c) => {
      c.name = this.vault.encrypt(i.name, customerPurpose(c, "name"));
      await tx.customers.save(c);
      await this.audit(tx, c, "customer.updated");
      return this.view(c);
    });
  }
  async logout(raw: string | undefined, body: unknown) {
    this.parse(empty, body);
    try {
      await this.session(raw, ["mfa", "full"], async (tx, c, s) => {
        await tx.customers.revokeSessions(c.id, s.publicId);
        await this.audit(tx, c, "customer.logout");
      });
    } catch (e) {
      if (!(e instanceof CustomerError && e.status === 401)) throw e;
    }
    return { loggedOut: true };
  }
  async listSessions(raw: string | undefined, query: unknown) {
    this.parse(empty, query);
    return this.session(raw, ["full"], async (tx, c, s) => ({
      items: (await tx.customers.sessions(c.id, new Date())).map((v) => ({
        id: v.publicId,
        current: s.digest === v.digest,
        stage: v.stage,
        createdAt: v.createdAt,
        expiresAt: v.expiresAt,
      })),
    }));
  }
  async revokeSession(raw: string | undefined, body: unknown) {
    const i = this.parse(
      z.union([
        z.object({ id: z.uuid() }).strict(),
        z.object({ others: z.literal(true) }).strict(),
      ]),
      body,
    );
    return this.session(raw, ["full"], async (tx, c, s) => {
      await tx.customers.revokeSessions(
        c.id,
        "id" in i ? i.id : undefined,
        "others" in i ? s.digest : undefined,
      );
      await this.audit(tx, c, "customer.sessions_revoked");
      return { revoked: true, current: "id" in i && i.id === s.publicId };
    });
  }
  private async factor(tx: CustomerTransaction, c: Customer, value: string) {
    if (!c.totpSecret) return false;
    const step = this.totp.step(
      this.vault.decrypt(c.totpSecret, customerPurpose(c, "totp")),
      value,
    );
    if (step !== null && step > c.lastTotpStep) {
      c.lastTotpStep = step;
      await tx.customers.save(c);
      return true;
    }
    if (
      /^[a-f0-9]{32}$/.test(value) &&
      (await tx.customers.consumeRecovery(
        c.id,
        this.tokens.digest(`customer-recovery:${c.id}:${value}`),
      ))
    ) {
      await this.audit(tx, c, "customer.recovery_used");
      return true;
    }
    return false;
  }
  private async factorBudget(tx: CustomerTransaction, c: Customer) {
    const key = `customer-mfa:${c.id}`;
    if ((await this.rates.state(tx, key)).blocked) return false;
    await this.rates.failure(tx, key);
    return true;
  }
  async mfa(raw: string | undefined, body: unknown) {
    const i = this.parse(z.object({ code }).strict(), body);
    const result = await this.session(raw, ["mfa"], async (tx, c, s) => {
      if (
        !(await this.factorBudget(tx, c)) ||
        !(await this.factor(tx, c, i.code))
      ) {
        await this.audit(tx, c, "customer.mfa_failed");
        return null;
      }
      await this.rates.clear(tx, `customer-mfa:${c.id}`);
      await tx.customers.revokeSessions(c.id, s.publicId);
      return this.newSession(tx, c, "full");
    });
    if (!result) throw denied();
    return result;
  }
  async setup(raw: string | undefined, body: unknown) {
    const i = this.parse(
      z
        .object({ password: z.string().max(1024), code: code.optional() })
        .strict(),
      body,
    );
    const snapshot = await this.session(raw, ["full"], async (_tx, c) => c);
    const valid = await this.verify(snapshot.passwordHash, i.password);
    const result = await this.session(raw, ["full"], async (tx, c) => {
      if (
        !(await this.factorBudget(tx, c)) ||
        !valid ||
        snapshot.passwordHash !== c.passwordHash ||
        (c.totpSecret && !(await this.factor(tx, c, i.code ?? "")))
      )
        return null;
      const secret = this.totp.generateSecret();
      c.pendingTotpSecret = this.vault.encrypt(
        secret,
        customerPurpose(c, "totp"),
      );
      c.pendingTotpExpiresAt = new Date(Date.now() + 600000);
      await tx.customers.save(c);
      await this.rates.clear(tx, `customer-mfa:${c.id}`);
      await this.audit(tx, c, "customer.mfa_setup");
      return {
        secret,
        uri: this.totp
          .uri(secret)
          .replace("Conta%20administrativa", "Conta%20de%20cliente"),
      };
    });
    if (!result) throw denied();
    return result;
  }
  async enroll(raw: string | undefined, body: unknown) {
    const i = this.parse(z.object({ code }).strict(), body);
    const result = await this.session(raw, ["full"], async (tx, c) => {
      if (
        !(await this.factorBudget(tx, c)) ||
        !c.pendingTotpSecret ||
        !c.pendingTotpExpiresAt ||
        +c.pendingTotpExpiresAt <= Date.now()
      )
        return null;
      const secret = this.vault.decrypt(
        c.pendingTotpSecret,
        customerPurpose(c, "totp"),
      );
      const step = this.totp.step(secret, i.code);
      if (step === null) return null;
      c.totpSecret = c.pendingTotpSecret;
      c.lastTotpStep = step;
      c.pendingTotpSecret = null;
      c.pendingTotpExpiresAt = null;
      const codes = Array.from({ length: 10 }, () =>
        this.tokens.recoveryCode(),
      );
      await tx.customers.save(c);
      await tx.customers.replaceRecovery(
        c.id,
        codes.map((v) => this.tokens.digest(`customer-recovery:${c.id}:${v}`)),
      );
      await tx.customers.revokeSessions(c.id);
      await this.rates.clear(tx, `customer-mfa:${c.id}`);
      await this.audit(tx, c, "customer.mfa_enabled");
      return {
        ...(await this.newSession(tx, c, "full")),
        recoveryCodes: codes,
      };
    });
    if (!result) throw denied();
    return result;
  }
  async disable(raw: string | undefined, body: unknown) {
    const i = this.parse(
      z.object({ password: z.string().max(1024), code }).strict(),
      body,
    );
    const snapshot = await this.session(raw, ["full"], async (_tx, c) => c);
    const valid = await this.verify(snapshot.passwordHash, i.password);
    const result = await this.session(raw, ["full"], async (tx, c) => {
      if (
        !(await this.factorBudget(tx, c)) ||
        !valid ||
        snapshot.passwordHash !== c.passwordHash ||
        !(await this.factor(tx, c, i.code))
      )
        return null;
      c.totpSecret = null;
      c.pendingTotpSecret = null;
      c.pendingTotpExpiresAt = null;
      c.lastTotpStep = -1n;
      await tx.customers.save(c);
      await tx.customers.replaceRecovery(c.id, []);
      await tx.customers.revokeSessions(c.id);
      await this.rates.clear(tx, `customer-mfa:${c.id}`);
      await this.audit(tx, c, "customer.mfa_disabled");
      return this.newSession(tx, c, "full");
    });
    if (!result) throw denied();
    return result;
  }
}
