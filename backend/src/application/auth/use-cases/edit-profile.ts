import { VerificationTransaction } from "../../email-verification/ports";
import { AuthFailure } from "../results";
import { UnitOfWork } from "../ports/repositories";
import { IdentityProtection, Passwords, Tokens, Totp } from "../ports/security";
import { SessionWithUser } from "../../../domain/auth/models";
import { Sessions } from "./sessions";
import { Rates } from "./rate-limits";
import { profileSchema, changePasswordSchema } from "../validators/auth-input";

export type ProfileEditResult =
  | AuthFailure
  | null
  | { busy: true }
  | { rejected: true }
  | { fields: Record<string, string> }
  | { passwordChanged: boolean };
const messages: Record<string, string> = {
  username: "Informe um usuário de 1 a 100 caracteres.",
  email: "Informe um e-mail válido de até 254 caracteres.",
  currentPassword: "Informe sua senha atual.",
  code: "Informe os seis dígitos do autenticador.",
  newPassword: "Use uma nova senha de 15 a 1024 caracteres.",
  confirmPassword: "A confirmação deve coincidir com a nova senha.",
};
function full(s: SessionWithUser | null): s is SessionWithUser {
  return (
    !!s &&
    +s.expiresAt > Date.now() &&
    s.stage === "full" &&
    !s.user.mustChangePassword &&
    (!s.user.master || (s.user.totpVerified && !!s.user.totpSecret))
  );
}
export class EditProfile {
  constructor(
    private work: UnitOfWork<VerificationTransaction>,
    private sessions: Sessions,
    private passwords: Passwords,
    private vault: IdentityProtection,
    private tokens: Tokens,
    private totp: Totp,
    private rates: Rates,
  ) {}

  async execute(
    raw: string,
    body: unknown,
    passwordChange: boolean,
  ): Promise<ProfileEditResult> {
    const input = (
      passwordChange ? changePasswordSchema : profileSchema
    ).safeParse(body);
    if (!input.success) {
      const fields: Record<string, string> = {};
      for (const issue of input.error.issues) {
        const key = String(issue.path[0] || "form");
        fields[key] = messages[key] || "Solicitação inválida.";
      }
      return { fields };
    }
    const initial = await this.sessions.session(raw);
    if (!full(initial)) return null;
    const key = `profile:${initial.userId}`;
    // Reserve before expensive password work; concurrent attempts share a durable budget.
    const admitted = await this.work.run(async (tx) => {
      await tx.lock(`account:${initial.userId}`);
      const s = await tx.sessions.find(this.tokens.digest(raw));
      if (!full(s) || s.user.passwordHash !== initial.user.passwordHash)
        return "session" as const;
      if ((await this.rates.state(tx, key)).blocked) return "blocked" as const;
      await this.rates.failure(tx, key, s.user.master);
      return true;
    });
    if (admitted === "session") return null;
    if (admitted === "blocked") return { error: "ATTEMPTS_BLOCKED" };
    const data = input.data;
    const checked = await this.passwords.run(async () => {
      if (
        !(await this.passwords.verify(
          initial.user.passwordHash,
          data.currentPassword,
        ))
      )
        return { valid: false };
      if ("newPassword" in data) {
        if (
          await this.passwords.verify(
            initial.user.passwordHash,
            data.newPassword,
          )
        )
          return { valid: true, same: true };
        return {
          valid: true,
          hash: await this.passwords.hash(data.newPassword),
        };
      }
      return { valid: true };
    });
    if (checked === null) return { busy: true };
    if (!checked.valid) return { error: "REAUTHENTICATION_FAILED" };
    return this.work.run(
      async (tx) => {
        await tx.lock(`account:${initial.userId}`);
        const s = await tx.sessions.find(this.tokens.digest(raw));
        if (!full(s) || s.user.passwordHash !== initial.user.passwordHash)
          return null;
        if (s.user.master) {
          const step = this.totp.step(
            this.vault.decrypt(s.user.totpSecret!, "totp"),
            data.code || "",
          );
          if (step === null || step <= s.user.lastTotpStep)
            return { error: "MFA_INVALID" };
          await tx.identities.updateCredentials(s.userId, {
            lastTotpStep: step,
          });
        }
        if (checked.same)
          return {
            fields: { newPassword: "Escolha uma senha diferente da atual." },
          };
        if ("username" in data) {
          // Shared with bootstrap; serializes both identifier namespaces, including cross-field collisions.
          await tx.lock("identity-update");
          const usernameIndex = this.vault.index(data.username),
            emailIndex = this.vault.index(data.email);
          if (
            await tx.identities.findCollision(
              usernameIndex,
              emailIndex,
              s.userId,
            )
          )
            return { rejected: true };
          if (emailIndex !== s.user.emailIndex) {
            await tx.verifications.invalidate(s.userId, new Date());
          }
          await tx.identities.updateCredentials(s.userId, {
            ...(emailIndex !== s.user.emailIndex
              ? { emailVerifiedAt: null }
              : {}),
            username: this.vault.encrypt(data.username, "username"),
            email: this.vault.encrypt(data.email, "email"),
            usernameIndex,
            emailIndex,
          });
        } else {
          await tx.identities.updateCredentials(s.userId, {
            passwordHash: checked.hash!,
          });
          await tx.sessions.deleteForUser(s.userId);
          await tx.sessions.deleteDevicesForUser(s.userId);
        }
        await this.rates.clear(tx, key);
        return { passwordChanged: passwordChange };
      },
      { maxWait: 15000, timeout: 15000 },
    );
  }
}
