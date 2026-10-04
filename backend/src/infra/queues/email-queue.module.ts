import { DynamicModule, Injectable, Module } from "@nestjs/common";
import { BullModule, InjectQueue } from "@nestjs/bullmq";
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
  ): DynamicModule {
    if (!config.enabled) return { module: EmailQueueModule };
    return {
      module: EmailQueueModule,
      imports: [
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
        ...(smtp.enabled
          ? [
              { provide: SmtpSender, useFactory: () => new SmtpSender(smtp) },
              {
                provide: DeliverEmail,
                useFactory: (sender: SmtpSender) => new DeliverEmail(sender),
                inject: [SmtpSender],
              },
              {
                provide: EmailProcessor,
                useFactory: (deliver: DeliverEmail) =>
                  new EmailProcessor(deliver),
                inject: [DeliverEmail],
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
