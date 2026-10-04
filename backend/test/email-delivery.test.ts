import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { NestFactory } from "@nestjs/core";
import { UnrecoverableError } from "bullmq";
import { DeliverEmail } from "../src/application/email/deliver-email";
import {
  EmailFailure,
  EmailMessage,
  EmailSender,
} from "../src/application/email/email-sender";
import { EMAIL_JOB, EmailProcessor } from "../src/infra/queues/email-processor";
import { EmailQueueModule } from "../src/infra/queues/email-queue.module";
import {
  EmailWorker,
  emailWorkerOptions,
} from "../src/infra/queues/email-worker";
import { readSmtpConfig } from "../src/infra/email/smtp-config";
import {
  SmtpSender,
  smtpOptions,
  smtpFailure,
} from "../src/infra/email/smtp-sender";

const message: EmailMessage = {
  correlationId: randomUUID(),
  to: "person@example.invalid",
  subject: "Technical test",
  text: "Non-sensitive test content",
};
const smtp = {
  enabled: true as const,
  host: "smtp.example.invalid",
  port: 587,
  secure: false,
  user: "test-user",
  password: "synthetic-only",
  from: "sender@example.invalid",
};
const queue = {
  enabled: true as const,
  host: "127.0.0.1",
  port: 6379,
  password: "0".repeat(64),
};

test("use case validates before delivery and accepts only confirmed sender success", async () => {
  const sent: EmailMessage[] = [];
  const deliver = new DeliverEmail({
    async send(value) {
      sent.push(value);
      return { accepted: true };
    },
  });
  assert.deepEqual(await deliver.execute(message), { accepted: true });
  assert.deepEqual(sent, [message]);
  for (const invalid of [
    null,
    {},
    { ...message, to: [message.to] },
    { ...message, to: "invalid" },
    { ...message, correlationId: "not-uuid" },
    { ...message, subject: "\r\nBcc: other@example.invalid" },
    { ...message, text: " " },
    { ...message, text: "x".repeat(10001) },
    { ...message, attachments: [] },
    { ...message, password: "secret" },
    { ...message, token: "secret" },
    { ...message, html: "<b>test</b>" },
  ]) {
    await assert.rejects(
      deliver.execute(invalid),
      (error: EmailFailure) =>
        error.message === "EMAIL_INPUT_INVALID" && !error.retryable,
    );
  }
  assert.equal(sent.length, 1);
  const unconfirmed = new DeliverEmail({
    async send() {
      return undefined;
    },
  } as unknown as EmailSender);
  await assert.rejects(
    unconfirmed.execute(message),
    /EMAIL_DELIVERY_UNAVAILABLE/,
  );
});

test("processor translates versioned job and waits for acceptance before completing", async () => {
  let confirm!: () => void;
  let seen: EmailMessage | undefined;
  const gate = new Promise<void>((resolve) => {
    confirm = resolve;
  });
  const processor = new EmailProcessor(
    new DeliverEmail({
      async send(value) {
        seen = value;
        await gate;
        return { accepted: true };
      },
    }),
  );
  let completed = false;
  const processing = processor
    .process({ name: EMAIL_JOB, data: { version: 1, ...message } })
    .then((result) => {
      completed = true;
      return result;
    });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(seen, message);
  confirm();
  assert.deepEqual(await processing, { accepted: true });
});

test("invalid envelopes and semantic payloads are unrecoverable without calling sender", async () => {
  let calls = 0;
  const processor = new EmailProcessor(
    new DeliverEmail({
      async send() {
        calls++;
        return { accepted: true };
      },
    }),
  );
  for (const job of [
    { name: "unknown", data: { version: 1, ...message } },
    { name: EMAIL_JOB, data: null },
    { name: EMAIL_JOB, data: [] },
    { name: EMAIL_JOB, data: { version: 2, ...message } },
    {
      name: EMAIL_JOB,
      data: { version: 1, ...message, smtpPassword: "secret" },
    },
  ])
    await assert.rejects(processor.process(job), UnrecoverableError);
  assert.equal(calls, 0);
});

test("sender failures reach BullMQ as sanitized permanent or retryable errors", async () => {
  for (const failure of [
    new EmailFailure(false, "EMAIL_REJECTED"),
    new EmailFailure(true, "EMAIL_DELIVERY_UNAVAILABLE"),
    new Error("recipient body SMTP secret"),
  ]) {
    const processor = new EmailProcessor(
      new DeliverEmail({
        async send() {
          throw failure;
        },
      }),
    );
    await assert.rejects(
      processor.process({ name: EMAIL_JOB, data: { version: 1, ...message } }),
      (error: Error) => {
        assert.equal(
          error instanceof UnrecoverableError,
          failure instanceof EmailFailure && !failure.retryable,
        );
        assert.match(error.message, /^EMAIL_(REJECTED|DELIVERY_UNAVAILABLE)$/);
        assert.ok(!error.stack?.includes("SMTP secret"));
        return true;
      },
    );
  }
});

