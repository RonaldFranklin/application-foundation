import { z } from "zod";
import { recordAudit, attemptAudit } from "../../audit/events";
import { MembersTransaction } from "../../organizations/ports/members.repository";
import { passwordSchema } from "../validators/auth-input";
import { UnitOfWork } from "../ports/repositories";
import { IdentityProtection, Passwords, Totp } from "../ports/security";
import { Sessions } from "./sessions";
import { Rates } from "./rate-limits";
const inputSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict();

export class ResetCredentials {
  constructor(
    private work: UnitOfWork<MembersTransaction>,
    private sessions: Sessions,
    private passwords: Passwords,
    private vault: IdentityProtection,
    private totp: Totp,
    private rates: Rates,
  ) {}
  async execute(
    raw: string | undefined,
    targetId: unknown,
    body: unknown,
    masterOnly = true,
    kind: "mfa" | "password" = "mfa",
  ) {
    // MFA reset is never delegated, including calls through the legacy namespace.
    if (kind === "mfa" && !masterOnly) return null;
    const initial = await this.sessions.authorized(
      raw,
      masterOnly ? true : false,
    );
    if (!initial) return null;
    const input = (
      kind === "password"
        ? inputSchema
            .extend({
              temporaryPassword: passwordSchema.shape.password,
              confirmPassword: z.string().max(1024),
            })
            .refine((data) => data.temporaryPassword === data.confirmPassword)
        : inputSchema
    ).safeParse(body);
    const target = z.uuid().safeParse(targetId);
    if (!input.success || !target.success || (masterOnly && !input.data.code))
      return { invalid: "mfa-reset" as const };
    const id = target.data.toLowerCase();
    if (id === initial.userId) return null;
    // Same per-account budget as profile reauthentication, reserved before Argon2.
    const key = `profile:${initial.userId}`;
    const admitted = await this.work.run(async (tx) => {
      await tx.lock(`account:${initial.userId}`);
      const actor = await this.sessions.authorized(
        raw,
        masterOnly ? true : false,
        tx.sessions,
      );
      if (!actor || actor.user.passwordHash !== initial.user.passwordHash)
        return null;
      if ((await this.rates.state(tx, key)).blocked) return false;
      await this.rates.failure(tx, key, true);
      return true;
    });
    if (admitted === null) return null;
    if (!admitted) return { error: "ATTEMPTS_BLOCKED" as const };
    const verified = await this.passwords.run(() =>
      this.passwords.verify(
        initial.user.passwordHash,
        input.data.currentPassword,
      ),
    );
    if (verified === null) return { busy: true as const };
    if (!verified) {
      try {
        await this.work.run((tx) =>
          attemptAudit(tx, {
            action: "auth.reauthentication_failed",
            actorId: initial.userId,
            resourceId: initial.userId,
          }),
        );
      } catch {
        /* Preserve the rejected authentication result. */
      }
      return { error: "REAUTHENTICATION_FAILED" as const };
    }
    const temporaryPassword =
      "temporaryPassword" in input.data
        ? String(input.data.temporaryPassword)
        : undefined;
    const temporaryHash =
      temporaryPassword !== undefined
        ? await this.passwords.run(() => this.passwords.hash(temporaryPassword))
        : undefined;
    if (temporaryHash === null) return { busy: true as const };
    return this.work.run(
      async (tx) => {
        // Resolve the organization from the authenticated actor, never request data.
        let organizationId: string | undefined;
        if (!masterOnly) {
          const memberships = await tx.members.memberships(initial.userId);
          if (
            memberships.length !== 1 ||
            memberships[0].role !== "ORGANIZATION_ADMIN"
          )
            return null;
          organizationId = memberships[0].organizationId;
          await tx.lock(`organization:${organizationId}`);
        }
        // Match platform mutations: global lock before account locks; ordered accounts
        // also serialize login, logout, MFA, profile edits and target revocation.
        if (masterOnly) await tx.lock("platform-access");
        for (const account of [initial.userId, id].sort())
          await tx.lock(`account:${account}`);
        const actor = await this.sessions.authorized(
          raw,
          masterOnly ? true : false,
          tx.sessions,
        );
        if (!actor || actor.user.passwordHash !== initial.user.passwordHash)
          return null;
        const user = await tx.identities.findById(id);
        if (!user || user.master || user.id === actor.userId) return null;
        if (organizationId) {
          const memberships = await tx.members.memberships(actor.userId);
          const organization = await tx.organizations.find(organizationId);
          const targetMemberships = await tx.members.memberships(id);
          if (
            memberships.length !== 1 ||
            memberships[0].organizationId !== organizationId ||
            memberships[0].role !== "ORGANIZATION_ADMIN" ||
            !organization?.active ||
            organization.deletedAt ||
            user.platformAdmin ||
            targetMemberships.length !== 1 ||
            targetMemberships[0].organizationId !== organizationId ||
            targetMemberships[0].role !== "MEMBER"
          )
            return null;
        }
        if (actor.user.totpVerified) {
          if (!actor.user.totpSecret) return null;
          const step = this.totp.step(
            this.vault.decrypt(actor.user.totpSecret, "totp"),
            input.data.code ?? "",
          );
          if (step === null || step <= actor.user.lastTotpStep) {
            await attemptAudit(tx, {
              action: "auth.mfa_failed",
              actorId: actor.userId,
              resourceId: actor.userId,
            });
            return { error: "MFA_INVALID" as const };
          }
          await tx.identities.updateCredentials(actor.userId, {
            lastTotpStep: step,
          });
        }
        if (kind === "password") {
          await tx.identities.updateCredentials(id, {
            passwordHash: temporaryHash!,
            mustChangePassword: true,
          });
        } else {
          await tx.identities.updateCredentials(id, {
            mfaEnrollmentOptional: true,
            totpSecret: null,
            totpVerified: false,
            lastTotpStep: -1n,
          });
          await tx.identities.deleteRecovery(id);
        }
        await tx.sessions.deleteForUser(id);
        await tx.sessions.deleteDevicesForUser(id);
        const targetMemberships =
          kind === "mfa" ? await tx.members.memberships(id) : [];
        const auditOrganizationId =
          organizationId ??
          (targetMemberships.length === 1
            ? targetMemberships[0].organizationId
            : undefined);
        await recordAudit(tx, {
          action:
            kind === "password"
              ? "account.password_reset"
              : "account.mfa_reset",
          ...(auditOrganizationId
            ? { organizationId: auditOrganizationId }
            : {}),
          actorId: actor.userId,
          resourceId: id,
        });
        await this.rates.clear(tx, key);
        return { ok: true as const };
      },
      { maxWait: 15000, timeout: 15000 },
    );
  }
}
