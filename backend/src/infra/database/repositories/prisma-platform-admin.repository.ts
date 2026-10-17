import {
  PlatformAdminsRepository,
  PlatformInvitation,
} from "../../../application/platform-admin/ports";
import { QueryClient, persist, userRecord } from "./records";
export class PrismaPlatformAdminsRepository implements PlatformAdminsRepository {
  constructor(private db: QueryClient) {}
  roles() {
    return persist(() =>
      this.db.platformRole.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    );
  }
  role(id: string) {
    return persist(() => this.db.platformRole.findUnique({ where: { id } }));
  }
  saveRole(
    data: { name: string; nameKey: string; permissions: string[] },
    id?: string,
  ) {
    return persist(() =>
      id
        ? this.db.platformRole.update({
            where: { id },
            data: { ...data, version: { increment: 1 } },
          })
        : this.db.platformRole.create({ data }),
    );
  }
  deleteRole(id: string) {
    return persist(async () => {
      await this.db.platformRole.delete({ where: { id } });
    });
  }
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
  save(
    userId: string,
    active: boolean,
    permissions: string[],
    roleId?: string | null,
  ) {
    return persist(async () => {
      await this.db.platformAdmin.upsert({
        where: { userId },
        create: { userId, active, permissions, roleId },
        update: { active, permissions, roleId },
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
