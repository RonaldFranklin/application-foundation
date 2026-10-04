import { OrganizationAccess } from "../application/organizations/use-cases/organization-access";
import { Permissions } from "../application/organizations/use-cases/permissions";
import { PermissionsController } from "../presentation/http/controllers/permissions.controller";
import { PermissionsPresenter } from "../presentation/http/presenters/permissions.presenter";
import { AUTH_WORK } from "../auth/auth.tokens";
import { UnitOfWork } from "../application/auth/ports/repositories";
import { MembersTransaction } from "../application/organizations/ports/members.repository";
import { Members } from "../application/organizations/use-cases/members";
import { MembersController } from "../presentation/http/controllers/members.controller";
import { MembersPresenter } from "../presentation/http/presenters/members.presenter";
import { Vault } from "../infra/security/crypto";
import { PasswordWork } from "../infra/security/password-work";
import { DynamicModule, Module } from "@nestjs/common";
import { PrismaService } from "../infra/database/prisma/prisma.service";
import { PrismaOrganizationsRepository } from "../infra/database/repositories/prisma-organizations.repository";
import { Sessions } from "../application/auth/use-cases/sessions";
import { Organizations } from "../application/organizations/use-cases/organizations";
import { OrganizationsController } from "../presentation/http/controllers/organizations.controller";
import { OrganizationsPresenter } from "../presentation/http/presenters/organizations.presenter";
@Module({})
export class OrganizationsModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: OrganizationsModule,
      imports: [auth],
      controllers: [
        OrganizationsController,
        MembersController,
        PermissionsController,
      ],
      providers: [
        OrganizationsPresenter,
        MembersPresenter,
        PermissionsPresenter,
        {
          provide: OrganizationAccess,
          inject: [Sessions, AUTH_WORK],
          useFactory: (
            sessions: Sessions,
            work: UnitOfWork<MembersTransaction>,
          ) => new OrganizationAccess(sessions, work),
        },
        {
          provide: Permissions,
          inject: [OrganizationAccess],
          useFactory: (access: OrganizationAccess) => new Permissions(access),
        },
        {
          provide: Members,
          inject: [OrganizationAccess, Vault, PasswordWork],
          useFactory: (
            access: OrganizationAccess,
            vault: Vault,
            passwords: PasswordWork,
          ) => new Members(access, vault, passwords),
        },
        {
          provide: Organizations,
          inject: [Sessions, PrismaService, OrganizationAccess],
          useFactory: (
            sessions: Sessions,
            db: PrismaService,
            access: OrganizationAccess,
          ) =>
            new Organizations(
              sessions,
              new PrismaOrganizationsRepository(db),
              access,
            ),
        },
      ],
    };
  }
}
