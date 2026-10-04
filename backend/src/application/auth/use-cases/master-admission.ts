import { UnitOfWork } from "../ports/repositories";
import { AuthSettings } from "../auth-settings";
import { Tokens } from "../ports/security";
import { Rates } from "./rate-limits";
export class MasterAdmission {
  constructor(
    private work: UnitOfWork,
    private c: AuthSettings,
    private rates: Rates,
    private tokens: Tokens,
  ) {}
  // Challenges reflect endpoint-wide pressure, never a queried user's type/existence.
  async challengeRequired() {
    const risk = await this.rates.read("master-risk");
    return risk.hits.length >= this.c.TURNSTILE_THRESHOLD || risk.cycles > 0;
  }
  async reserveMasterAttempt(
    deviceRaw: string | undefined,
    captchaOk: boolean,
  ) {
    return this.work.run(
      async (tx) => {
        await tx.lock("master-risk");
        const risk = await this.rates.state(tx, "master-risk");
        const required =
          risk.hits.length >= this.c.TURNSTILE_THRESHOLD || risk.cycles > 0;
        if (required && !captchaOk) return false;
        const device =
          deviceRaw && /^[A-Za-z0-9_-]{43}$/.test(deviceRaw)
            ? await tx.sessions.findDevice(this.tokens.digest(deviceRaw))
            : null;
        const trusted =
          device &&
          +device.expiresAt > Date.now() &&
          device.user.master &&
          device.user.totpVerified &&
          !device.user.mustChangePassword;
        const key = trusted
          ? `master-device:${device.digest}`
          : "master-anonymous";
        await tx.lock(key);
        if ((await this.rates.state(tx, key)).blocked) return false;
        // Reserve before Argon2: replicas cannot all pass a stale failure count.
        // Count every admitted password verification, including a pending MFA login.
        await this.rates.failure(tx, key, true);
        await this.rates.failure(tx, "master-risk", true);
        return true;
      },
      { maxWait: 5000, timeout: 5000 },
    );
  }
}
