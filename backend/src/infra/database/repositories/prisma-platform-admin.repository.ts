import {
  PlatformAdminsRepository,
  PlatformInvitation,
} from "../../../application/platform-admin/ports";
import { QueryClient, persist, userRecord } from "./records";
export class PrismaPlatformAdminsRepository implements PlatformAdminsRepository {
  constructor(private db: QueryClient) {}
  list() {
    return persist(async () =>
      (
        await this.db.platformAdmin.findMany({
          include: { user: { include: { platformAdmin: true } } },
          orderBy: [{ createdAt: "desc" }, { userId: "asc" }],
        })
      ).map((r) => ({ ...r, user: userRecord(r.user) })),
    );
  }
  save(userId: string, active: boolean, permissions: string[]) {
    return persist(async () => {
      await this.db.platformAdmin.upsert({
        where: { userId },
        create: { userId, active, permissions },
        update: { active, permissions },
      });
    });
  }
  invitation(id: string) {
    return persist(() =>
      this.db.platformAdminInvitation.findUnique({ where: { id } }),
    );
  }
  forEmail(emailFingerprint: string) {
    return persist(() =>
      this.db.platformAdminInvitation.findUnique({
        where: { emailFingerprint },
      }),
    );
  }
  invitations() {
    return persist(() =>
      this.db.platformAdminInvitation.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
    );
  }
  saveInvitation(i: PlatformInvitation) {
    return persist(async () => {
      await this.db.platformAdminInvitation.upsert({
        where: { id: i.id },
        create: i,
        update: i,
      });
    });
  }
}
