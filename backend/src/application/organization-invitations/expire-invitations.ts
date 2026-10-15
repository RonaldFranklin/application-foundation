import { recordAudit } from "../audit/events";
import { UnitOfWork } from "../auth/ports/repositories";
import { Invitation, InvitationsTransaction } from "./ports";
// Caller holds organization lock. Reissue records the old expiry before replacing the emission.
export async function recordInvitationExpiry(
  tx: InvitationsTransaction,
  i: Invitation,
  now: Date,
) {
  if (i.acceptedAt || i.revokedAt || i.expiryAuditedAt || +i.expiresAt > +now)
    return;
  await recordAudit(tx, {
    action: "invitation.expired",
    organizationId: i.organizationId,
    resourceId: i.id,
    occurredAt: i.expiresAt,
  });
  i.expiryAuditedAt = now;
  await tx.invitations.save(i);
}
export class ExpireInvitations {
  constructor(private work: UnitOfWork<InvitationsTransaction>) {}
  async execute(now = new Date()) {
    const candidates = await this.work.run((tx) =>
      tx.invitations.expired(now, 500),
    );
    for (const candidate of candidates) {
      await this.work.run(async (tx) => {
        await tx.lock(`organization:${candidate.organizationId}`);
        const current = await tx.invitations.find(
          candidate.organizationId,
          candidate.id,
        );
        if (current) await recordInvitationExpiry(tx, current, now);
      });
    }
  }
}
