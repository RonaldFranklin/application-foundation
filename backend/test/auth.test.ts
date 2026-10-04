import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { fixture, authServices } from "./helpers";
import { createApp } from "../src/app";
import { INVALID } from "../src/application/auth/results";
import {
  hashPassword,
  verifyPassword,
  digest,
  totp,
} from "../src/infra/security/crypto";
import { readConfig } from "../src/infra/config/config";
import { Turnstile } from "../src/infra/integrations/turnstile";
let f: Awaited<ReturnType<typeof fixture>>;
let restricted: string, full: string, recovery: string[], masterId: string;
const newPassword = randomBytes(24).toString("hex");
const cookie = (r: any) => r.headers["set-cookie"][0].split(";")[0];
const raw = (s: string) => s.split("=")[1];
const post = (path: string, body: object = {}, session?: string) => {
  const r = request(f.app.getHttpServer())
    .post(`/v1/${path}`)
    .set("Origin", f.c.FRONTEND_ORIGIN)
    .set("Sec-Fetch-Site", "same-site")
    .send(body);
  return session ? r.set("Cookie", session) : r;
};
before(
  async () => {
    f = await fixture();
    masterId = (await f.db.user.findFirstOrThrow({ where: { master: true } }))
      .id;
  },
  { timeout: 60000 },
);
after(async () => {
  await f?.close();
});
test("config rejects missing/shared keys, production HTTP/test Turnstile", () => {
  assert.throws(() => readConfig({}));
  assert.throws(() =>
    readConfig({ ...f.c, ENCRYPTION_KEY: f.c.HMAC_KEY } as any),
  );
  assert.throws(() => readConfig({ ...f.c, NODE_ENV: "production" } as any));
});
test("AES-GCM random nonce, purpose binding, tamper authentication; versioned HMAC", () => {
  const a = f.auth.vault.encrypt("fixture@example.invalid", "email"),
    b = f.auth.vault.encrypt("fixture@example.invalid", "email");
  assert.notEqual(a, b);
  assert.equal(f.auth.vault.decrypt(a, "email"), "fixture@example.invalid");
  assert.throws(() => f.auth.vault.decrypt(a, "username"));
  const parts = a.split(".");
  parts[2] = randomBytes(16).toString("base64url");
  assert.throws(() => f.auth.vault.decrypt(parts.join("."), "email"));
  assert.equal(f.auth.vault.index(" TEST "), f.auth.vault.index("test"));
  assert.match(f.auth.vault.index("test"), /^v1:[a-f0-9]{64}$/);
  assert.ok(!a.includes("fixture"));
});
test("Argon2id salts, verifies long passphrase and does not truncate", async () => {
  const pass = "long passphrase ".repeat(40);
  const started = performance.now();
  const a = await hashPassword(pass);
  console.info(
    `Argon2id baseline: ${Math.round(performance.now() - started)}ms, 64MiB/t=3/p=1`,
  );
  assert.match(a, /^\$argon2id\$v=19\$m=65536,p=1,t=3/);
  assert.notEqual(a, await hashPassword(pass));
  assert.ok(await verifyPassword(a, pass));
  assert.equal(await verifyPassword(a, pass + "x"), false);
});
test("bootstrap idempotent under concurrency and runtime variable changes", async () => {
  const before = await f.db.user.findUniqueOrThrow({ where: { id: masterId } });
  const changedApp = await createApp({
    ...f.c,
    MASTER_INITIAL_PASSWORD: randomBytes(24).toString("hex"),
    MASTER_EMAIL: "different@example.invalid",
  });
  await Promise.all([
    authServices(changedApp).bootstrap.init(),
    f.auth.bootstrap.init(),
  ]);
  await changedApp.close();
  assert.equal(await f.db.user.count(), 1);
  assert.equal(
    (await f.db.user.findUniqueOrThrow({ where: { id: masterId } }))
      .passwordHash,
    before.passwordHash,
  );
});
test("generic failure and parameterized injection including non-existent blind rate state", async () => {
  await f.db.rateState.deleteMany({
    where: { key: { startsWith: "unknown-ip:" } },
  });
  const a = await post("auth/login", {
    identifier: "' OR 1=1; DROP TABLE users; --",
    password: "invalid",
  });
  const b = await post("auth/login", {
    identifier: "other@example.invalid",
    password: "invalid",
  });
  assert.equal(a.status, 401);
  assert.equal(a.body.message, INVALID);
  assert.equal(b.body.message, INVALID);
  assert.equal(await f.db.user.count(), 1);
  const [state] = await f.db.rateState.findMany({
    where: { key: { startsWith: "unknown-ip:" } },
    take: 1,
  });
  assert.ok(state);
  assert.equal(state.hits.length, 2);
});
test("master first login restricted; cookie is HttpOnly Lax and token stored only as digest", async () => {
  const r = await post("admin/auth/login", {
    identifier: f.c.MASTER_USERNAME,
    password: f.c.MASTER_INITIAL_PASSWORD,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.stage, "password");
  restricted = cookie(r);
  assert.match(r.headers["set-cookie"][0], /HttpOnly/);
  assert.match(r.headers["set-cookie"][0], /SameSite=Lax/);
  assert.ok(!JSON.stringify(r.body).includes(raw(restricted)));
  assert.ok(
    await f.db.session.findUnique({
      where: { digest: digest(raw(restricted)) },
    }),
  );
  for (const p of ["welcome", "admin/welcome"])
    assert.equal(
      (
        await request(f.app.getHttpServer())
          .get("/v1/" + p)
          .set("Cookie", restricted)
      ).status,
      401,
    );
  assert.equal(
    (await post("admin/auth/totp/setup", {}, restricted)).status,
    401,
  );
  assert.equal((await post("admin/auth/confirm", {}, restricted)).status, 401);
});
test("mandatory password change rotates token, revokes old session, persists across bootstrap", async () => {
  assert.equal(
    (await post("admin/auth/password", { password: "too short" }, restricted))
      .status,
    400,
  );
  assert.equal(
    (
      await post(
        "admin/auth/password",
        { password: f.c.MASTER_INITIAL_PASSWORD },
        restricted,
      )
    ).status,
    401,
  );
  const old = restricted;
  const r = await post(
    "admin/auth/password",
    { password: newPassword },
    restricted,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.stage, "setup");
  restricted = cookie(r);
  assert.notEqual(old, restricted);
  assert.equal(await f.auth.sessions.session(raw(old)), null);
  await f.auth.bootstrap.init();
  assert.ok(
    await verifyPassword(
      (await f.db.user.findUniqueOrThrow({ where: { id: masterId } }))
        .passwordHash,
      newPassword,
    ),
  );
});
test("TOTP setup verification, replay protection, codes shown only once, explicit completion", async () => {
  const setup = await post("admin/auth/totp/setup", {}, restricted);
  assert.equal(setup.status, 200);
  const secret = setup.body.secret;
  assert.notEqual(
    (await f.db.user.findUniqueOrThrow({ where: { id: masterId } })).totpSecret,
    secret,
  );
  assert.equal(
    (await post("admin/auth/totp/enroll", { code: "badbad" }, restricted))
      .status,
    401,
  );
  const code = totp(secret).generate();
  const r = await post("admin/auth/totp/enroll", { code }, restricted);
  assert.equal(r.status, 200);
  assert.equal(r.body.recoveryCodes.length, 10);
  recovery = r.body.recoveryCodes;
  restricted = cookie(r);
  assert.equal(r.body.stage, "recovery");
  assert.equal(
    (
      await request(f.app.getHttpServer())
        .get("/v1/admin/welcome")
        .set("Cookie", restricted)
    ).status,
    401,
  );
  assert.equal(
    (await post("admin/auth/totp/enroll", { code }, restricted)).status,
    401,
  );
  assert.equal(
    (await post("admin/auth/totp/setup", {}, restricted)).status,
    401,
  );
  const done = await post("admin/auth/confirm", {}, restricted);
  assert.equal(done.status, 200);
  full = cookie(done);
  assert.equal(done.body.stage, "full");
  assert.ok(!done.body.recoveryCodes);
  assert.equal(
    (
      await request(f.app.getHttpServer())
        .get("/v1/admin/welcome")
        .set("Cookie", full)
    ).status,
    200,
  );
  assert.equal(
    (
      await request(f.app.getHttpServer())
        .get("/v1/welcome")
        .set("Cookie", full)
    ).status,
    401,
  );
  const login = await post("admin/auth/login", {
    identifier: f.c.MASTER_EMAIL,
    password: newPassword,
  });
  assert.equal(login.body.stage, "mfa");
  restricted = cookie(login);
  assert.equal(
    (await post("admin/auth/mfa", { code }, restricted)).status,
    401,
  );
});
test("recovery code single-use even under concurrency; normal master login cannot skip MFA", async () => {
  const results = await Promise.all([
    post("admin/auth/mfa", { code: recovery[0] }, restricted),
    post("admin/auth/mfa", { code: recovery[0] }, restricted),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  assert.equal(
    await f.db.recoveryCode.count({ where: { digest: digest(recovery[0]) } }),
    0,
  );
  assert.equal(
    await f.db.recoveryCode.count({ where: { userId: masterId } }),
    9,
  );
});
test("ordinary flow has no master MFA, and API refuses cross-flow credentials and endpoints", async () => {
  const v = f.auth.vault;
  await f.db.user.create({
    data: {
      username: v.encrypt("fixture-user", "username"),
      email: v.encrypt("user@example.invalid", "email"),
      usernameIndex: v.index("fixture-user"),
      emailIndex: v.index("user@example.invalid"),
      passwordHash: await hashPassword(newPassword),
    },
  });
  assert.equal(
    (
      await post("auth/login", {
        identifier: f.c.MASTER_USERNAME,
        password: newPassword,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post("admin/auth/login", {
        identifier: "fixture-user",
        password: newPassword,
      })
    ).status,
    401,
  );
  const r = await post("auth/login", {
    identifier: "fixture-user",
    password: newPassword,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.stage, "full");
  const session = cookie(r);
  assert.equal(
    (
      await request(f.app.getHttpServer())
        .get("/v1/welcome")
        .set("Cookie", session)
    ).status,
    200,
  );
  assert.equal(
    (
      await request(f.app.getHttpServer())
        .get("/v1/admin/welcome")
        .set("Cookie", session)
    ).status,
    401,
  );
  assert.equal((await post("admin/auth/totp/setup", {}, session)).status, 401);
});
test("CSRF origin/metadata/content type and body limits", async () => {
  const server = f.app.getHttpServer();
  assert.equal(
    (await request(server).post("/v1/auth/logout").set("Cookie", full).send({}))
      .status,
    403,
  );
  assert.equal(
    (
      await request(server)
        .post("/v1/auth/logout")
        .set("Origin", "https://evil.invalid")
        .send({})
    ).status,
    403,
  );
  assert.equal(
    (await post("auth/logout", {}, full).set("Sec-Fetch-Site", "cross-site"))
      .status,
    403,
  );
  assert.equal(
    (
      await request(server)
        .post("/v1/auth/logout")
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .type("form")
        .send("x=y")
    ).status,
    403,
  );
  assert.equal(
    (await post("auth/login", { identifier: "x", password: "x".repeat(10000) }))
      .status,
    413,
  );
});
test("absolute expiry and idempotent revocation; auth no-store", async () => {
  const r = await request(f.app.getHttpServer())
    .get("/v1/admin/welcome")
    .set("Cookie", full);
  assert.equal(r.headers["cache-control"], "no-store");
  await f.db.session.update({
    where: { digest: digest(raw(full)) },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  assert.equal(
    (
      await request(f.app.getHttpServer())
        .get("/v1/admin/welcome")
        .set("Cookie", full)
    ).status,
    401,
  );
  assert.equal((await post("auth/logout", {}, full)).status, 204);
  assert.equal((await post("auth/logout", {}, full)).status, 204);
  assert.equal(await f.auth.sessions.session(raw(full)), null);
});
test("atomic IP rolling window accepts exactly the configured limit under 30 concurrent calls", async () => {
  const results = await Promise.all(
    Array.from({ length: 30 }, () => f.auth.rates.ip("concurrent-ip", 10)),
  );
  assert.equal(results.filter(Boolean).length, 10);
});
test("atomic account cooldown, rolling window, escalation and alias sharing", async () => {
  const identifier = "fixture-user",
    u = await f.db.user.findUniqueOrThrow({
      where: { usernameIndex: f.auth.vault.index(identifier) },
    }),
    key = `account:${u.id}`;
  await f.db.rateState.deleteMany({ where: { key } });
  const r = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      f.auth.login.execute(
        false,
        {
          identifier: i % 2 ? identifier : "user@example.invalid",
          password: "bad",
          turnstileToken: undefined,
        },
        { ip: "127.0.0.1", previous: undefined, deviceRaw: undefined },
      ),
    ),
  );
  assert.ok(r.every((x) => !x.ok));
  let state = await f.db.rateState.findUniqueOrThrow({ where: { key } });
  assert.equal(state.cycles, 1);
  assert.ok(+state.blockedUntil! > Date.now() + 290000);
  assert.equal(
    (
      await f.auth.login.execute(
        false,
        {
          identifier: identifier,
          password: newPassword,
          turnstileToken: undefined,
        },
        { ip: "127.0.0.1", previous: undefined, deviceRaw: undefined },
      )
    ).ok,
    false,
  );
  for (const cycle of [2, 3, 4, 5]) {
    await f.db.rateState.update({
      where: { key },
      data: { blockedUntil: new Date(0) },
    });
    for (let i = 0; i < 3; i++)
      await f.auth.login.execute(
        false,
        { identifier: identifier, password: "bad", turnstileToken: undefined },
        { ip: "127.0.0.1", previous: undefined, deviceRaw: undefined },
      );
    state = await f.db.rateState.findUniqueOrThrow({ where: { key } });
    assert.equal(state.cycles, cycle);
    const expected = Math.min(300000 * 2 ** (cycle - 1), 1800000);
    assert.ok(+state.blockedUntil! > Date.now() + expected - 10000);
  }
  await f.db.rateState.update({
    where: { key },
    data: { blockedUntil: new Date(0), hits: [new Date(Date.now() - 900001)] },
  });
  assert.equal(
    (
      await f.auth.login.execute(
        false,
        {
          identifier: identifier,
          password: newPassword,
          turnstileToken: undefined,
        },
        { ip: "127.0.0.1", previous: undefined, deviceRaw: undefined },
      )
    ).ok,
    true,
  );
  assert.equal(await f.db.rateState.findUnique({ where: { key } }), null);
});
test("Argon2 concurrency overload returns a retryable busy result without hashing", async () => {
  const auth = f.auth.passwords as unknown as { passwordWorkActive: number };
  auth.passwordWorkActive = f.c.PASSWORD_HASH_CONCURRENCY;
  try {
    const result = await f.auth.login.execute(
      false,
      {
        identifier: "fixture-user",
        password: "incorrect",
        turnstileToken: undefined,
      },
      { ip: "127.0.0.1", previous: undefined, deviceRaw: undefined },
    );
    assert.deepEqual(result, { busy: true });
  } finally {
    auth.passwordWorkActive = 0;
  }
});

test("Turnstile is endpoint-adaptive, including unknown identities; missing config fails closed", async () => {
  for (const identifier of [
    "fixture-master",
    "fixture-user",
    "captcha-unknown",
  ]) {
    await f.db.rateState.deleteMany({
      where: { key: { in: ["master-risk", "master-anonymous"] } },
    });
    const a = await post("admin/auth/login", { identifier, password: "bad" });
    const b = await post("admin/auth/login", { identifier, password: "bad" });
    assert.deepEqual(a.body, { message: INVALID, challengeRequired: false });
    assert.deepEqual(b.body, { message: INVALID, challengeRequired: true });
    const c = await post("admin/auth/login", {
      identifier,
      password: "bad",
      turnstileToken: "arbitrary",
    });
    assert.equal(c.status, 401);
    assert.deepEqual(c.body, b.body);
    const state = await f.db.rateState.findUniqueOrThrow({
      where: { key: "master-anonymous" },
    });
    assert.equal(state.hits.length, 2);
    assert.equal(state.cycles, 0);
  }
});
test("Turnstile Siteverify verifies success/action/hostname/age and handles service failures", async () => {
  const original = globalThis.fetch;
  const config = {
    ...f.c,
    TURNSTILE_SECRET_KEY: "test-placeholder",
    TURNSTILE_HOSTNAME: "localhost",
  };
  try {
    for (const [value, expected] of [
      [
        {
          success: true,
          action: "master-login",
          hostname: "localhost",
          challenge_ts: new Date().toISOString(),
        },
        true,
      ],
      [{ success: false }, false],
      [
        {
          success: true,
          action: "wrong",
          hostname: "localhost",
          challenge_ts: new Date().toISOString(),
        },
        false,
      ],
      [
        {
          success: true,
          action: "master-login",
          hostname: "evil.invalid",
          challenge_ts: new Date().toISOString(),
        },
        false,
      ],
      [
        {
          success: true,
          action: "master-login",
          hostname: "localhost",
          challenge_ts: new Date(0).toISOString(),
        },
        false,
      ],
    ] as const) {
      globalThis.fetch = async (_url, options) => {
        assert.match(String(options?.body), /response=fixture-token/);
        return new Response(JSON.stringify(value));
      };
      assert.equal(
        await new Turnstile(config).verify("fixture-token", "127.0.0.1"),
        expected,
      );
    }
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    assert.equal(
      await new Turnstile(config).verify("fixture-token", "127.0.0.1"),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("untrusted X-Forwarded-For cannot evade login IP limiter", async () => {
  f.c.LOGIN_IP_LIMIT = 2;
  await f.db.rateState.deleteMany({ where: { key: { startsWith: "login:" } } });
  const r = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      post("auth/login", { identifier: "proxy-test", password: "bad" }).set(
        "X-Forwarded-For",
        `198.51.100.${i}`,
      ),
    ),
  );
  assert.equal(r.filter((x) => x.status === 401).length, 2);
  assert.equal(r.filter((x) => x.status === 429).length, 3);
});

test("HTTPS cookie flags and exact CORS; restricted expiry", async () => {
  const original = f.c.PUBLIC_API_ORIGIN;
  f.c.PUBLIC_API_ORIGIN = "https://localhost";
  f.c.LOGIN_IP_LIMIT = 10000;
  try {
    const r = await post("auth/login", {
      identifier: "fixture-user",
      password: newPassword,
    });
    assert.equal(r.status, 200);
    assert.match(r.headers["set-cookie"][0], /^__Host-login_session=/);
    assert.match(r.headers["set-cookie"][0], /; Secure/);
    assert.match(r.headers["set-cookie"][0], /; Path=\//);
    assert.ok(!r.headers["set-cookie"][0].includes("Domain="));
  } finally {
    f.c.PUBLIC_API_ORIGIN = original;
  }
  const r = await request(f.app.getHttpServer())
    .options("/v1/auth/login")
    .set("Origin", "https://evil.invalid")
    .set("Access-Control-Request-Method", "POST");
  assert.notEqual(
    r.headers["access-control-allow-origin"],
    "https://evil.invalid",
  );
  const s = await f.work.run((tx) =>
    f.auth.sessions.createSession(tx, masterId, "setup"),
  );
  await f.db.session.update({
    where: { digest: digest(s.raw) },
    data: { expiresAt: new Date(0) },
  });
  assert.equal(await f.auth.mfa.setup(s.raw), null);
});

test("TOTP accepts a fresh clock step, rejects consumed recovery in a new session", async () => {
  await f.db.rateState.deleteMany({ where: { key: `account:${masterId}` } });
  const secret = f.auth.vault.decrypt(
    (await f.db.user.findUniqueOrThrow({ where: { id: masterId } }))
      .totpSecret!,
    "totp",
  );
  const s = await f.work.run((tx) =>
    f.auth.sessions.createSession(tx, masterId, "mfa"),
  );
  assert.equal(await f.auth.mfa.mfa(s.raw, { code: recovery[0] }, false), null);
  const next = totp(secret).generate({ timestamp: Date.now() + 30000 });
  const success = await f.auth.mfa.mfa(s.raw, { code: next }, false);
  assert.equal(success.stage, "full");
  assert.equal(await f.auth.sessions.session(s.raw), null);
});

test("compiled startup uses migrations and does not reset changed master password", async () => {
  const { spawn } = await import("node:child_process");
  const env = Object.fromEntries(
    Object.entries(f.c).map(([key, value]) => [key, String(value)]),
  );
  const child = spawn(process.execPath, ["dist/main.js"], {
    env: { ...process.env, ...env, PORT: "15442" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Compiled server startup timed out")),
        10000,
      );
      child.stdout.on("data", (data) => {
        if (String(data).includes("server_started")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Compiled server exited: ${code}`));
      });
    });
    const response = await fetch("http://127.0.0.1:15442/v1/health");
    assert.equal(response.status, 200);
    assert.ok(
      await verifyPassword(
        (await f.db.user.findUniqueOrThrow({ where: { id: masterId } }))
          .passwordHash,
        newPassword,
      ),
    );
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
});
