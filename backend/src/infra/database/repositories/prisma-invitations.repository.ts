import {
  Invitation,
  InvitationsRepository,
} from "../../../application/organization-invitations/ports";
import { QueryClient, persist } from "./records";
export class PrismaInvitationsRepository implements InvitationsRepository {
  constructor(private db: QueryClient) {}
  locate(id: string) {
    return persist(() =>
      this.db.organizationInvitation.findUnique({ where: { id } }),
    );
  }
  find(organizationId: string, id: string) {
    return persist(() =>
      this.db.organizationInvitation.findFirst({
        where: { id, organizationId },
      }),
    );
  }
  forEmail(organizationId: string, emailFingerprint: string) {
    return persist(() =>
      this.db.organizationInvitation.findUnique({
        where: {
          organizationId_emailFingerprint: { organizationId, emailFingerprint },
        },
      }),
    );
  }
  pending(organizationId: string, now: Date) {
    return persist(() =>
      this.db.organizationInvitation.findMany({
        where: {
          organizationId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
    );
  }
  async save(i: Invitation) {
    await persist(() =>
      this.db.organizationInvitation.upsert({
        where: { id: i.id, organizationId: i.organizationId },
        create: i,
        update: i,
      }),
    );
  }
}