test("SMTP adapter maps only allowed fields and uses a stable message ID without claiming deduplication", async () => {
  const sent: any[] = [];
  const sender = new SmtpSender(smtp, {
    async sendMail(value) {
      sent.push(value);
      return { accepted: [message.to], rejected: [] };
    },
  });
  await sender.send(message);
  await sender.send(message);
  assert.equal(sent[0].messageId, sent[1].messageId);
  assert.equal(sent[0].messageId, `<${message.correlationId}@example.invalid>`);
  assert.equal(sent[0].from, smtp.from);
  assert.deepEqual(sent[0].envelope, { from: smtp.from, to: [message.to] });
  assert.equal(sent[0].text, message.text);
  assert.equal(sent[0].disableFileAccess, true);
  assert.equal(sent[0].disableUrlAccess, true);
  assert.equal(sent[0].auth, undefined);
  assert.equal(sent[0].attachments, undefined);
  const options = smtpOptions(smtp);
  assert.equal(options.requireTLS, true);
  assert.equal(options.tls?.rejectUnauthorized, true);
  assert.equal(options.debug, false);
  assert.equal(options.logger, false);
  assert.equal(smtpOptions({ ...smtp, secure: true }).secure, true);
});

test("SMTP acceptance and provider failures distinguish permanent from transient without leaking details", async () => {
  for (const response of [
    { accepted: [], rejected: [message.to] },
    { accepted: ["other@example.invalid"], rejected: [] },
  ]) {
    const sender = new SmtpSender(smtp, {
      async sendMail() {
        return response;
      },
    });
    await assert.rejects(
      sender.send(message),
      (error: EmailFailure) =>
        !error.retryable && error.message === "EMAIL_REJECTED",
    );
  }
  for (const [source, retryable] of [
    [{ responseCode: 421 }, true],
    [{ responseCode: 454, code: "EAUTH" }, true],
    [{ responseCode: 550 }, false],
    [{ code: "EAUTH" }, false],
    [{ code: "ETLS" }, false],
    [{ code: "ECONNRESET" }, true],
  ] as const) {
    const sender = new SmtpSender(smtp, {
      async sendMail() {
        throw { ...source, message: "secret recipient body" };
      },
    });
    await assert.rejects(
      sender.send(message),
      (error: EmailFailure) =>
        error.retryable === retryable && !error.message.includes("secret"),
    );
    assert.equal(smtpFailure(source).retryable, retryable);
  }
});

test("SMTP configuration is explicit, disabled by default and sanitized on failure", () => {
  assert.deepEqual(readSmtpConfig({}, false), { enabled: false });
  const env = {
    EMAIL_DELIVERY_ENABLED: "true",
    SMTP_HOST: smtp.host,
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: smtp.user,
    SMTP_PASSWORD: smtp.password,
    EMAIL_FROM: smtp.from,
  };
  assert.deepEqual(readSmtpConfig(env, true), smtp);
  assert.throws(() => readSmtpConfig(env, false), /requer EMAIL_QUEUE_ENABLED/);
  for (const change of [
    { EMAIL_DELIVERY_ENABLED: "yes" },
    { SMTP_HOST: "" },
    { SMTP_PORT: "0" },
    { SMTP_PORT: "65536" },
    { SMTP_SECURE: "yes" },
    { SMTP_PASSWORD: "" },
    { SMTP_USER: "" },
    { EMAIL_FROM: "bad\nvalue" },
  ])
    assert.throws(
      () => readSmtpConfig({ ...env, ...change }, true),
      (error: Error) =>
        !error.message.includes(smtp.password) &&
        /Configuração/.test(error.message),
    );
});

test("disabled delivery registers no worker; worker connections preserve independent blocking settings", async () => {
  const module = EmailQueueModule.register(queue);
  assert.equal(
    module.providers?.some((provider: any) => provider.provide === EmailWorker),
    false,
  );
  const app = await NestFactory.createApplicationContext(
    EmailQueueModule.register({ enabled: false }),
    { logger: false },
  );
  try {
    assert.throws(() => app.get(EmailWorker));
  } finally {
    await app.close();
  }
  const options = emailWorkerOptions(queue);
  assert.equal((options.connection as any).maxRetriesPerRequest, null);
  assert.equal((options.connection as any).commandTimeout, undefined);
  assert.equal((options.connection as any).enableOfflineQueue, true);
  assert.equal(options.concurrency, 1);
});

test(
  "worker starts and closes without Redis, without calling sender or logging raw connection errors",
  { timeout: 5000 },
  async (t) => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const events: string[] = [];
    t.mock.method(console, "warn", (event: string) => events.push(event));
    let calls = 0;
    const module = EmailQueueModule.register({ ...queue, port }, smtp);
    module.providers = module.providers!.map((provider: any) =>
      provider.provide === SmtpSender
        ? {
            provide: SmtpSender,
            useValue: {
              async send() {
                calls++;
                return { accepted: true };
              },
            },
          }
        : provider,
    );
    const app = await NestFactory.createApplicationContext(module, {
      logger: false,
    });
    try {
      assert.ok(app.get(EmailWorker) instanceof EmailWorker);
      assert.ok(app.get(EmailProcessor) instanceof EmailProcessor);
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await app.close();
    }
    assert.equal(calls, 0);
    assert.deepEqual(events.sort(), [
      '{"event":"email_queue_unavailable"}',
      '{"event":"email_worker_unavailable"}',
    ]);
  },
);
