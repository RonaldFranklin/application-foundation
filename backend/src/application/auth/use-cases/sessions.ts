import { AccountProfile } from "../results";
import {
  SessionRepository,
  AuthTransaction,
  UnitOfWork,
} from "../ports/repositories";
import { AuthSettings } from "../auth-settings";
import { IdentityProtection, Tokens } from "../ports/security";
import { Stage } from "../../../domain/auth/models";
import { logoutSchema } from "../validators/auth-input";
export class Sessions {
  constructor(
    private records: SessionRepository,
    private work: UnitOfWork,
    private c: AuthSettings,
    private vault: IdentityProtection,
    private tokens: Tokens,
  ) {}
  async createSession(
    tx: AuthTransaction,
    userId: string,
    stage: Stage,
    previous?: string,
    previousDevice?: string,
  ) {
    if (previous) await tx.sessions.delete(this.tokens.digest(previous));
    const raw = this.tokens.generate();
    const seconds = stage === "full" ? this.c.SESSION_HOURS * 3600 : 600;
    await tx.sessions.create({
      digest: this.tokens.digest(raw),
      userId,
      stage,
      expiresAt: new Date(Date.now() + seconds * 1000),
    });
    let deviceRaw: string | undefined;
    if (stage === "full") {
      const user = await tx.identities.requireById(userId);
      if (user.master && user.totpVerified && !user.mustChangePassword) {
        if (previousDevice && /^[A-Za-z0-9_-]{43}$/.test(previousDevice)) {
          await tx.sessions.deleteDevice(
            this.tokens.digest(previousDevice),
            userId,
          );
        }
        deviceRaw = this.tokens.generate();
        await tx.sessions.createDevice({
          digest: this.tokens.digest(deviceRaw),
          userId,
          expiresAt: new Date(
            Date.now() + this.c.MASTER_DEVICE_DAYS * 86400000,
          ),
        });
        const surplus = await tx.sessions.deviceDigestsAfter(userId, 10);
        await tx.sessions.deleteDevices(surplus);
      }
    }
    return { raw, stage, seconds, ...(deviceRaw ? { deviceRaw } : {}) };
  }
  async session(raw: string | undefined) {
    if (!raw || raw.length > 100) return null;
    const s = await this.records.find(this.tokens.digest(raw));
    return s && +s.expiresAt > Date.now() ? s : null;
  }
  async restricted<T>(
    raw: string,
    stages: Stage[],
    action: (
      tx: AuthTransaction,
      s: NonNullable<Awaited<ReturnType<Sessions["session"]>>>,
    ) => Promise<T>,
  ) {
    const initial = await this.session(raw);
    if (!initial) return null;
    return this.work.run(
      async (tx) => {
        await tx.lock(`account:${initial.userId}`);
        const s = await tx.sessions.find(this.tokens.digest(raw));
        if (
          !s ||
          +s.expiresAt <= Date.now() ||
          !s.user.master ||
          !stages.includes(s.stage as Stage)
        )
          return null;
        return action(tx, s);
      },
      { maxWait: 15000, timeout: 15000 },
    );
  }
  async state(raw: string | undefined) {
    const session = await this.session(raw);
    return session
      ? { stage: session.stage, master: session.user.master }
      : null;
  }
  async logout(raw: string | undefined, body: unknown, deviceRaw?: string) {
    const input = logoutSchema.safeParse(body);
    if (!input.success) return { invalid: "logout" as const };
    if (raw) await this.records.delete(this.tokens.digest(raw));
    if (input.data.forgetDevice) {
      try {
        if (deviceRaw && /^[A-Za-z0-9_-]{43}$/.test(deviceRaw))
          await this.records.deleteDevice(this.tokens.digest(deviceRaw));
      } catch {
        // Preserve the HTTP session-cookie revocation even if device deletion fails later.
        return { forgetDevice: true, deviceRevocationFailed: true as const };
      }
    }
    return { forgetDevice: !!input.data.forgetDevice };
  }
  async authorized(raw: string | undefined, master: boolean) {
    const s = await this.session(raw);
    return s &&
      s.stage === "full" &&
      s.user.master === master &&
      !s.user.mustChangePassword &&
      (!master || (s.user.totpVerified && !s.user.mustChangePassword))
      ? s
      : null;
  }
  async welcome(
    raw: string | undefined,
    master: boolean,
  ): Promise<AccountProfile | null> {
    const s = await this.authorized(raw, master);
    if (!s) return null;
    return {
      message: "Bem-vindo ao Application Foundation.",
      username: this.vault.decrypt(s.user.username, "username"),
      email: this.vault.decrypt(s.user.email, "email"),
      accountType: s.user.master ? "master" : "common",
      mfa: { configured: !!s.user.totpSecret, verified: s.user.totpVerified },
    };
  }
}
