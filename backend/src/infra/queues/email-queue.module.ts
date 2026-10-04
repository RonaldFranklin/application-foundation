import { DynamicModule, Injectable, Module } from "@nestjs/common";
import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { QueueConfig } from "./queue-config";

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
  static register(config: QueueConfig): DynamicModule {
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
      providers: [QueueErrors],
      exports: [BullModule],
    };
  }
}
