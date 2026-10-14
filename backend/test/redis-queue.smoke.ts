// Explicit opt-in: only this command creates a disposable Redis container.
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { getQueueToken } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  EmailQueueModule,
  EMAIL_QUEUE,
} from "../src/infra/queues/email-queue.module";

test(
  "BullMQ connects to authenticated disposable Redis with AOF and no eviction",
  { timeout: 30000 },
  async () => {
    const password = randomBytes(32).toString("hex");
    const docker = (args: string[]) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, REDIS_PASSWORD: password },
      }).trim();
    const id = docker([
      "run",
      "--detach",
      "--rm",
      "--tmpfs",
      "/data",
      "--tmpfs",
      "/run/redis",
      "--publish",
      "127.0.0.1::6379",
      "--env",
      "REDIS_PASSWORD",
      "--volume",
      `${resolve("../infra/redis/start.sh")}:/start.sh:ro`,
      "--entrypoint",
      "sh",
      "redis:8.6.2-alpine",
      "/start.sh",
    ]);
    try {
      const port = Number(docker(["port", id, "6379/tcp"]).split(":").at(-1));
      const app = await NestFactory.createApplicationContext(
        EmailQueueModule.register({
          enabled: true,
          host: "127.0.0.1",
          port,
          password,
        }),
        { logger: false },
      );
      try {
        const queue = app.get<Queue>(getQueueToken(EMAIL_QUEUE));
        await queue.waitUntilReady();
        assert.equal(await queue.count(), 0);
        assert.equal(
          docker([
            "exec",
            id,
            "sh",
            "-c",
            'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning ping | grep -qx PONG',
          ]),
          "",
        );
        assert.ok(!docker(["top", id, "-eo", "pid,args"]).includes(password));
        const redis = new Redis({ host: "127.0.0.1", port, password });
        try {
          assert.deepEqual(await redis.config("GET", "appendonly"), [
            "appendonly",
            "yes",
          ]);
          assert.deepEqual(await redis.config("GET", "appendfsync"), [
            "appendfsync",
            "everysec",
          ]);
          assert.deepEqual(await redis.config("GET", "maxmemory-policy"), [
            "maxmemory-policy",
            "noeviction",
          ]);
        } finally {
          redis.disconnect();
        }
        const anonymous = new Redis({
          host: "127.0.0.1",
          port,
          enableReadyCheck: false,
          retryStrategy: () => null,
        });
        anonymous.on("error", () => {});
        try {
          await assert.rejects(anonymous.ping(), /NOAUTH/);
        } finally {
          anonymous.disconnect();
        }
      } finally {
        await app.close();
      }
    } finally {
      docker(["rm", "--force", id]);
    }
  },
);
