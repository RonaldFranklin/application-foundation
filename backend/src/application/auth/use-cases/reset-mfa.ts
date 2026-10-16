import { z } from "zod";
import { recordAudit, attemptAudit } from "../../audit/events";
import { UnitOfWork } from "../ports/repositories";
import { IdentityProtection, Passwords, Totp } from "../ports/security";
import { Sessions } from "./sessions";
import { Rates } from "./rate-limits";
const inputSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

export class ResetMfa {
  constructor(
    private work: UnitOfWork,
    private sessions: Sessions,
    private passwords: Passwords,
    private vault: IdentityProtection,
    private totp: Totp,
    private rates: Rates,
  ) {}
  async execute(raw: string | undefined, targetId: unknown, body: unknown) {
    const initial = await this.sessions.authorized(raw, true);
    if (!initial || !initial.user.totpSecret) return null;
    const input = inputSchema.safeParse(body);
    const target = z.uuid().safeParse(targetId);
    if (!input.success || !target.success)
      return { invalid: "mfa-reset" as const };
    const id = target.data.toLowerCase();
    if (id === initial.userId) return null;
    // Same per-account budget as profile reauthentication, reserved before Argon2.
    const key = `profile:${initial.userId}`;
    const admitted = await this.work.run(async (tx) => {
      await tx.lock(`account:${initial.userId}`);
      const actor = await this.sessions.authorized(raw, true, tx.sessions);
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
    return this.work.run(
      async (tx) => {
        // Match platform mutations: global lock before account locks; ordered accounts
        // also serialize login, logout, MFA, profile edits and target revocation.
        await tx.lock("platform-access");
        for (const account of [initial.userId, id].sort())
          await tx.lock(`account:${account}`);
        const actor = await this.sessions.authorized(raw, true, tx.sessions);
        if (
          !actor ||
          !actor.user.totpSecret ||
          actor.user.passwordHash !== initial.user.passwordHash
        )
          return null;
        const user = await tx.identities.findById(id);
        if (!user || user.master || user.id === actor.userId) return null;
        const step = this.totp.step(
          this.vault.decrypt(actor.user.totpSecret, "totp"),
          input.data.code,
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
        await tx.identities.updateCredentials(id, {
          totpSecret: null,
          totpVerified: false,
          lastTotpStep: -1n,
        });
        await tx.identities.deleteRecovery(id);
        await tx.sessions.deleteForUser(id);
        await tx.sessions.deleteDevicesForUser(id);
        await recordAudit(tx, {
          action: "account.mfa_reset",
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
