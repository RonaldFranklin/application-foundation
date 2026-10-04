import { UnrecoverableError } from "bullmq";
import { DeliverEmail } from "../../application/email/deliver-email";
import { EmailFailure } from "../../application/email/email-sender";

export const EMAIL_JOB = "email.send";
export class EmailProcessor {
  constructor(private deliver: DeliverEmail) {}
  async process(job: {
    name: string;
    data: unknown;
  }): Promise<{ accepted: true }> {
    if (
      job.name !== EMAIL_JOB ||
      !job.data ||
      typeof job.data !== "object" ||
      Array.isArray(job.data)
    )
      throw new UnrecoverableError("EMAIL_JOB_INVALID");
    const { version, ...message } = job.data as Record<string, unknown>;
    if (version !== 1) throw new UnrecoverableError("EMAIL_JOB_INVALID");
    try {
      return await this.deliver.execute(message);
    } catch (error) {
      if (error instanceof EmailFailure && !error.retryable)
        throw new UnrecoverableError(error.message);
      // Regular Error lets BullMQ apply the job's existing attempts/backoff.
      throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
    }
  }
}
