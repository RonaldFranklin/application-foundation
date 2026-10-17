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
            where: {
              organizationId_userId: { organizationId, userId },
              deletedAt: null,
            },
            select: { role: true },
          })
        )?.role ?? null,
    );
  }
  memberships(userId: string) {
    return persist(() =>
      this.db.organizationMember.findMany({
        where: { userId, deletedAt: null },
        select: { organizationId: true, role: true },
      }),
    );
  }
  countAdmins(organizationId: string) {
    return persist(() =>
      this.db.organizationMember.count({
        where: { organizationId, role: "ORGANIZATION_ADMIN", deletedAt: null },
      }),
    );
  }
  list(organizationId: string, deleted = false) {
    return persist(async () =>
      (
        await this.db.organizationMember.findMany({
          where: { organizationId, deletedAt: deleted ? { not: null } : null },
          orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
          select: {
            userId: true,
            role: true,
            createdAt: true,
            deletedAt: true,
            user: {
              select: {
                username: true,
                email: true,
                totpSecret: true,
                totpVerified: true,
                lastLoginAt: true,
              },
            },
          },
        })
      ).map(({ user, ...member }) => ({
        ...member,
        username: user.username,
        email: user.email,
        lastLoginAt: user.lastLoginAt,
        mfa: { configured: !!user.totpSecret, verified: user.totpVerified },
      })),
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
            where: { organizationId, userId, deletedAt: null },
            data: { role },
          })
        ).count,
    );
  }
  find(organizationId: string, userId: string) {
    return persist(() =>
      this.db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { role: true, deletedAt: true },
      }),
    );
  }
  setDeletedAt(organizationId: string, userId: string, deletedAt: Date | null) {
    return persist(
      async () =>
        (
          await this.db.organizationMember.updateMany({
            where: { organizationId, userId },
            data: { deletedAt },
          })
        ).count,
    );
  }
}
