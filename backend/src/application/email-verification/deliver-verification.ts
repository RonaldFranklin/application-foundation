import { z } from "zod";
import { UnitOfWork } from "../auth/ports/repositories";
import { IdentityProtection } from "../auth/ports/security";
import { EmailFailure, EmailSender } from "../email/email-sender";
import {
  VerificationSecrets,
  VerificationTransaction,
  verificationContext,
} from "./ports";
export class DeliverVerification {
  constructor(
    private work: UnitOfWork<VerificationTransaction>,
    private secrets: VerificationSecrets,
    private vault: IdentityProtection,
    private sender: EmailSender,
    private now: () => number = Date.now,
  ) {}
  async execute(
    body: unknown,
  ): Promise<{ accepted: true } | { ignored: true }> {
    const input = z
      .object({
        challengeId: z.uuid(),
        encryptedCode: z.string().min(1).max(512),
      })
      .strict()
      .safeParse(body);
    if (!input.success) throw new EmailFailure(false, "EMAIL_INPUT_INVALID");
    const initial = await this.work.run((tx) =>
      tx.verifications.find(input.data.challengeId),
    );
    if (!initial) return { ignored: true };
    return this.work.run(
      async (tx) => {
        // Serialize with profile changes and challenge rotation until SMTP acceptance.
        await tx.lock(`account:${initial.userId}`);
        const c = await tx.verifications.forUser(initial.userId);
        const user = await tx.identities.findById(initial.userId);
        if (
          !c ||
          !user ||
          c.id !== input.data.challengeId ||
          c.consumedAt ||
          c.deliveredAt ||
          !c.digest ||
          c.attempts >= 5 ||
          +c.expiresAt <= this.now() ||
          user.emailVerifiedAt ||
          c.emailFingerprint !== user.emailIndex
        )
          return { ignored: true };
        let code: string;
        try {
          code = this.secrets.decrypt(
            input.data.encryptedCode,
            verificationContext(c),
          );
          if (
            !/^\d{6}$/.test(code) ||
            !this.secrets.matches(code, verificationContext(c), c.digest)
          )
            throw new Error();
        } catch {
          throw new EmailFailure(false, "EMAIL_INPUT_INVALID");
        }
        // Plaintext exists only in this call; never included in the job or an exception.
        try {
          const result = await this.sender.send({
            correlationId: c.id,
            to: this.vault.decrypt(user.email, "email"),
            subject: "Verifique seu e-mail — Application Foundation",
            text: `Seu código de verificação é ${code}. Ele expira em 10 minutos após a solicitação. Se você não solicitou este código, ignore esta mensagem.`,
          });
          if (!result.accepted)
            throw new EmailFailure(true, "EMAIL_DELIVERY_UNAVAILABLE");
        } catch (error) {
          if (error instanceof EmailFailure) throw error;
          throw new EmailFailure(true, "EMAIL_DELIVERY_UNAVAILABLE");
        }
        c.deliveredAt = new Date(this.now());
        await tx.verifications.save(c);
        return { accepted: true };
      },
      { maxWait: 15000, timeout: 60000 },
    );
  }
}
