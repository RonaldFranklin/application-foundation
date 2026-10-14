import { z } from "zod";
import { UnitOfWork } from "../auth/ports/repositories";
import { IdentityProtection } from "../auth/ports/security";
import { EmailFailure, EmailSender } from "../email/email-sender";
import {
  InvitationSecrets,
  InvitationsTransaction,
  invitationContext,
  invitationEmailPurpose,
} from "./ports";
export class DeliverInvitation {
  constructor(
    private work: UnitOfWork<InvitationsTransaction>,
    private secrets: InvitationSecrets,
    private vault: IdentityProtection,
    private sender: EmailSender,
    private origin: string,
    private now: () => number = Date.now,
  ) {}
  async execute(
    body: unknown,
  ): Promise<{ accepted: true } | { ignored: true }> {
    const input = z
      .object({
        invitationId: z.uuid(),
        encryptedToken: z.string().min(1).max(512),
      })
      .strict()
      .safeParse(body);
    if (!input.success) throw new EmailFailure(false, "EMAIL_INPUT_INVALID");
    const initial = await this.work.run((tx) =>
      tx.invitations.locate(input.data.invitationId),
    );
    if (!initial) return { ignored: true };
    return this.work.run(
      async (tx) => {
        await tx.lock(`organization:${initial.organizationId}`);
        const i = await tx.invitations.find(initial.organizationId, initial.id);
        const org = await tx.organizations.find(initial.organizationId);
        if (
          !i ||
          !org?.active ||
          org.deletedAt ||
          i.acceptedAt ||
          i.revokedAt ||
          i.deliveredAt ||
          +i.expiresAt <= this.now()
        )
          return { ignored: true };
        let token: string;
        try {
          token = this.secrets.decrypt(
            input.data.encryptedToken,
            invitationContext(i),
          );
          if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error();
          // A valid old envelope is an obsolete job after rotation, not a delivery error.
          if (!this.secrets.matches(token, invitationContext(i), i.digest))
            return { ignored: true };
        } catch {
          throw new EmailFailure(false, "EMAIL_INPUT_INVALID");
        }
        try {
          const link = `${this.origin}/invitations/accept#token=${i.id}.${token}`;
          const result = await this.sender.send({
            correlationId: i.id,
            to: this.vault.decrypt(i.email, invitationEmailPurpose(i)),
            subject: "Convite para uma organização — Application Foundation",
            text: `Você recebeu um convite para participar de ${org.name}. Abra ${link} para conferir e aceitar. O convite expira em 7 dias após o envio. Se não esperava este convite, ignore esta mensagem.`,
          });
          if (!result.accepted) throw new Error();
        } catch (error) {
          if (error instanceof EmailFailure)
            throw new EmailFailure(
              error.retryable,
              "EMAIL_DELIVERY_UNAVAILABLE",
            );
          throw new EmailFailure(true, "EMAIL_DELIVERY_UNAVAILABLE");
        }
        i.deliveredAt = new Date(this.now());
        await tx.invitations.save(i);
        return { accepted: true };
      },
      { maxWait: 15000, timeout: 60000 },
    );
  }
}
