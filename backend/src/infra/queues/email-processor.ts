import { DeliverCustomerEmail } from "../../application/customers/deliver-customer-email";
import { DeliverPlatformInvitation } from "../../application/platform-admin/deliver-platform-invitation";
import { DeliverInvitation } from "../../application/organization-invitations/deliver-invitation";
import { INVITATION_JOB } from "./invitation-publisher";
import { UnrecoverableError } from "bullmq";
import { DeliverEmail } from "../../application/email/deliver-email";
import { EmailFailure } from "../../application/email/email-sender";

import { DeliverVerification } from "../../application/email-verification/deliver-verification";
import { VERIFICATION_JOB } from "./verification-publisher";

export const EMAIL_JOB = "email.send";
export class EmailProcessor {
  constructor(
    private deliver: DeliverEmail,
    private verification?: DeliverVerification,
    private invitation?: DeliverInvitation,
    private platform?: DeliverPlatformInvitation,
    private customer?: DeliverCustomerEmail,
  ) {}
  async process(job: {
    name: string;
    data: unknown;
  }): Promise<{ accepted: true } | { ignored: true }> {
    if (job.name === "email.customer-access.v1" && this.customer) {
      try {
        return await this.customer.execute(job.data);
      } catch {
        throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
      }
    }
    if (job.name === "email.platform-admin-invitation.v1" && this.platform) {
      try {
        return await this.platform.execute(job.data);
      } catch (error) {
        if (error instanceof EmailFailure && !error.retryable)
          throw new UnrecoverableError("EMAIL_INPUT_INVALID");
        throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
      }
    }
    if (job.name === INVITATION_JOB && this.invitation) {
      try {
        return await this.invitation.execute(job.data);
      } catch (error) {
        if (error instanceof EmailFailure && !error.retryable)
          throw new UnrecoverableError("EMAIL_INPUT_INVALID");
        throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
      }
    }
    if (job.name === VERIFICATION_JOB && this.verification) {
      try {
        return await this.verification.execute(job.data);
      } catch (error) {
        if (error instanceof EmailFailure && !error.retryable)
          throw new UnrecoverableError(error.message);
        throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
      }
    }
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
