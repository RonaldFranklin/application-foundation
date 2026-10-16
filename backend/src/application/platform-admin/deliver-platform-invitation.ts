import { z } from "zod";
import { UnitOfWork } from "../auth/ports/repositories";
import { IdentityProtection } from "../auth/ports/security";
import { InvitationSecrets } from "../organization-invitations/ports";
import { EmailFailure, EmailSender } from "../email/email-sender";
import { recordAudit } from "../audit/events";
import {
  PlatformTransaction,
  platformContext,
  platformEmailPurpose,
} from "./ports";
export class DeliverPlatformInvitation {
  constructor(
    private work: UnitOfWork<PlatformTransaction>,
    private secrets: InvitationSecrets,
    private vault: IdentityProtection,
    private sender: EmailSender,
    private origin: string,
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
    return this.work.run(
      async (tx) => {
        await tx.lock("platform-access");
        const i = await tx.platformAdmins.invitation(input.data.invitationId);
        if (
          !i ||
          i.acceptedAt ||
          i.revokedAt ||
          i.deliveredAt ||
          i.attempts >= 10 ||
          +i.expiresAt <= Date.now()
        )
          return { ignored: true };
        let token: string;
        try {
          token = this.secrets.decrypt(
            input.data.encryptedToken,
            platformContext(i),
          );
          if (!this.secrets.matches(token, platformContext(i), i.digest))
            return { ignored: true };
        } catch {
          throw new EmailFailure(false, "EMAIL_INPUT_INVALID");
        }
        try {
          const link = `${this.origin}/admin/invitations/accept#token=${i.id}.${token}`;
          const result = await this.sender.send({
            correlationId: i.id,
            to: this.vault.decrypt(i.email, platformEmailPurpose(i)),
            subject: "Convite de administrador — Application Foundation",
            text: `Você recebeu um convite para administrar a plataforma com permissões limitadas. Defina sua senha em ${link} e configure MFA no login administrativo. O convite expira em sete dias. Se não esperava este convite, ignore esta mensagem.`,
          });
          if (!result.accepted) throw new Error();
        } catch {
          throw new EmailFailure(true, "EMAIL_DELIVERY_UNAVAILABLE");
        }
        i.deliveredAt = new Date();
        await tx.platformAdmins.saveInvitation(i);
        await recordAudit(tx, {
          action: "platform_invitation.delivered",
          resourceId: i.id,
        });
        return { accepted: true };
      },
      { maxWait: 15000, timeout: 60000 },
    );
  }
}
