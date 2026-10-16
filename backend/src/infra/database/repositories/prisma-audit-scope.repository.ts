import { AuditScopeRepository } from "../../../application/audit/scope.repository";
import { PrismaService } from "../prisma/prisma.service";
import { persist } from "./records";
export class PrismaAuditScopeRepository implements AuditScopeRepository {
  constructor(private db: PrismaService) {}
  bind(digest: string, encryptedOrganization: string) {
    return persist(async () => {
      await this.db.session.updateMany({
        where: { digest, auditOrganization: null },
        data: { auditOrganization: encryptedOrganization },
      });
      const session = await this.db.session.findUnique({
        where: { digest },
        select: { auditOrganization: true },
      });
      return session?.auditOrganization ?? null;
    });
  }
}
