import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { NestFactory } from "@nestjs/core";
import { getQueueToken } from "@nestjs/bullmq";
import request from "supertest";
import { readQueueConfig } from "../src/infra/queues/queue-config";
import {
  EMAIL_QUEUE,
  EmailQueueModule,
} from "../src/infra/queues/email-queue.module";
import { createApp } from "../src/app";
import { fixture } from "./helpers";

test("queue config is opt-in, typed and errors never expose credentials", () => {
  assert.deepEqual(readQueueConfig({}), { enabled: false });
  assert.deepEqual(
    readQueueConfig({ EMAIL_QUEUE_ENABLED: "false", REDIS_PORT: "invalid" }),
    { enabled: false },
  );
  const password = randomBytes(32).toString("hex");
  const env = {
    EMAIL_QUEUE_ENABLED: "true",
    REDIS_HOST: "redis",
    REDIS_PASSWORD: password,
  };
  assert.deepEqual(readQueueConfig(env), {
    enabled: true,
    host: "redis",
    port: 6379,
    password,
  });
  for (const change of [
    { EMAIL_QUEUE_ENABLED: "yes" },
    { REDIS_HOST: "" },
    { REDIS_HOST: "redis/invalid" },
    { REDIS_PORT: "0" },
    { REDIS_PORT: "65536" },
    { REDIS_PORT: "1.5" },
    { REDIS_PASSWORD: "" },
    { REDIS_PASSWORD: "secret-with-newline\n" },
  ]) {
    assert.throws(
      () => readQueueConfig({ ...env, ...change }),
      (error: Error) => {
        assert.ok(!error.message.includes(password));
        assert.ok(!error.message.includes("secret-with-newline"));
        return /Configuração/.test(error.message);
      },
    );
  }
});

test("disabled queue module creates no queue provider or Redis connection", async () => {
  const app = await NestFactory.createApplicationContext(
    EmailQueueModule.register({ enabled: false }),
    { logger: false },
  );
  try {
    assert.throws(() => app.get(getQueueToken(EMAIL_QUEUE)));
  } finally {
    await app.close();
  }
});

test(
  "unavailable Redis does not block API startup, login or shutdown",
  { timeout: 30000 },
  async (t) => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const f = await fixture(15447);
    const events: string[] = [];
    t.mock.method(console, "warn", (event: string) => events.push(event));
    try {
      const app = await createApp({
        ...f.c,
        queue: {
          enabled: true,
          host: "127.0.0.1",
          port,
          password: randomBytes(32).toString("hex"),
        },
      });
      try {
        assert.equal(app.get(getQueueToken(EMAIL_QUEUE)).name, "email");
        await new Promise((resolve) => setTimeout(resolve, 400));
        assert.deepEqual(events, ['{"event":"email_queue_unavailable"}']);
        await request(app.getHttpServer()).get("/v1/health").expect(200);
        const response = await request(app.getHttpServer())
          .post("/v1/admin/auth/login")
          .set("Origin", f.c.FRONTEND_ORIGIN)
          .send({
            identifier: f.c.MASTER_EMAIL,
            password: f.c.MASTER_INITIAL_PASSWORD,
          });
        assert.equal(response.status, 200);
        assert.equal(response.body.stage, "password");
      } finally {
        await app.close();
      }
    } finally {
      await f.close();
    }
  },
);
