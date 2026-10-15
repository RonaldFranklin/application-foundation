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
  list(organizationId: string) {
    return persist(async () =>
      (
        await this.db.organizationInvitation.findMany({
          where: { organizationId },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            organizationId: true,
            email: true,
            role: true,
            createdAt: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            deliveredAt: true,
            creator: { select: { username: true } },
          },
        })
      ).map(({ creator, ...invitation }) => ({
        ...invitation,
        creatorUsername: creator.username,
      })),
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
