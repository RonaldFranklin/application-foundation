import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import {
  InvitationJob,
  InvitationPublisher,
} from "../../application/organization-invitations/ports";
export const INVITATION_JOB = "email.organization-invitation.v1";
export const invitationJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: true,
  removeOnFail: true,
};
export class EmailInvitationPublisher implements InvitationPublisher {
  constructor(private queue?: Pick<Queue, "add">) {}
  async publish(job: InvitationJob) {
    if (!this.queue) throw new Error("EMAIL_INVITATION_UNAVAILABLE");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.queue.add(INVITATION_JOB, job, {
          ...invitationJobOptions,
          jobId: randomUUID(),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error()), 2000);
        }),
      ]);
    } catch {
      throw new Error("EMAIL_INVITATION_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  }
}
