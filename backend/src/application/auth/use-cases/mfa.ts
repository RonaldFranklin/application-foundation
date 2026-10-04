import { IdentityProtection, Tokens, Totp } from "../ports/security";
import { Rates } from "./rate-limits";
import { Sessions } from "./sessions";
import { codeSchema } from "../validators/auth-input";
export class Mfa {
  constructor(
    private vault: IdentityProtection,
    private rates: Rates,
    private sessions: Sessions,
    private tokens: Tokens,
    private totp: Totp,
  ) {}
  async setup(raw: string) {
    return this.sessions.restricted(raw, ["setup"], async (tx, s) => {
      if (s.user.mustChangePassword || s.user.totpVerified) return null;
      const secret = s.user.totpSecret
        ? this.vault.decrypt(s.user.totpSecret, "totp")
        : this.totp.generateSecret();
      if (!s.user.totpSecret)
        await tx.identities.updateCredentials(s.userId, {
          totpSecret: this.vault.encrypt(secret, "totp"),
        });
      return { secret, uri: this.totp.uri(secret) };
    });
  }
  async mfa(
    raw: string,
    body: unknown,
    enroll: boolean,
    previousDevice?: string,
  ) {
    const input = codeSchema.safeParse(body);
    if (!input.success) return { error: "MFA_INVALID" as const };
    const { code } = input.data;
    return this.sessions.restricted(
      raw,
      [enroll ? "setup" : "mfa"],
      async (tx, s) => {
        const key = `mfa:${s.userId}`,
          state = await this.rates.state(tx, key);
        if (state.blocked) return { error: "ATTEMPTS_BLOCKED" as const };
        if (!s.user.totpSecret || s.user.mustChangePassword) return null;
        const step = this.totp.step(
          this.vault.decrypt(s.user.totpSecret, "totp"),
          code,
        );
        let valid = step !== null && step > s.user.lastTotpStep;
        if (!valid && !enroll && /^[a-f0-9]{32}$/.test(code)) {
          valid =
            (await tx.identities.consumeRecovery(
              s.userId,
              this.tokens.digest(code),
            )) === 1;
        } else if (valid)
          await tx.identities.updateCredentials(s.userId, {
            lastTotpStep: step!,
          });
        if (!valid) {
          await this.rates.failure(tx, key, true);
          return { error: "MFA_INVALID" as const };
        }
        await this.rates.clear(tx, key);
        // Password-only failures cannot freeze a session that already proved its password.
        await tx.lock("master-risk");
        await this.rates.clear(tx, "master-risk");
        await tx.lock("master-anonymous");
        await this.rates.clear(tx, "master-anonymous");
        let recoveryCodes: string[] | undefined;
        if (enroll) {
          recoveryCodes = Array.from({ length: 10 }, () =>
            this.tokens.recoveryCode(),
          );
          await tx.identities.updateCredentials(s.userId, {
            totpVerified: true,
          });
          await tx.identities.deleteRecovery(s.userId);
          await tx.identities.createRecovery(
            s.userId,
            recoveryCodes.map((code) => this.tokens.digest(code)),
          );
          await tx.sessions.deleteForUser(s.userId);
        }
        return {
          ...(await this.sessions.createSession(
            tx,
            s.userId,
            enroll ? "recovery" : "full",
            raw,
            previousDevice,
          )),
          ...(recoveryCodes ? { recoveryCodes } : {}),
        };
      },
    );
  }
  async confirm(raw: string, previousDevice?: string) {
    return this.sessions.restricted(raw, ["recovery"], async (tx, s) =>
      this.sessions.createSession(tx, s.userId, "full", raw, previousDevice),
    );
  }
}
