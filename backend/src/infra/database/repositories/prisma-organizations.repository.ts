import {
  OrganizationsRepository,
  OrganizationQuery,
} from "../../../application/organizations/ports/organizations.repository";
import { PrismaService } from "../prisma/prisma.service";
import { persist } from "./records";
export class PrismaOrganizationsRepository implements OrganizationsRepository {
  constructor(private db: PrismaService) {}
  create(name: string) {
    return persist(() => this.db.organization.create({ data: { name } }));
  }
  find(id: string) {
    return persist(() => this.db.organization.findUnique({ where: { id } }));
  }
  update(id: string, data: { name?: string; active?: boolean }) {
    return persist(async () => {
      const rows = await this.db.organization.updateManyAndReturn({
        where: { id },
        data,
      });
      return rows[0] ?? null;
    });
  }
  list(query: OrganizationQuery) {
    return persist(async () => {
      const where = {
        active: query.active,
        name: {
          contains: query.search.replace(/[\\%_]/g, "\\$&"),
          mode: "insensitive" as const,
        },
      };
      const [items, total] = await this.db.$transaction(
        [
          this.db.organization.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          this.db.organization.count({ where }),
        ],
        { isolationLevel: "RepeatableRead" },
      );
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }
}
