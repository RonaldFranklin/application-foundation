import { MembersRepository } from "../../../application/organizations/ports/members.repository";
import { OrganizationRole } from "../../../domain/organizations/models";
import { persist, QueryClient } from "./records";
export class PrismaMembersRepository implements MembersRepository {
  constructor(private db: QueryClient) {}
  role(organizationId: string, userId: string) {
    return persist(
      async () =>
        (
          await this.db.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId } },
            select: { role: true },
          })
        )?.role ?? null,
    );
  }
  memberships(userId: string) {
    return persist(() =>
      this.db.organizationMember.findMany({
        where: { userId },
        select: { organizationId: true, role: true },
      }),
    );
  }
  countAdmins(organizationId: string) {
    return persist(() =>
      this.db.organizationMember.count({
        where: { organizationId, role: "ORGANIZATION_ADMIN" },
      }),
    );
  }
  list(organizationId: string) {
    return persist(async () =>
      (
        await this.db.organizationMember.findMany({
          where: { organizationId },
          orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
          select: {
            userId: true,
            role: true,
            createdAt: true,
            user: { select: { username: true, email: true } },
          },
        })
      ).map(({ user, ...member }) => ({ ...member, ...user })),
    );
  }
  exists(organizationId: string, userId: string) {
    return persist(
      async () =>
        !!(await this.db.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
          select: { userId: true },
        })),
    );
  }
  insert(organizationId: string, userId: string, role: OrganizationRole) {
    return persist(
      async () =>
        (
          await this.db.organizationMember.createMany({
            data: [{ organizationId, userId, role }],
            skipDuplicates: true,
          })
        ).count,
    );
  }
  update(organizationId: string, userId: string, role: OrganizationRole) {
    return persist(
      async () =>
        (
          await this.db.organizationMember.updateMany({
            where: { organizationId, userId },
            data: { role },
          })
        ).count,
    );
  }
  remove(organizationId: string, userId: string) {
    return persist(
      async () =>
        (
          await this.db.organizationMember.deleteMany({
            where: { organizationId, userId },
          })
        ).count,
    );
  }
}
