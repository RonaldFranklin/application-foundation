import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { VerifyEmail } from "../src/application/email-verification/verify-email";
import { DeliverVerification } from "../src/application/email-verification/deliver-verification";
import {
  VerificationJob,
  VerificationTransaction,
  verificationContext,
} from "../src/application/email-verification/ports";
import { UnitOfWork } from "../src/application/auth/ports/repositories";
import { AUTH_WORK } from "../src/auth/auth.tokens";
import { ProtectedVerificationSecrets } from "../src/infra/security/verification-secrets";
import {
  EmailVerificationPublisher,
  VERIFICATION_JOB,
  verificationJobOptions,
} from "../src/infra/queues/verification-publisher";
import { EmailProcessor } from "../src/infra/queues/email-processor";
import { DeliverEmail } from "../src/application/email/deliver-email";
import {
  EmailFailure,
  EmailMessage,
} from "../src/application/email/email-sender";
import { secureTokens, hashPassword } from "../src/infra/security/crypto";
import { EditProfile } from "../src/application/auth/use-cases/edit-profile";
test("email verification with isolated PostgreSQL and reapplied additive migration", async (t) => {
  const f = await fixture(15448);
  t.after(() => f.close());
  const work = f.app.get<UnitOfWork<VerificationTransaction>>(AUTH_WORK),
    secrets = f.app.get(ProtectedVerificationSecrets),
    publisher = f.app.get(EmailVerificationPublisher);
  let now = Date.now(),
    queueFails = false;
  const jobs: VerificationJob[] = [],
    messages: EmailMessage[] = [];
  t.mock.method(publisher, "publish", async (job: VerificationJob) => {
    if (queueFails) throw new Error("private provider detail");
    jobs.push(job);
  });
  const service = () =>
    new VerifyEmail(work, f.auth.sessions, secrets, publisher, () => now);
  const sender = {
    async send(m: EmailMessage) {
      messages.push(m);
      return { accepted: true as const };
    },
  };
  const delivery = () =>
    new DeliverVerification(work, secrets, f.auth.vault, sender, () => now);
  const password = "synthetic verification password only",
    hash = await hashPassword(password);
  async function account() {
    const name = secureTokens.generate(),
      raw = secureTokens.generate(),
      v = f.auth.vault;
    const user = await f.db.user.create({
      data: {
        username: v.encrypt(name, "username"),
        usernameIndex: v.index(name),
        email: v.encrypt(name + "@example.invalid", "email"),
        emailIndex: v.index(name + "@example.invalid"),
        passwordHash: hash,
      },
    });
    await f.db.session.create({
      data: {
        digest: secureTokens.digest(raw),
        userId: user.id,
        stage: "full",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    return { user, raw };
  }
  async function code(job: VerificationJob) {
    const c = await f.db.emailVerification.findUniqueOrThrow({
      where: { id: job.challengeId },
    });
    return secrets.decrypt(job.encryptedCode, verificationContext(c));
  }
  function http(
    raw: string | undefined,
    action: string,
    body: object,
    origin = f.c.FRONTEND_ORIGIN,
  ) {
    return request(f.app.getHttpServer())
      .post("/v1/auth/email-verification/" + action)
      .set("Origin", origin)
      .set("Cookie", raw ? "login_session=" + raw : "")
      .send(body);
  }
  await t.test(
    "full session, CSRF, strict bodies, encrypted job, one-use code and optional status",
    async () => {
      const { user, raw } = await account();
      assert.equal(user.emailVerifiedAt, null);
      assert.equal(
        (await f.auth.sessions.welcome(raw, false))?.emailVerifiedAt,
        null,
      );
      await http(undefined, "request", {}).expect(401);
      await http(raw, "request", {
        userId: user.id,
        email: "other@example.invalid",
      }).expect(400);
      await http(raw, "request", {}, "http://other.invalid").expect(403);
      for (const stage of ["password", "setup", "mfa", "recovery"]) {
        await f.db.session.update({
          where: { digest: secureTokens.digest(raw) },
          data: { stage },
        });
        await http(raw, "request", {}).expect(401);
      }
      await f.db.session.update({
        where: { digest: secureTokens.digest(raw) },
        data: { stage: "full" },
      });
      const response = await http(raw, "request", {}).expect(200),
        job = jobs.at(-1)!,
        plaintext = await code(job);
      assert.deepEqual(Object.keys(job).sort(), [
        "challengeId",
        "encryptedCode",
      ]);
      assert.equal(JSON.stringify(job).includes("@"), false);
      assert.equal(JSON.stringify(job).includes(plaintext), false);
      assert.equal(JSON.stringify(response.body).includes(plaintext), false);
      const c = await f.db.emailVerification.findUniqueOrThrow({
        where: { userId: user.id },
      });
      assert.equal(
        secrets.matches(plaintext, verificationContext(c), c.digest!),
        true,
      );
      assert.equal(secrets.matches(plaintext, "other", c.digest!), false);
      assert.throws(() => secrets.decrypt(job.encryptedCode, "other"));
      await http(raw, "confirm", { code: plaintext, userId: user.id }).expect(
        400,
      );
      const results = await Promise.all([
        http(raw, "confirm", { code: plaintext }),
        http(raw, "confirm", { code: plaintext }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
      assert.ok((await f.auth.sessions.welcome(raw, false))?.emailVerifiedAt);
      await http(raw, "confirm", { code: plaintext }).expect(400);
      assert.equal(
        (await http(raw, "request", {}).expect(400)).body.code,
        "ALREADY_VERIFIED",
      );
    },
  );
  await t.test(
    "shared cooldown and rolling budget across concurrent service instances",
    async () => {
      const { user, raw } = await account();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => service().request(raw, {})),
      );
      assert.equal(results.filter((r) => "expiresAt" in r).length, 1);
      assert.equal(
        results.filter((r) => "error" in r && r.error === "COOLDOWN").length,
        7,
      );
      for (let i = 0; i < 4; i++) {
        now += 60000;
        assert.ok("expiresAt" in (await service().request(raw, {})));
      }
      now += 60000;
      assert.equal(
        ((await service().request(raw, {})) as { error: string }).error,
        "SEND_LIMIT",
      );
      assert.equal(
        (
          await f.db.emailVerification.findUniqueOrThrow({
            where: { userId: user.id },
          })
        ).requests.length,
        5,
      );
      now += 3600000;
      assert.ok("expiresAt" in (await service().request(raw, {})));
    },
  );
  await t.test(
    "replaced and expired codes, five atomic attempts, obsolete jobs ignored",
    async () => {
      const { user, raw } = await account();
      await service().request(raw, {});
      const old = jobs.at(-1)!,
        oldCode = await code(old);
      now += 60000;
      await service().request(raw, {});
      const currentCode = await code(jobs.at(-1)!);
      assert.deepEqual(await delivery().execute(old), { ignored: true });
      if (oldCode !== currentCode)
        assert.deepEqual(await service().confirm(raw, { code: oldCode }), {
          error: "CODE_INVALID",
        });
      const wrong = currentCode === "999999" ? "888888" : "999999";
      await Promise.all(
        Array.from({ length: 8 }, () =>
          service().confirm(raw, { code: wrong }),
        ),
      );
      assert.equal(
        (
          await f.db.emailVerification.findUniqueOrThrow({
            where: { userId: user.id },
          })
        ).attempts,
        5,
      );
      assert.deepEqual(await service().confirm(raw, { code: currentCode }), {
        error: "ATTEMPT_LIMIT",
      });
      now += 60000;
      await service().request(raw, {});
      const expired = jobs.at(-1)!,
        expiredCode = await code(expired);
      now += 600000;
      assert.deepEqual(await service().confirm(raw, { code: expiredCode }), {
        error: "CODE_EXPIRED",
      });
      assert.deepEqual(await delivery().execute(expired), { ignored: true });
    },
  );
  await t.test(
    "publication failure invalidates challenge and keeps cooldown",
    async () => {
      const { user, raw } = await account();
      queueFails = true;
      assert.deepEqual(await service().request(raw, {}), {
        error: "UNAVAILABLE",
      });
      queueFails = false;
      const c = await f.db.emailVerification.findUniqueOrThrow({
        where: { userId: user.id },
      });
      assert.equal(c.digest, null);
      assert.ok(c.consumedAt);
      assert.equal(c.requests.length, 1);
      assert.deepEqual(
        await delivery().execute({ challengeId: c.id, encryptedCode: "late" }),
        { ignored: true },
      );
      assert.equal(
        ((await service().request(raw, {})) as { error: string }).error,
        "COOLDOWN",
      );
    },
  );
  await t.test(
    "worker current destination, duplicate suppression, sanitized errors and bounded retries",
    async () => {
      const { user, raw } = await account();
      await service().request(raw, {});
      const job = jobs.at(-1)!,
        plaintext = await code(job),
        before = messages.length;
      assert.deepEqual(await delivery().execute(job), { accepted: true });
      assert.equal(messages.length, before + 1);
      assert.equal(
        messages.at(-1)!.to,
        f.auth.vault.decrypt(user.email, "email"),
      );
      assert.ok(messages.at(-1)!.text.includes(plaintext));
      assert.deepEqual(await delivery().execute(job), { ignored: true });
      now += 60000;
      await service().request(raw, {});
      const next = jobs.at(-1)!;
      const transient = new DeliverVerification(
        work,
        secrets,
        f.auth.vault,
        {
          send: async () => {
            throw new Error("private provider detail");
          },
        },
        () => now,
      );
      const processor = new EmailProcessor(new DeliverEmail(sender), transient);
      await assert.rejects(
        processor.process({ name: VERIFICATION_JOB, data: next }),
        { message: "EMAIL_DELIVERY_UNAVAILABLE" },
      );
      await assert.rejects(
        processor.process({
          name: VERIFICATION_JOB,
          data: { ...next, encryptedCode: "tampered" },
        }),
        { name: "UnrecoverableError", message: "EMAIL_INPUT_INVALID" },
      );
      const permanent = new DeliverVerification(
        work,
        secrets,
        f.auth.vault,
        {
          send: async () => {
            throw new EmailFailure(false, "EMAIL_REJECTED");
          },
        },
        () => now,
      );
      await assert.rejects(
        new EmailProcessor(new DeliverEmail(sender), permanent).process({
          name: VERIFICATION_JOB,
          data: next,
        }),
        { name: "UnrecoverableError" },
      );
      assert.deepEqual(verificationJobOptions, {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      });
      await assert.rejects(new EmailVerificationPublisher().publish(next), {
        message: "EMAIL_VERIFICATION_UNAVAILABLE",
      });
      assert.equal(
        (
          await f.db.emailVerification.findUniqueOrThrow({
            where: { userId: user.id },
          })
        ).deliveredAt,
        null,
      );
    },
  );
  await t.test(
    "profile change clears verified status and pending codes without resetting send limits",
    async () => {
      const { user, raw } = await account();
      await service().request(raw, {});
      const job = jobs.at(-1)!,
        plaintext = await code(job);
      await service().confirm(raw, { code: plaintext });
      const edit = f.app.get(EditProfile);
      assert.deepEqual(
        await edit.execute(
          raw,
          {
            username: "changed-" + user.id,
            email: user.id + "@new.invalid",
            currentPassword: password,
          },
          false,
        ),
        { passwordChanged: false },
      );
      assert.equal(
        (await f.db.user.findUniqueOrThrow({ where: { id: user.id } }))
          .emailVerifiedAt,
        null,
      );
      assert.deepEqual(await service().confirm(raw, { code: plaintext }), {
        error: "CODE_INVALID",
      });
      assert.deepEqual(await delivery().execute(job), { ignored: true });
      assert.equal(
        (
          await f.db.emailVerification.findUniqueOrThrow({
            where: { userId: user.id },
          })
        ).requests.length,
        1,
      );
      assert.ok(await f.auth.sessions.welcome(raw, false));
      now += 60000;
      await service().request(raw, {});
      const pending = jobs.at(-1)!,
        pendingCode = await code(pending);
      await edit.execute(
        raw,
        {
          username: "changed-" + user.id,
          email: user.id + "@next.invalid",
          currentPassword: password,
        },
        false,
      );
      assert.deepEqual(await service().confirm(raw, { code: pendingCode }), {
        error: "CODE_INVALID",
      });
      assert.deepEqual(await delivery().execute(pending), { ignored: true });
    },
  );
});

test("dedicated publisher options and sanitized queue errors", async () => {
  let captured: unknown;
  const job = { challengeId: "opaque-id", encryptedCode: "versioned-envelope" };
  const fake = {
    async add(name: string, data: unknown, options: unknown) {
      captured = { name, data, options };
      return {} as never;
    },
  };
  await new EmailVerificationPublisher(fake).publish(job);
  assert.deepEqual(captured, {
    name: VERIFICATION_JOB,
    data: job,
    options: { ...verificationJobOptions, jobId: job.challengeId },
  });
  await assert.rejects(
    new EmailVerificationPublisher({
      add: async () => {
        throw new Error("raw Redis credential");
      },
    }).publish(job),
    { message: "EMAIL_VERIFICATION_UNAVAILABLE" },
  );
});
