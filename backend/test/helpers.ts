import { AUTH_WORK } from "../src/auth/auth.tokens";
import { UnitOfWork } from "../src/application/auth/ports/repositories";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import { readConfig } from "../src/infra/config/config";
import { PrismaService } from "../src/infra/database/prisma/prisma.service";
import { INestApplication } from "@nestjs/common";
import { Vault } from "../src/infra/security/crypto";
import { Rates } from "../src/application/auth/use-cases/rate-limits";
import { Sessions } from "../src/application/auth/use-cases/sessions";
import { PasswordWork } from "../src/infra/security/password-work";
import { Mfa } from "../src/application/auth/use-cases/mfa";
import { MasterAdmission } from "../src/application/auth/use-cases/master-admission";
import { Login } from "../src/application/auth/use-cases/login";
import { BootstrapMaster } from "../src/application/auth/use-cases/bootstrap-master";

export function authServices(app: INestApplication) {
  return {
    vault: app.get(Vault),
    rates: app.get(Rates),
    sessions: app.get(Sessions),
    passwords: app.get(PasswordWork),
    mfa: app.get(Mfa),
    admission: app.get(MasterAdmission),
    login: app.get(Login),
    bootstrap: app.get(BootstrapMaster),
  };
}
import { createApp } from "../src/app";
export async function fixture(
  port = 15439,
  origins = { frontend: "http://localhost:3000", api: "http://localhost:3001" },
) {
  const dir = await mkdtemp(join(tmpdir(), "login-test-"));
  const password = randomBytes(24).toString("hex");
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "fixture",
    password,
    port,
    persistent: false,
    authMethod: "scram-sha-256",
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("login_test");
  const c = readConfig({
    NODE_ENV: "test",
    DATABASE_URL: `postgresql://fixture:${password}@127.0.0.1:${port}/login_test`,
    FRONTEND_ORIGIN: origins.frontend,
    PUBLIC_API_ORIGIN: origins.api,
    ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    HMAC_KEY: randomBytes(32).toString("hex"),
    MASTER_USERNAME: "fixture-master",
    MASTER_EMAIL: "master@example.invalid",
    MASTER_INITIAL_PASSWORD:
      process.env.FIXTURE_MASTER_PASSWORD || randomBytes(24).toString("hex"),
    API_IP_LIMIT: "10000",
    LOGIN_IP_LIMIT: "10000",
  });
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: c.DATABASE_URL },
    stdio: "pipe",
  });
  // Reapplying migrations is part of the startup contract.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: c.DATABASE_URL },
    stdio: "pipe",
  });
  const app = await createApp(c);
  const db = app.get(PrismaService),
    auth = authServices(app);
  await auth.bootstrap.init();
  return {
    c,
    db,
    auth,
    app,
    work: app.get<UnitOfWork>(AUTH_WORK),
    async close() {
      await app.close();
      await pg.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
