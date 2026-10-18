import { CustomerAccess } from "../../application/customers/customer-access";
import { CustomerTransaction } from "../../application/customers/ports";
import { DeliverCustomerEmail } from "../../application/customers/deliver-customer-email";
import {
  CustomerController,
  OrganizationCustomersController,
} from "../../presentation/http/controllers/customers.controller";
import { Rates } from "../../application/auth/use-cases/rate-limits";
import { secureTokens, totpAdapter } from "../security/crypto";
import { PlatformRoles } from "../../application/platform-admin/platform-roles";
import { PlatformAdmins } from "../../application/platform-admin/platform-admins";
import { PlatformTransaction } from "../../application/platform-admin/ports";
import { DeliverPlatformInvitation } from "../../application/platform-admin/deliver-platform-invitation";
import {
  PlatformAdminsController,
  PlatformActivationController,
} from "../../presentation/http/controllers/platform-admins.controller";
import { Invitations } from "../../application/organization-invitations/invitations";
import { InvitationsTransaction } from "../../application/organization-invitations/ports";
import { DeliverInvitation } from "../../application/organization-invitations/deliver-invitation";
import { ProtectedInvitationSecrets } from "../security/invitation-secrets";
import { PasswordWork } from "../security/password-work";
import { OrganizationAccess } from "../../application/organizations/use-cases/organization-access";
import {
  InvitationsController,
  InvitationAcceptanceController,
} from "../../presentation/http/controllers/invitations.controller";
import { EmailInvitationPublisher } from "./invitation-publisher";
import { Config } from "../config/config";
import { AUTH_WORK } from "../../auth/auth.tokens";
import { Vault } from "../security/crypto";
import { ProtectedVerificationSecrets } from "../security/verification-secrets";
import { VerificationTransaction } from "../../application/email-verification/ports";
import { UnitOfWork } from "../../application/auth/ports/repositories";
import { Sessions } from "../../application/auth/use-cases/sessions";
import { VerifyEmail } from "../../application/email-verification/verify-email";
import { DeliverVerification } from "../../application/email-verification/deliver-verification";
import { EmailVerificationController } from "../../presentation/http/controllers/email-verification.controller";
import { EmailVerificationPublisher } from "./verification-publisher";
import { DynamicModule, Injectable, Module } from "@nestjs/common";
import { BullModule, InjectQueue, getQueueToken } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { QueueConfig } from "./queue-config";

import { SmtpConfig } from "../email/smtp-config";
import { SmtpSender } from "../email/smtp-sender";
import { DeliverEmail } from "../../application/email/deliver-email";
import { EmailProcessor } from "./email-processor";
import { EmailWorker } from "./email-worker";

export const EMAIL_QUEUE = "email";

@Injectable()
class QueueErrors {
  constructor(@InjectQueue(EMAIL_QUEUE) queue: Queue) {
    let reported = false;
    // Never log the Redis error: it can carry connection credentials or future job data.
    queue.on("error", () => {
      if (!reported) {
        reported = true;
        console.warn(JSON.stringify({ event: "email_queue_unavailable" }));
      }
    });
  }
}

