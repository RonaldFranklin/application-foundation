import { IdentityRepository, UnitOfWork } from "../ports/repositories";

import {
  IdentityProtection,
  Passwords,
  Captcha,
  SecurityEvents,
} from "../ports/security";
import { Stage } from "../../../domain/auth/models";
import { LoginResult } from "../results";
import { loginSchema } from "../validators/auth-input";
import { Rates } from "./rate-limits";
import { Sessions } from "./sessions";
import { MasterAdmission } from "./master-admission";
export class Login {
  constructor(
    private identities: IdentityRepository,
    private work: UnitOfWork,
    private vault: IdentityProtection,
    private rates: Rates,
    private sessions: Sessions,
    private passwords: Passwords,
    private admission: MasterAdmission,
    private captcha: Captcha,
    private events: SecurityEvents,
  ) {}
  async execute(
    master: boolean,
    body: unknown,
    context: { ip: string; previous?: string; deviceRaw?: string },
  ): Promise<LoginResult> {
    const input = loginSchema.safeParse(body);
    if (!input.success)
      return {
        ok: false as const,
        challengeRequired: master && (await this.admission.challengeRequired()),
      };
    const { identifier, password, turnstileToken: challenge } = input.data;
    const { ip, previous, deviceRaw } = context;
    if (master) {
      const required = await this.admission.challengeRequired();
      const captchaOk =
        !!challenge && (await this.captcha.verify(challenge, ip));
      if (
        (required && !captchaOk) ||
        !(await this.admission.reserveMasterAttempt(deviceRaw, captchaOk))
      )
        return this.rejected(master, await this.admission.challengeRequired());
    }
    // The ordinary route never looks up master records, never challenges, and
    // never modifies their counters. Unknown and wrong-flow identities use the dummy hash.
    const index = this.vault.index(identifier);
    const user = await this.identities.findByIndex(index, master);
    const key = user
      ? `account:${user.id}`
      : `unknown-ip:${this.vault.index(ip || "unknown", "ip")}`;
    const observedHash = user?.passwordHash || this.passwords.dummy;
    // Ordinary failures take the same Argon2 path even for blocked accounts.
    // Skipping only existing accounts would introduce a timing/capacity oracle.
    const valid = await this.passwords.run(() =>
      this.passwords.verify(observedHash, password),
    );
    if (valid === null) return { busy: true as const };
    const result = await this.work.run(
      async (tx) => {
        await tx.lock(key);
        const current = user ? await tx.identities.findById(user.id) : null;
        const blocked = !master && (await this.rates.state(tx, key)).blocked;
        if (
          blocked ||
          !valid ||
          !current ||
          current.passwordHash !== observedHash ||
          (current.usernameIndex !== index && current.emailIndex !== index) ||
          current.master !== master
        ) {
          if (!master) await this.rates.failure(tx, key);
          return { ok: false as const };
        }
        if (!master) await this.rates.clear(tx, key);
        const stage: Stage = master
          ? current.mustChangePassword
            ? "password"
            : current.totpVerified
              ? "mfa"
              : "setup"
          : current.mustChangePassword
            ? "password"
            : "full";
        return {
          ok: true as const,
          ...(await this.sessions.createSession(
            tx,
            current.id,
            stage,
            previous,
          )),
        };
      },
      { maxWait: 5000, timeout: 5000 },
    );
    if (result.ok) {
      this.events.login("password_accepted", master);
      return result;
    }
    return this.rejected(
      master,
      master && (await this.admission.challengeRequired()),
    );
  }
  private rejected(master: boolean, challengeRequired: boolean) {
    this.events.login("login_failed", master);
    return { ok: false as const, challengeRequired };
  }
}
