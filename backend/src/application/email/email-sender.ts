export interface EmailMessage {
  correlationId: string;
  to: string;
  subject: string;
  text: string;
}
export interface EmailSender {
  send(message: EmailMessage): Promise<{ accepted: true }>;
}
export class EmailFailure extends Error {
  constructor(
    public readonly retryable: boolean,
    code:
      "EMAIL_INPUT_INVALID" | "EMAIL_REJECTED" | "EMAIL_DELIVERY_UNAVAILABLE",
  ) {
    super(code);
    this.name = "EmailFailure";
  }
}
