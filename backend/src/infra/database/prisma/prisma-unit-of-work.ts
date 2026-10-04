import { PrismaPermissionsRepository } from "../repositories/prisma-permissions.repository";
import { MembersTransaction } from "../../../application/organizations/ports/members.repository";
import { PrismaMembersRepository } from "../repositories/prisma-members.repository";
import {
  AuthRepositories,
  UnitOfWork,
} from "../../../application/auth/ports/repositories";
import { PrismaService } from "./prisma.service";
import { QueryClient } from "../repositories/records";
import { PrismaIdentityRepository } from "../repositories/prisma-identity.repository";
import { PrismaSessionRepository } from "../repositories/prisma-session.repository";
import { PrismaRateRepository } from "../repositories/prisma-rate.repository";

export function repositories(db: QueryClient): AuthRepositories {
  return {
    identities: new PrismaIdentityRepository(db),
    sessions: new PrismaSessionRepository(db),
    rates: new PrismaRateRepository(db),
  };
}
export class PrismaUnitOfWork implements UnitOfWork<MembersTransaction> {
  constructor(private db: PrismaService) {}
  run<T>(
    work: (tx: MembersTransaction) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    return this.db.$transaction(
      (tx) =>
        work({
          ...repositories(tx),
          members: new PrismaMembersRepository(tx),
          permissions: new PrismaPermissionsRepository(tx),
          organizations: {
            find: (id) => tx.organization.findUnique({ where: { id } }),
            update: async (id, data) =>
              (
                await tx.organization.updateManyAndReturn({
                  where: { id },
                  data,
                })
              )[0] ?? null,
          },
          async lock(key: string) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
          },
        }),
      options,
    );
  }
}
