import {
  AuditQuery,
  AuditQueryRepository,
} from "../../../application/audit/query.repository";
import { PrismaService } from "../prisma/prisma.service";
import { persist } from "./records";
export class PrismaAuditQueryRepository implements AuditQueryRepository {
  constructor(private db: PrismaService) {}
  list(query: AuditQuery) {
    return persist(async () => {
      if (
        query.organizationIndex &&
        (await this.db.auditEvent.findFirst({
          where: { organizationIndex: null },
          select: { id: true },
        }))
      )
        throw new Error("AUDIT_INDEX_UNAVAILABLE");
      const where = {
        organizationIndex: query.organizationIndex,
        action: query.action,
        outcome: query.outcome,
        occurredAt: { gte: query.from, lte: query.to },
      };
      const [items, total] = await this.db.$transaction(
        [
          this.db.auditEvent.findMany({
            where,
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          this.db.auditEvent.count({ where }),
        ],
        { isolationLevel: "RepeatableRead" },
      );
      return { items, total };
    });
  }
  find(id: string) {
    return persist(() => this.db.auditEvent.findUnique({ where: { id } }));
  }
}
