import {
  Customer,
  CustomerSession,
  CustomerToken,
} from "../../../domain/customers/models";
import { CustomersRepository } from "../../../application/customers/ports";
import { QueryClient } from "./records";
export class PrismaCustomersRepository implements CustomersRepository {
  constructor(private db: QueryClient) {}
  find(id: string, organizationId?: string) {
    return this.db.customer.findFirst({ where: { id, organizationId } });
  }
  byEmail(emailIndex: string) {
    return this.db.customer.findUnique({ where: { emailIndex } });
  }
  async list(
    organizationId: string,
    emailIndex: string | undefined,
    skip: number,
    take: number,
  ) {
    const where = { organizationId, emailIndex };
    const [items, total] = await Promise.all([
      this.db.customer.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.db.customer.count({ where }),
    ]);
    return { items, total };
  }
  async save(c: Customer) {
    await this.db.customer.upsert({
      where: { id: c.id },
      create: c,
      update: c,
    });
  }
  session(digest: string) {
    return this.db.customerSession.findUnique({ where: { digest } });
  }
  sessions(customerId: string, now: Date) {
    return this.db.customerSession.findMany({
      where: { customerId, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
  }
  async saveSession(s: CustomerSession) {
    await this.db.customerSession.create({ data: s });
  }
  async revokeSessions(
    customerId: string,
    publicId?: string,
    exceptDigest?: string,
  ) {
    await this.db.customerSession.deleteMany({
      where: {
        customerId,
        publicId,
        ...(exceptDigest ? { digest: { not: exceptDigest } } : {}),
      },
    });
  }
  token(id: string) {
    return this.db.customerToken.findUnique({ where: { id } });
  }
  latestToken(customerId: string, kind: string) {
    return this.db.customerToken.findFirst({
      where: { customerId, kind },
      orderBy: { createdAt: "desc" },
    });
  }
  async saveToken(t: CustomerToken) {
    await this.db.customerToken.upsert({
      where: { id: t.id },
      create: t,
      update: t,
    });
  }
  async revokeTokens(customerId: string, kind: string) {
    await this.db.customerToken.updateMany({
      where: { customerId, kind, consumedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  async replaceRecovery(customerId: string, digests: string[]) {
    await this.db.customerRecoveryCode.deleteMany({ where: { customerId } });
    await this.db.customerRecoveryCode.createMany({
      data: digests.map((digest) => ({ customerId, digest })),
    });
  }
  async consumeRecovery(customerId: string, digest: string) {
    return (
      await this.db.customerRecoveryCode.deleteMany({
        where: { customerId, digest },
      })
    ).count;
  }
}
