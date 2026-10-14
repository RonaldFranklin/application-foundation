import { VerificationTransaction } from "../application/email-verification/ports";
import { EditProfile } from "../application/auth/use-cases/edit-profile";
import { DynamicModule, Module } from "@nestjs/common";
import { Config } from "../infra/config/config";
import { PrismaModule } from "../infra/database/prisma/prisma.module";
import { PrismaService } from "../infra/database/prisma/prisma.service";
import {
  PrismaUnitOfWork,
  repositories,
} from "../infra/database/prisma/prisma-unit-of-work";
import { Vault, secureTokens, totpAdapter } from "../infra/security/crypto";
import { PasswordWork } from "../infra/security/password-work";
import { Turnstile } from "../infra/integrations/turnstile";
import { ConsoleSecurityEvents } from "../infra/security/security-events";
import { AuthCleanup } from "../infra/scheduling/auth-cleanup";
import { AuthController } from "../presentation/http/controllers/auth.controller";
import { AuthPresenter } from "../presentation/http/presenters/auth.presenter";
import {
  AuthRepositories,
  UnitOfWork,
} from "../application/auth/ports/repositories";
import {
  IdentityProtection,
  Tokens,
  Passwords,
  Totp,
  Captcha,
  SecurityEvents,
} from "../application/auth/ports/security";
import {
  AUTH_CONFIG,
  AUTH_REPOSITORIES,
  AUTH_WORK,
  AUTH_TOKENS,
  AUTH_TOTP,
} from "./auth.tokens";
import { Rates } from "../application/auth/use-cases/rate-limits";
import { Sessions } from "../application/auth/use-cases/sessions";
import { MasterAdmission } from "../application/auth/use-cases/master-admission";
import { Login } from "../application/auth/use-cases/login";
import { ChangeInitialPassword } from "../application/auth/use-cases/change-initial-password";
import { Mfa } from "../application/auth/use-cases/mfa";
import { BootstrapMaster } from "../application/auth/use-cases/bootstrap-master";
import { Cleanup } from "../application/auth/use-cases/cleanup";
@Module({})
export class AuthModule {
  static register(c: Config): DynamicModule {
    return {
      module: AuthModule,
      imports: [PrismaModule.register(c.DATABASE_URL)],
      controllers: [AuthController],
      providers: [
        { provide: AUTH_CONFIG, useValue: c },
        {
          provide: AUTH_REPOSITORIES,
          inject: [PrismaService],
          useFactory: repositories,
        },
        {
          provide: AUTH_WORK,
          inject: [PrismaService],
          useFactory: (db: PrismaService) => new PrismaUnitOfWork(db),
        },
        {
          provide: Vault,
          inject: [AUTH_CONFIG],
          useFactory: (c: Config) => new Vault(c),
        },
        {
          provide: PasswordWork,
          inject: [AUTH_CONFIG],
          useFactory: (c: Config) => new PasswordWork(c),
        },
        {
          provide: Turnstile,
          inject: [AUTH_CONFIG],
          useFactory: (c: Config) => new Turnstile(c),
        },
        {
          provide: ConsoleSecurityEvents,
          useFactory: () => new ConsoleSecurityEvents(),
        },
        { provide: AUTH_TOKENS, useValue: secureTokens },
        { provide: AUTH_TOTP, useValue: totpAdapter },
        {
          provide: AuthPresenter,
          inject: [AUTH_CONFIG],
          useFactory: (c: Config) => new AuthPresenter(c),
        },
        {
          provide: AuthCleanup,
          inject: [Cleanup],
          useFactory: (cleanup: Cleanup) => new AuthCleanup(cleanup),
        },
        {
          provide: Rates,
          inject: [AUTH_REPOSITORIES, AUTH_WORK, AUTH_CONFIG, Vault],
          useFactory: (
            repos: AuthRepositories,
            work: UnitOfWork,
            c: Config,
            vault: IdentityProtection,
          ) => new Rates(repos.rates, work, c, vault),
        },
        {
          provide: Sessions,
          inject: [
            AUTH_REPOSITORIES,
            AUTH_WORK,
            AUTH_CONFIG,
            Vault,
            AUTH_TOKENS,
          ],
          useFactory: (
            repos: AuthRepositories,
            work: UnitOfWork,
            c: Config,
            vault: IdentityProtection,
            tokens: Tokens,
          ) => new Sessions(repos.sessions, work, c, vault, tokens),
        },
        {
          provide: MasterAdmission,
          inject: [AUTH_WORK, AUTH_CONFIG, Rates, AUTH_TOKENS],
          useFactory: (
            work: UnitOfWork,
            c: Config,
            rates: Rates,
            tokens: Tokens,
          ) => new MasterAdmission(work, c, rates, tokens),
        },
        {
          provide: Login,
          inject: [
            AUTH_REPOSITORIES,
            AUTH_WORK,
            Vault,
            Rates,
            Sessions,
            PasswordWork,
            MasterAdmission,
            Turnstile,
            ConsoleSecurityEvents,
          ],
          useFactory: (
            repos: AuthRepositories,
            work: UnitOfWork,
            vault: IdentityProtection,
            rates: Rates,
            sessions: Sessions,
            passwords: Passwords,
            masteradmission: MasterAdmission,
            captcha: Captcha,
            events: SecurityEvents,
          ) =>
            new Login(
              repos.identities,
              work,
              vault,
              rates,
              sessions,
              passwords,
              masteradmission,
              captcha,
              events,
            ),
        },
        {
          provide: ChangeInitialPassword,
          inject: [AUTH_WORK, Sessions, PasswordWork, AUTH_TOKENS],
          useFactory: (
            work: UnitOfWork,
            sessions: Sessions,
            passwords: Passwords,
            tokens: Tokens,
          ) => new ChangeInitialPassword(work, sessions, passwords, tokens),
        },
        {
          provide: EditProfile,
          inject: [
            AUTH_WORK,
            Sessions,
            PasswordWork,
            Vault,
            AUTH_TOKENS,
            AUTH_TOTP,
            Rates,
          ],
          useFactory: (
            work: UnitOfWork<VerificationTransaction>,
            sessions: Sessions,
            passwords: Passwords,
            vault: IdentityProtection,
            tokens: Tokens,
            totp: Totp,
            rates: Rates,
          ) =>
            new EditProfile(
              work,
              sessions,
              passwords,
              vault,
              tokens,
              totp,
              rates,
            ),
        },
        {
          provide: Mfa,
          inject: [Vault, Rates, Sessions, AUTH_TOKENS, AUTH_TOTP],
          useFactory: (
            vault: IdentityProtection,
            rates: Rates,
            sessions: Sessions,
            tokens: Tokens,
            totp: Totp,
          ) => new Mfa(vault, rates, sessions, tokens, totp),
        },
        {
          provide: BootstrapMaster,
          inject: [AUTH_WORK, AUTH_CONFIG, Vault, PasswordWork],
          useFactory: (
            work: UnitOfWork,
            c: Config,
            vault: IdentityProtection,
            passwords: Passwords,
          ) => new BootstrapMaster(work, c, vault, passwords),
        },
        {
          provide: Cleanup,
          inject: [AUTH_REPOSITORIES],
          useFactory: (repos: AuthRepositories) => new Cleanup(repos),
        },
      ],
      exports: [
        AUTH_WORK,
        Vault,
        PasswordWork,
        Rates,
        BootstrapMaster,
        AuthCleanup,
        Sessions,
        AuthPresenter,
        PrismaModule,
      ],
    };
  }
}
