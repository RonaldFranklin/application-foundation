import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { SendMailOptions } from "nodemailer";
import {
  EmailFailure,
  EmailMessage,
  EmailSender,
} from "../../application/email/email-sender";
import { SmtpConfig } from "./smtp-config";

export interface SmtpTransport {
  sendMail(
    message: SendMailOptions,
  ): Promise<{
    accepted: Array<string | { address: string }>;
    rejected: Array<string | { address: string }>;
  }>;
}
export function smtpOptions(
  config: Extract<SmtpConfig, { enabled: true }>,
): SMTPTransport.Options {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.password },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    dnsTimeout: 10000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}
export function smtpFailure(error: unknown): EmailFailure {
  const details =
    error && typeof error === "object"
      ? (error as { responseCode?: unknown; code?: unknown })
      : {};
  const status =
    typeof details.responseCode === "number" ? details.responseCode : 0;
  // SMTP 4xx is transient even if the adapter reports EAUTH/EENVELOPE.
  const transient = status >= 400 && status < 500;
  const permanent =
    (status >= 500 && status < 600) ||
    [
      "EAUTH",
      "EENVELOPE",
      "EMESSAGE",
      "ETLS",
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ].includes(String(details.code));
  return new EmailFailure(
    transient || !permanent,
    transient || !permanent ? "EMAIL_DELIVERY_UNAVAILABLE" : "EMAIL_REJECTED",
  );
}
export class SmtpSender implements EmailSender {
  private transport: SmtpTransport;
  constructor(
    private config: Extract<SmtpConfig, { enabled: true }>,
    transport?: SmtpTransport,
  ) {
    this.transport =
      transport ?? nodemailer.createTransport(smtpOptions(config));
  }
  async send(message: EmailMessage): Promise<{ accepted: true }> {
    try {
      const result = await this.transport.sendMail({
        from: this.config.from,
        to: message.to,
        envelope: { from: this.config.from, to: [message.to] },
        subject: message.subject,
        text: message.text,
        messageId: `<${message.correlationId}@${this.config.from.split("@")[1]}>`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const address = (value: string | { address: string }) =>
        typeof value === "string" ? value : value.address;
      if (
        !result.accepted.some(
          (value) => address(value).toLowerCase() === message.to.toLowerCase(),
        ) ||
        result.rejected.length
      )
        throw new EmailFailure(false, "EMAIL_REJECTED");
      return { accepted: true };
    } catch (error) {
      if (error instanceof EmailFailure) throw error;
      throw smtpFailure(error);
    }
  }
}
