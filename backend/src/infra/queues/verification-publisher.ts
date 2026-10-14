import { Queue } from "bullmq";
import {
  VerificationJob,
  VerificationPublisher,
} from "../../application/email-verification/ports";
export const VERIFICATION_JOB = "email.verification.v1";
export const verificationJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: true,
  removeOnFail: true,
};
export class EmailVerificationPublisher implements VerificationPublisher {
  constructor(private queue?: Pick<Queue, "add">) {}
  async publish(job: VerificationJob): Promise<void> {
    if (!this.queue) throw new Error("EMAIL_VERIFICATION_UNAVAILABLE");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.queue.add(VERIFICATION_JOB, job, {
          ...verificationJobOptions,
          jobId: job.challengeId,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error()), 2000);
        }),
      ]);
    } catch {
      throw new Error("EMAIL_VERIFICATION_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  }
}
