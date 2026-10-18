import { z } from "zod";
import { UnitOfWork } from "../auth/ports/repositories";
import { IdentityProtection } from "../auth/ports/security";
import { InvitationSecrets } from "../organization-invitations/ports";
import { EmailSender, EmailFailure } from "../email/email-sender";
import { recordAudit } from "../audit/events";
import { CustomerTransaction } from "./ports";
import { customerPurpose, customerTokenContext } from "./customer-access";
export class DeliverCustomerEmail {
  constructor(
    private work: UnitOfWork<CustomerTransaction>,
    private vault: IdentityProtection,
    private secrets: InvitationSecrets,
    private sender: EmailSender,
    private origin: string,
  ) {}
  async execute(
    data: unknown,
  ): Promise<{ accepted: true } | { ignored: true }> {
    const i = z
      .object({ invitationId: z.uuid(), encryptedToken: z.string().max(2048) })
      .strict()
      .safeParse(data);
    if (!i.success) throw new EmailFailure(false, "EMAIL_INPUT_INVALID");
    return this.work.run(
      async (tx) => {
        const first = await tx.customers.token(i.data.invitationId);
        if (!first) return { ignored: true };
        const initial = await tx.customers.find(first.customerId);
        if (!initial) return { ignored: true };
        await tx.lock(`organization:${initial.organizationId}`);
        await tx.lock(`customer:${initial.id}`);
        const t = await tx.customers.token(first.id),
          c = await tx.customers.find(initial.id),
          org = await tx.organizations.find(initial.organizationId);
        if (
          !t ||
          !c ||
          !org?.active ||
          org.deletedAt ||
          t.consumedAt ||
          t.revokedAt ||
          t.deliveredAt ||
          +t.expiresAt <= Date.now() ||
          c.status !== (t.kind === "invitation" ? "pending" : "active")
        )
          return { ignored: true };
        const context = customerTokenContext(t),
          secret = this.secrets.decrypt(i.data.encryptedToken, context);
        if (!this.secrets.matches(secret, context, t.digest))
          return { ignored: true };
        const path = t.kind === "invitation" ? "accept" : "reset";
        await this.sender.send({
          correlationId: t.id,
          to: this.vault.decrypt(c.email, customerPurpose(c, "email")),
          subject:
            t.kind === "invitation"
              ? "Convite para sua conta de cliente"
              : "Recuperação da conta de cliente",
          text: `Abra o link para continuar: ${this.origin}/customer/${path}#token=${t.id}.${secret}\nSe você não solicitou, ignore esta mensagem.`,
        });
        t.deliveredAt = new Date();
        await tx.customers.saveToken(t);
        await recordAudit(tx, {
          action: "customer.email_delivered",
          organizationId: c.organizationId,
          resourceId: c.id,
        });
        return { accepted: true };
      },
      { maxWait: 15000, timeout: 60000 },
    );
  }
}
