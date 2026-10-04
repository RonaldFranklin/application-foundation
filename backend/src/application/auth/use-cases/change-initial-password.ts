import { UnitOfWork } from "../ports/repositories";

import { Tokens, Passwords } from "../ports/security";
import { Sessions } from "./sessions";
import {
  passwordSchema,
  initialCommonPasswordSchema,
} from "../validators/auth-input";
export class ChangeInitialPassword {
  constructor(
    private work: UnitOfWork,
    private sessions: Sessions,
    private passwords: Passwords,
    private tokens: Tokens,
  ) {}
  async execute(raw: string, body: unknown, master = true) {
    const input = (
      master ? passwordSchema : initialCommonPasswordSchema
    ).safeParse(body);
    if (!input.success)
      return {
        invalid: master ? ("password" as const) : ("initial-password" as const),
      };
    const { password } = input.data;
    const initial = await this.sessions.session(raw);
    if (
      !initial ||
      initial.user.master !== master ||
      initial.stage !== "password" ||
      !initial.user.mustChangePassword
    )
      return null;

    const previousHash = initial.user.passwordHash;
    const samePassword = await this.passwords.run(() =>
      this.passwords.verify(previousHash, password),
    );
    if (samePassword === null) return { busy: true as const };
    if (samePassword) return { error: "PASSWORD_REUSED" as const };

    const newHash = await this.passwords.run(() =>
      this.passwords.hash(password),
    );
    if (newHash === null) return { busy: true as const };

    return this.work.run(
      async (tx) => {
        await tx.lock(`account:${initial.userId}`);
        const current = await tx.sessions.find(this.tokens.digest(raw));
        if (
          !current ||
          +current.expiresAt <= Date.now() ||
          current.stage !== "password" ||
          current.user.master !== master ||
          current.userId !== initial.userId ||
          !current.user.mustChangePassword ||
          current.user.passwordHash !== previousHash
        )
          return null;

        await tx.identities.updateCredentials(initial.userId, {
          passwordHash: newHash,
          mustChangePassword: false,
        });
        await tx.sessions.deleteForUser(initial.userId);
        await tx.sessions.deleteDevicesForUser(initial.userId);
        return this.sessions.createSession(
          tx,
          initial.userId,
          master ? "setup" : "full",
        );
      },
      { maxWait: 5000, timeout: 5000 },
    );
  }
}
