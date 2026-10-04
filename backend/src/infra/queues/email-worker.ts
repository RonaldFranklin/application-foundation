import { OnModuleInit, OnApplicationShutdown } from "@nestjs/common";
import { Worker, WorkerOptions } from "bullmq";
import { QueueConfig } from "./queue-config";
import { EmailProcessor } from "./email-processor";

export function emailWorkerOptions(
  config: Extract<QueueConfig, { enabled: true }>,
): WorkerOptions {
  return {
    concurrency: 1,
    connection: {
      host: config.host,
      port: config.port,
      password: config.password,
      connectTimeout: 1000,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      retryStrategy: (attempt: number) => Math.min(attempt * 250, 5000),
    },
  };
}
export class EmailWorker implements OnModuleInit, OnApplicationShutdown {
  private worker?: Worker;
  private ready = false;
  constructor(
    private queueName: string,
    private config: Extract<QueueConfig, { enabled: true }>,
    private processor: EmailProcessor,
  ) {}
  onModuleInit() {
    this.worker = new Worker(
      this.queueName,
      (job) => this.processor.process(job),
      emailWorkerOptions(this.config),
    );
    this.worker.on("ready", () => {
      this.ready = true;
    });
    let reported = false;
    this.worker.on("error", () => {
      if (!reported) {
        reported = true;
        console.warn(JSON.stringify({ event: "email_worker_unavailable" }));
      }
    });
  }
  async onApplicationShutdown() {
    // A worker awaiting its first Redis connection cannot drain a running loop.
    // No jobs can be active before ready; force-close only in that state.
    await this.worker?.close(!this.ready);
  }
}
