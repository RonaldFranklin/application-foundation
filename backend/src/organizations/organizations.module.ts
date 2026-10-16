import { OrganizationContextPresenter } from "../presentation/http/presenters/organization-context.presenter";
import { OrganizationContext } from "../application/organizations/use-cases/organization-context";
import { OrganizationContextController } from "../presentation/http/controllers/organization-context.controller";
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
        OrganizationContextController,
        OrganizationsController,
        MembersController,
        PermissionsController,
      ],
      providers: [
        OrganizationContextPresenter,
        OrganizationsPresenter,
        MembersPresenter,
        PermissionsPresenter,
        {
          provide: OrganizationAccess,
          inject: [Sessions, AUTH_WORK, OrganizationContext],
          useFactory: (
            sessions: Sessions,
            work: UnitOfWork<MembersTransaction>,
            context: OrganizationContext,
          ) => new OrganizationAccess(sessions, work, context),
        },
        {
          provide: Permissions,
          inject: [OrganizationAccess],
          useFactory: (access: OrganizationAccess) => new Permissions(access),
        },
        {
          provide: Members,
          inject: [OrganizationAccess, Vault],
          useFactory: (access: OrganizationAccess, vault: Vault) =>
            new Members(access, vault),
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
