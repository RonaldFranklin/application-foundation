import { z } from "zod";
import { EmailFailure, EmailSender } from "./email-sender";

const input = z
  .object({
    correlationId: z.uuid(),
    to: z.email().max(254),
    subject: z
      .string()
      .refine((value) => !["\r", "\n", "\0"].some((c) => value.includes(c)))
      .trim()
      .min(1)
      .max(200),
    text: z
      .string()
      .trim()
      .min(1)
      .max(10000)
      .refine((value) => !value.includes("\0")),
  })
  .strict();

export class DeliverEmail {
  constructor(private sender: EmailSender) {}
  async execute(body: unknown): Promise<{ accepted: true }> {
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new EmailFailure(false, "EMAIL_INPUT_INVALID");
    try {
      const result = await this.sender.send(parsed.data);
      if (result?.accepted !== true)
        throw new EmailFailure(true, "EMAIL_DELIVERY_UNAVAILABLE");
      return { accepted: true };
    } catch (error) {
      if (error instanceof EmailFailure) throw error;
      // Never let provider details become BullMQ failedReason/stacktrace.
      throw new EmailFailure(true, "EMAIL_DELIVERY_UNAVAILABLE");
    }
  }
}