@Module({})
export class EmailQueueModule {
  static register(
    config: QueueConfig,
    smtp: SmtpConfig = { enabled: false },
    verification?: { auth: DynamicModule; config: Config },
  ): DynamicModule {
    const verificationProviders = verification
      ? [
          {
            provide: PlatformRoles,
            inject: [AUTH_WORK, Sessions],
            useFactory: (
              work: UnitOfWork<PlatformTransaction>,
              sessions: Sessions,
            ) => new PlatformRoles(work, sessions),
          },
          {
            provide: CustomerAccess,
            inject: [
              AUTH_WORK,
              Sessions,
              Vault,
              PasswordWork,
              Rates,
              ...(config.enabled && smtp.enabled
                ? [getQueueToken(EMAIL_QUEUE)]
                : []),
            ],
            useFactory: (
              work: UnitOfWork<CustomerTransaction>,
              sessions: Sessions,
              vault: Vault,
              passwords: PasswordWork,
              rates: Rates,
              queue?: Queue,
            ) =>
              new CustomerAccess(
                work,
                sessions,
                vault,
                passwords,
                secureTokens,
                totpAdapter,
                rates,
                new ProtectedInvitationSecrets(vault, "customer-access.v1"),
                new EmailInvitationPublisher(queue, "email.customer-access.v1"),
                verification.config.SESSION_HOURS,
              ),
          },
          {
            provide: PlatformAdmins,
            inject: [
              AUTH_WORK,
              Sessions,
              Vault,
              PasswordWork,
              ...(config.enabled && smtp.enabled
                ? [getQueueToken(EMAIL_QUEUE)]
                : []),
            ],
            useFactory: (
              work: UnitOfWork<PlatformTransaction>,
              sessions: Sessions,
              vault: Vault,
              passwords: PasswordWork,
              queue?: Queue,
            ) =>
              new PlatformAdmins(
                work,
                sessions,
                vault,
                passwords,
                new ProtectedInvitationSecrets(
                  vault,
                  "platform-admin-invitation.v1",
                ),
                new EmailInvitationPublisher(
                  queue,
                  "email.platform-admin-invitation.v1",
                ),
              ),
          },
          {
            provide: ProtectedInvitationSecrets,
            inject: [Vault],
            useFactory: (vault: Vault) => new ProtectedInvitationSecrets(vault),
          },
          {
            provide: EmailInvitationPublisher,
            inject:
              config.enabled && smtp.enabled
                ? [getQueueToken(EMAIL_QUEUE)]
                : [],
            useFactory: (queue?: Queue) => new EmailInvitationPublisher(queue),
          },
          {
            provide: Invitations,
            inject: [
              AUTH_WORK,
              Sessions,
              Vault,
              PasswordWork,
              ProtectedInvitationSecrets,
              EmailInvitationPublisher,
            ],
            useFactory: (
              work: UnitOfWork<InvitationsTransaction>,
              sessions: Sessions,
              vault: Vault,
              passwords: PasswordWork,
              secrets: ProtectedInvitationSecrets,
              publisher: EmailInvitationPublisher,
            ) =>
              new Invitations(
                work,
                new OrganizationAccess(sessions, work),
                sessions,
                vault,
                passwords,
                secrets,
                publisher,
              ),
          },
          {
            provide: ProtectedVerificationSecrets,
            inject: [Vault],
            useFactory: (vault: Vault) =>
              new ProtectedVerificationSecrets(verification.config, vault),
          },
          {
            provide: EmailVerificationPublisher,
            inject:
              config.enabled && smtp.enabled
                ? [getQueueToken(EMAIL_QUEUE)]
                : [],
            useFactory: (queue?: Queue) =>
              new EmailVerificationPublisher(queue),
          },
          {
            provide: VerifyEmail,
            inject: [
              AUTH_WORK,
              Sessions,
              ProtectedVerificationSecrets,
              EmailVerificationPublisher,
            ],
            useFactory: (
              work: UnitOfWork<VerificationTransaction>,
              sessions: Sessions,
              secrets: ProtectedVerificationSecrets,
              publisher: EmailVerificationPublisher,
            ) => new VerifyEmail(work, sessions, secrets, publisher),
          },
        ]
      : [];
    if (!config.enabled)
      return {
        module: EmailQueueModule,
        imports: verification ? [verification.auth] : [],
        controllers: verification
          ? [
              CustomerController,
              OrganizationCustomersController,
              PlatformAdminsController,
              PlatformActivationController,
              EmailVerificationController,
              InvitationsController,
              InvitationAcceptanceController,
            ]
          : [],
        providers: verificationProviders,
      };
    return {
      module: EmailQueueModule,
      controllers: verification
        ? [
            CustomerController,
            OrganizationCustomersController,
            PlatformAdminsController,
            PlatformActivationController,
            EmailVerificationController,
            InvitationsController,
            InvitationAcceptanceController,
          ]
        : [],
      imports: [
        ...(verification ? [verification.auth] : []),
        BullModule.forRoot({
          connection: {
            host: config.host,
            port: config.port,
            password: config.password,
            connectTimeout: 1000,
            commandTimeout: 1000,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            retryStrategy: (attempt: number) => Math.min(attempt * 250, 5000),
          },
        }),
        BullModule.registerQueue({ name: EMAIL_QUEUE }),
      ],
      providers: [
        QueueErrors,
        ...verificationProviders,
        ...(smtp.enabled
          ? [
              { provide: SmtpSender, useFactory: () => new SmtpSender(smtp) },
              {
                provide: DeliverEmail,
                useFactory: (sender: SmtpSender) => new DeliverEmail(sender),
                inject: [SmtpSender],
              },
              ...(verification
                ? [
                    {
                      provide: DeliverCustomerEmail,
                      inject: [AUTH_WORK, Vault, SmtpSender],
                      useFactory: (
                        work: UnitOfWork<CustomerTransaction>,
                        vault: Vault,
                        sender: SmtpSender,
                      ) =>
                        new DeliverCustomerEmail(
                          work,
                          vault,
                          new ProtectedInvitationSecrets(
                            vault,
                            "customer-access.v1",
                          ),
                          sender,
                          verification.config.FRONTEND_ORIGIN,
                        ),
                    },
                    {
                      provide: DeliverPlatformInvitation,
                      inject: [AUTH_WORK, Vault, SmtpSender],
                      useFactory: (
                        work: UnitOfWork<PlatformTransaction>,
                        vault: Vault,
                        sender: SmtpSender,
                      ) =>
                        new DeliverPlatformInvitation(
                          work,
                          new ProtectedInvitationSecrets(
                            vault,
                            "platform-admin-invitation.v1",
                          ),
                          vault,
                          sender,
                          verification.config.FRONTEND_ORIGIN,
                        ),
                    },
                    {
                      provide: DeliverInvitation,
                      inject: [
                        AUTH_WORK,
                        ProtectedInvitationSecrets,
                        Vault,
                        SmtpSender,
                      ],
                      useFactory: (
                        work: UnitOfWork<InvitationsTransaction>,
                        secrets: ProtectedInvitationSecrets,
                        vault: Vault,
                        sender: SmtpSender,
                      ) =>
                        new DeliverInvitation(
                          work,
                          secrets,
                          vault,
                          sender,
                          verification.config.FRONTEND_ORIGIN,
                        ),
                    },
                    {
                      provide: DeliverVerification,
                      inject: [
                        AUTH_WORK,
                        ProtectedVerificationSecrets,
                        Vault,
                        SmtpSender,
                      ],
                      useFactory: (
                        work: UnitOfWork<VerificationTransaction>,
                        secrets: ProtectedVerificationSecrets,
                        vault: Vault,
                        sender: SmtpSender,
                      ) =>
                        new DeliverVerification(work, secrets, vault, sender),
                    },
                  ]
                : []),
              {
                provide: EmailProcessor,
                useFactory: (
                  deliver: DeliverEmail,
                  verification?: DeliverVerification,
                  invitation?: DeliverInvitation,
                  platform?: DeliverPlatformInvitation,
                  customer?: DeliverCustomerEmail,
                ) =>
                  new EmailProcessor(
                    deliver,
                    verification,
                    invitation,
                    platform,
                    customer,
                  ),
                inject: [
                  DeliverEmail,
                  ...(verification
                    ? [
                        DeliverVerification,
                        DeliverInvitation,
                        DeliverPlatformInvitation,
                        DeliverCustomerEmail,
                      ]
                    : []),
                ],
              },
              {
                provide: EmailWorker,
                useFactory: (processor: EmailProcessor) =>
                  new EmailWorker(EMAIL_QUEUE, config, processor),
                inject: [EmailProcessor],
              },
            ]
          : []),
      ],
      exports: [BullModule],
    };
  }
}
