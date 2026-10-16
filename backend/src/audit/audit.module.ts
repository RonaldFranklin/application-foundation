import { OrganizationContext } from "../application/organizations/use-cases/organization-context";
import { OrganizationAuditController } from "../presentation/http/controllers/organization-audit.controller";
import { DynamicModule, Module } from "@nestjs/common";
import { QueryAudit } from "../application/audit/query-audit";
import { Sessions } from "../application/auth/use-cases/sessions";
import { PrismaService } from "../infra/database/prisma/prisma.service";
import { PrismaAuditQueryRepository } from "../infra/database/repositories/prisma-audit-query.repository";
import { PrismaIdentityRepository } from "../infra/database/repositories/prisma-identity.repository";
import { PrismaOrganizationsRepository } from "../infra/database/repositories/prisma-organizations.repository";
import { Vault } from "../infra/security/crypto";
import { AuditController } from "../presentation/http/controllers/audit.controller";
import { AuditPresenter } from "../presentation/http/presenters/audit.presenter";
@Module({})
export class AuditModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: AuditModule,
      imports: [auth],
      controllers: [AuditController, OrganizationAuditController],
      providers: [
        AuditPresenter,
        {
          provide: QueryAudit,
          inject: [Sessions, PrismaService, Vault, OrganizationContext],
          useFactory: (
            sessions: Sessions,
            db: PrismaService,
            vault: Vault,
            context: OrganizationContext,
          ) =>
            new QueryAudit(
              sessions,
              new PrismaAuditQueryRepository(db),
              new PrismaIdentityRepository(db),
              new PrismaOrganizationsRepository(db),
              vault,
              context,
            ),
        },
      ],
    };
  }
}
