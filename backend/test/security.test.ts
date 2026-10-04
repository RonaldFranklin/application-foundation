import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { fixture, authServices } from "./helpers";
import { INVALID } from "../src/application/auth/results";
import { PrismaService } from "../src/infra/database/prisma/prisma.service";
import { createApp } from "../src/app";
import { openapi } from "../src/presentation/http/openapi";
import { hashPassword, digest, totp } from "../src/infra/security/crypto";
import { readConfig } from "../src/infra/config/config";
let f: Awaited<ReturnType<typeof fixture>>;
let otherDb: PrismaService;
let otherApp: Awaited<ReturnType<typeof createApp>>,
  other: ReturnType<typeof authServices>;
let masterId: string, device: string;
const password = randomBytes(24).toString("hex");
const originalFetch = globalThis.fetch;
const post = (flow: string, identifier: string, passwordValue = "wrong") =>
  request(f.app.getHttpServer())
    .post(`/v1/${flow}auth/login`)
    .set("Origin", f.c.FRONTEND_ORIGIN)
    .send({ identifier, password: passwordValue });
const successCaptcha = async () =>
  new Response(
    JSON.stringify({
      success: true,
      action: "master-login",
      hostname: "localhost",
      challenge_ts: new Date().toISOString(),
    }),
  );
before(
  async () => {
    f = await fixture(15441);
    masterId = (await f.db.user.findFirstOrThrow({ where: { master: true } }))
      .id;
    const secret = totp().secret.base32;
    await f.db.user.update({
      where: { id: masterId },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
        totpSecret: f.auth.vault.encrypt(secret, "totp"),
        totpVerified: true,
      },
    });
    const v = f.auth.vault;
    await f.db.user.create({
      data: {
        username: v.encrypt("fixture-user", "username"),
        email: v.encrypt("user@example.invalid", "email"),
        usernameIndex: v.index("fixture-user"),
        emailIndex: v.index("user@example.invalid"),
        passwordHash: await hashPassword(password),
      },
    });
    // Issue the admission capability through the actual MFA endpoint, not by inserting a raw token.
    const restricted = await f.work.run((tx) =>
      f.auth.sessions.createSession(tx, masterId, "mfa"),
    );
    const result = await request(f.app.getHttpServer())
      .post("/v1/admin/auth/mfa")
      .set("Origin", f.c.FRONTEND_ORIGIN)
      .set("Cookie", `login_session=${restricted.raw}`)
      .send({ code: totp(secret).generate() });
    assert.equal(result.status, 200);
    assert.equal(result.body.deviceRaw, undefined);
    const header = (result.headers["set-cookie"] as unknown as string[]).find(
      (c) => c.startsWith("login_master_device="),
    )!;
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    device = header.split(";")[0].split("=")[1];
    assert.ok(
      await f.db.masterDevice.findUnique({ where: { digest: digest(device) } }),
    );
    otherApp = await createApp(f.c);
    other = authServices(otherApp);
    otherDb = otherApp.get(PrismaService);
    other.passwords.dummy = f.auth.passwords.dummy;
  },
  { timeout: 60000 },
);
beforeEach(async () => {
  await f.db.rateState.deleteMany();
  f.c.LOGIN_IP_LIMIT = 10000;
  f.c.TURNSTILE_SECRET_KEY = "synthetic-test-key";
  globalThis.fetch = successCaptcha;
});
after(async () => {
  globalThis.fetch = originalFetch;
  await otherApp?.close();
  await f?.close();
});

test("common login equivalent status/body/challenge for master, common and missing identities across cooldowns", async () => {
  for (let round = 0; round < 4; round++)
    for (const identifier of [
      "fixture-master",
      "master@example.invalid",
      "fixture-user",
      "missing@example.invalid",
    ]) {
      const r = await post("", identifier);
      assert.equal(r.status, 401);
      assert.deepEqual(r.body, { message: INVALID, challengeRequired: false });
      assert.equal(r.headers["set-cookie"], undefined);
      assert.equal(r.headers["retry-after"], undefined);
    }
  assert.equal(
    await f.db.rateState.findUnique({ where: { key: `account:${masterId}` } }),
    null,
  );
  assert.equal(
    await f.db.rateState.findUnique({ where: { key: "master-risk" } }),
    null,
  );
  // Even a correct master password on the wrong route cannot affect master admission.
  assert.deepEqual((await post("", "fixture-master", password)).body, {
    message: INVALID,
    challengeRequired: false,
  });
  const master = await f.auth.login.execute(
    true,
    {
      identifier: "fixture-master",
      password: password,
      turnstileToken: undefined,
    },
    { ip: "192.0.2.1", previous: undefined, deviceRaw: undefined },
  );
  assert.equal(master.ok, true);
  assert.equal(master.stage, "mfa");
});

test("challenge progression independent of existence, malformed fields, IP changes or lockout", async () => {
  for (const identifier of ["fixture-master", "fixture-user", "missing"]) {
    await f.db.rateState.deleteMany();
    assert.equal(
      (await post("admin/", identifier)).body.challengeRequired,
      false,
    );
    assert.equal(
      (await post("admin/", identifier)).body.challengeRequired,
      true,
    );
    const missing = await f.auth.login.execute(
      true,
      {
        identifier: "different-missing",
        password: "bad",
        turnstileToken: undefined,
      },
      { ip: "192.0.2.99", previous: undefined, deviceRaw: undefined },
    );
    assert.deepEqual(missing, { ok: false, challengeRequired: true });
    const malformed = await request(f.app.getHttpServer())
      .post("/v1/admin/auth/login")
      .set("Origin", f.c.FRONTEND_ORIGIN)
      .send({ identifier });
    assert.deepEqual(malformed.body, {
      message: INVALID,
      challengeRequired: true,
    });
    await f.auth.login.execute(
      true,
      {
        identifier: identifier,
        password: "wrong",
        turnstileToken: "synthetic-token",
      },
      { ip: "192.0.2.99", previous: undefined, deviceRaw: undefined },
    );
    for (const otherId of ["fixture-master", "fixture-user", "missing"])
      assert.deepEqual((await post("admin/", otherId)).body, {
        message: INVALID,
        challengeRequired: true,
      });
  }
});

test("shared admission reservation rechecks CAPTCHA under concurrent threshold crossing", async () => {
  const results = await Promise.all([
    f.auth.login.execute(
      true,
      {
        identifier: "fixture-master",
        password: "bad",
        turnstileToken: undefined,
      },
      { ip: "192.0.2.1", previous: undefined, deviceRaw: undefined },
    ),
    other.login.execute(
      true,
      { identifier: "missing", password: "bad", turnstileToken: undefined },
      { ip: "192.0.2.2", previous: undefined, deviceRaw: undefined },
    ),
    f.auth.login.execute(
      true,
      {
        identifier: "fixture-user",
        password: "bad",
        turnstileToken: undefined,
      },
      { ip: "192.0.2.3", previous: undefined, deviceRaw: undefined },
    ),
  ]);
  assert.ok(results.every((r) => r.ok === false));
  const state = await f.db.rateState.findUniqueOrThrow({
    where: { key: "master-anonymous" },
  });
  assert.equal(state.hits.length, 2);
  assert.equal(state.cycles, 0);
});

test("anonymous master budget is global across IPs, aliases and replicas; cooldown escalates without extension", async () => {
  for (const cycle of [1, 2, 3, 4]) {
    if (cycle > 1)
      await f.db.rateState.update({
        where: { key: "master-anonymous" },
        data: { blockedUntil: new Date(0) },
      });
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        (i % 2 ? other : f.auth).login.execute(
          true,
          {
            identifier: i % 2 ? "master@example.invalid" : "fixture-master",
            password: "bad",
            turnstileToken: "synthetic-token",
          },
          { ip: `192.0.2.${i}`, previous: undefined, deviceRaw: undefined },
        ),
      ),
    );
    assert.ok(results.every((r) => r.ok === false));
    const state = await otherDb.rateState.findUniqueOrThrow({
      where: { key: "master-anonymous" },
    });
    assert.equal(state.cycles, cycle);
    assert.equal(state.hits.length, 0);
    const duration = Math.min(60000 * 2 ** (cycle - 1), 300000);
    assert.ok(+state.blockedUntil! > Date.now() + duration - 5000);
    await other.login.execute(
      true,
      {
        identifier: "unrelated-missing",
        password: "bad",
        turnstileToken: "synthetic-token",
      },
      { ip: "198.51.100.20", previous: undefined, deviceRaw: undefined },
    );
    assert.equal(
      +(
        await f.db.rateState.findUniqueOrThrow({
          where: { key: "master-anonymous" },
        })
      ).blockedUntil!,
      +state.blockedUntil!,
    );
  }
});

test("MFA-recognized device survives anonymous lockout; it still needs CAPTCHA, password and MFA", async () => {
  for (let i = 0; i < 3; i++)
    await f.auth.login.execute(
      true,
      {
        identifier: "missing",
        password: "bad",
        turnstileToken: "synthetic-token",
      },
      { ip: `192.0.2.${i}`, previous: undefined, deviceRaw: undefined },
    );
  assert.equal(
    (
      await other.login.execute(
        true,
        {
          identifier: "fixture-master",
          password: password,
          turnstileToken: "synthetic-token",
        },
        { ip: "198.51.100.1", previous: undefined, deviceRaw: undefined },
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await other.login.execute(
        true,
        {
          identifier: "fixture-master",
          password: password,
          turnstileToken: undefined,
        },
        { ip: "198.51.100.1", previous: undefined, deviceRaw: device },
      )
    ).ok,
    false,
  );
  const r = await other.login.execute(
    true,
    {
      identifier: "fixture-master",
      password: password,
      turnstileToken: "synthetic-token",
    },
    { ip: "198.51.100.1", previous: undefined, deviceRaw: device },
  );
  assert.equal(r.ok, true);
  assert.equal(r.stage, "mfa");
  assert.equal(await f.auth.sessions.welcome(r.raw, true), null);
  // The admission token itself is never a session.
  assert.equal(await f.auth.sessions.session(device), null);
  assert.equal((await f.auth.rates.read(`mfa:${masterId}`)).blocked, false);
  const secret = f.auth.vault.decrypt(
    (await f.db.user.findUniqueOrThrow({ where: { id: masterId } }))
      .totpSecret!,
    "totp",
  );
  const completed = await other.mfa.mfa(
    r.raw!,
    { code: totp(secret).generate({ timestamp: Date.now() + 30000 }) },
    false,
    device,
  );
  assert.equal(completed.stage, "full");
  assert.ok(completed.deviceRaw);
  assert.equal(
    await f.db.masterDevice.findUnique({ where: { digest: digest(device) } }),
    null,
  );
  device = completed.deviceRaw;
  assert.equal(await f.auth.admission.challengeRequired(), false);
});

test("device budget is also durable and progressive across replicas, not reset by IP rotation", async () => {
  const key = `master-device:${digest(device)}`;
  for (const cycle of [1, 2]) {
    if (cycle > 1)
      await f.db.rateState.update({
        where: { key },
        data: { blockedUntil: new Date(0) },
      });
    await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        (i % 2 ? other : f.auth).login.execute(
          true,
          {
            identifier: "fixture-master",
            password: "wrong",
            turnstileToken: "synthetic-token",
          },
          { ip: `198.51.100.${i}`, previous: undefined, deviceRaw: device },
        ),
      ),
    );
    const state = await otherDb.rateState.findUniqueOrThrow({ where: { key } });
    assert.equal(state.cycles, cycle);
    assert.ok(
      +state.blockedUntil! > Date.now() + 60000 * 2 ** (cycle - 1) - 5000,
    );
    assert.equal(
      (
        await other.login.execute(
          true,
          {
            identifier: "fixture-master",
            password: password,
            turnstileToken: "synthetic-token",
          },
          { ip: "203.0.113.9", previous: undefined, deviceRaw: device },
        )
      ).ok,
      false,
    );
  }
});

test("MFA failure budget is separate and shared across devices/replicas", async () => {
  const a = await f.work.run((tx) =>
    f.auth.sessions.createSession(tx, masterId, "mfa"),
  );
  const b = await f.work.run((tx) =>
    f.auth.sessions.createSession(tx, masterId, "mfa"),
  );
  await Promise.all([
    f.auth.mfa.mfa(a.raw, { code: "invalid" }, false),
    other.mfa.mfa(b.raw, { code: "invalid" }, false),
    f.auth.mfa.mfa(a.raw, { code: "invalid" }, false),
  ]);
  assert.equal((await other.rates.read(`mfa:${masterId}`)).blocked, true);
  assert.equal((await other.rates.read("master-anonymous")).blocked, false);
  assert.equal(await f.auth.mfa.mfa(b.raw, { code: "invalid" }, false), null);
});

test("expired/forged/revoked admission cannot evade anonymous cooldown; logout can forget device", async () => {
  await f.db.rateState.create({
    data: {
      key: "master-anonymous",
      hits: [],
      cycles: 1,
      blockedUntil: new Date(Date.now() + 60000),
    },
  });
  for (const candidate of [randomBytes(32).toString("base64url"), device + "x"])
    assert.equal(
      (
        await f.auth.login.execute(
          true,
          {
            identifier: "fixture-master",
            password: password,
            turnstileToken: "synthetic-token",
          },
          { ip: "192.0.2.1", previous: undefined, deviceRaw: candidate },
        )
      ).ok,
      false,
    );
  const stored = await f.db.masterDevice.findUniqueOrThrow({
    where: { digest: digest(device) },
  });
  await f.db.masterDevice.update({
    where: { digest: stored.digest },
    data: { expiresAt: new Date(0) },
  });
  assert.equal(
    (
      await f.auth.login.execute(
        true,
        {
          identifier: "fixture-master",
          password: password,
          turnstileToken: "synthetic-token",
        },
        { ip: "192.0.2.1", previous: undefined, deviceRaw: device },
      )
    ).ok,
    false,
  );
  await f.db.masterDevice.update({
    where: { digest: stored.digest },
    data: { expiresAt: stored.expiresAt },
  });
  const logout = () =>
    request(f.app.getHttpServer())
      .post("/v1/auth/logout")
      .set("Origin", f.c.FRONTEND_ORIGIN)
      .set("Cookie", `login_master_device=${device}`);
  assert.equal((await logout().send({})).status, 204);
  assert.ok(
    await f.db.masterDevice.findUnique({ where: { digest: stored.digest } }),
  );
  const r = await logout().send({ forgetDevice: true });
  assert.equal(r.status, 204);
  assert.equal(
    await f.db.masterDevice.findUnique({ where: { digest: stored.digest } }),
    null,
  );
  assert.equal(
    (
      await f.auth.login.execute(
        true,
        {
          identifier: "fixture-master",
          password: password,
          turnstileToken: "synthetic-token",
        },
        { ip: "192.0.2.1", previous: undefined, deviceRaw: device },
      )
    ).ok,
    false,
  );
});

test("ordinary route busy/429 responses cannot expose account type", async () => {
  (f.auth.passwords as any).passwordWorkActive = f.c.PASSWORD_HASH_CONCURRENCY;
  try {
    for (const id of ["fixture-master", "fixture-user", "missing"]) {
      const r = await post("", id);
      assert.equal(r.status, 503);
      assert.deepEqual(r.body, {
        message: "Autenticação temporariamente indisponível.",
      });
    }
  } finally {
    (f.auth.passwords as any).passwordWorkActive = 0;
  }
  f.c.LOGIN_IP_LIMIT = 1;
  await f.db.rateState.deleteMany();
  await post("", "missing");
  for (const id of ["fixture-master", "fixture-user", "missing"]) {
    const r = await post("", id);
    assert.equal(r.status, 429);
    assert.deepEqual(r.body, { message: INVALID });
    assert.equal(r.headers["retry-after"], "60");
  }
});

test("production HTTPS and development HTTP use matching issuance, clearing and OpenAPI cookie names", async () => {
  for (const https of [false, true]) {
    const c = readConfig({
      ...Object.fromEntries(
        Object.entries(f.c).map(([k, v]) => [k, String(v)]),
      ),
      NODE_ENV: https ? "production" : "development",
      PUBLIC_API_ORIGIN: https
        ? "https://login.example.invalid"
        : "http://localhost:3001",
      FRONTEND_ORIGIN: https
        ? "https://login.example.invalid"
        : "http://localhost:3000",
      TURNSTILE_SECRET_KEY: "synthetic-production-shaped-key",
      TURNSTILE_HOSTNAME: "login.example.invalid",
    });
    const app = await createApp(c);
    try {
      const name = https ? "__Host-login_session" : "login_session";
      const r = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .set("Origin", c.FRONTEND_ORIGIN)
        .send({ identifier: "fixture-user", password });
      assert.equal(r.status, 200);
      const h = r.headers["set-cookie"][0];
      assert.ok(h.startsWith(`${name}=`));
      assert.equal(h.includes("; Secure"), https);
      assert.match(h, /HttpOnly/);
      assert.match(h, /SameSite=Lax/);
      assert.match(h, /Path=\//);
      assert.ok(!h.includes("Domain="));
      const doc = openapi(app, c);
      assert.equal(
        (doc.components!.securitySchemes!.login_session as any).name,
        name,
      );
      const cleared = await request(app.getHttpServer())
        .post("/v1/auth/logout")
        .set("Origin", c.FRONTEND_ORIGIN)
        .send({ forgetDevice: true });
      assert.equal(cleared.status, 204);
      for (const cookie of cleared.headers[
        "set-cookie"
      ] as unknown as string[]) {
        assert.equal(cookie.includes("; Secure"), https);
        assert.match(cookie, /HttpOnly/);
        assert.match(cookie, /SameSite=Lax/);
        assert.ok(!cookie.includes("Domain="));
      }
    } finally {
      await app.close();
    }
  }
});

test("logout preserves session-cookie clearing when device persistence fails after revocation", async () => {
  const { AUTH_REPOSITORIES } = await import("../src/auth/auth.tokens");
  const repos =
    f.app.get<
      import("../src/application/auth/ports/repositories").AuthRepositories
    >(AUTH_REPOSITORIES);
  const original = repos.sessions.deleteDevice;
  repos.sessions.deleteDevice = async () => {
    throw new Error("synthetic persistence failure");
  };
  try {
    const response = await request(f.app.getHttpServer())
      .post("/v1/auth/logout")
      .set("Origin", f.c.FRONTEND_ORIGIN)
      .set(
        "Cookie",
        `login_session=synthetic-session; login_master_device=${"a".repeat(43)}`,
      )
      .send({ forgetDevice: true });
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      message: "Serviço temporariamente indisponível.",
    });
    const cookies = response.headers["set-cookie"] as unknown as string[];
    assert.ok(cookies.some((value) => value.startsWith("login_session=;")));
    assert.equal(
      cookies.some((value) => value.startsWith("login_master_device=")),
      false,
    );
  } finally {
    repos.sessions.deleteDevice = original;
  }
});

test("protected profile is current, minimal and selected exclusively by the session", async () => {
  const common = await f.db.user.findFirstOrThrow({ where: { master: false } });
  for (const [id, route, accountType] of [
    [common.id, "welcome", "common"],
    [masterId, "admin/welcome", "master"],
  ] as const) {
    const session = await f.work.run((tx) =>
      f.auth.sessions.createSession(tx, id, "full"),
    );
    const read = () =>
      request(f.app.getHttpServer())
        .get(
          `/v1/${route}?userId=someone-else&username=someone-else&email=other@example.invalid`,
        )
        .set("Cookie", `login_session=${session.raw}`);
    const current = await f.db.user.findUniqueOrThrow({ where: { id } });
    const response = await read();
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.body, {
      message: "Bem-vindo ao Application Foundation.",
      username: f.auth.vault.decrypt(current.username, "username"),
      email: f.auth.vault.decrypt(current.email, "email"),
      accountType,
      mfa: { configured: !!current.totpSecret, verified: current.totpVerified },
    });
    try {
      await f.db.user.update({
        where: { id },
        data: {
          email: f.auth.vault.encrypt("updated@example.invalid", "email"),
        },
      });
      assert.equal((await read()).body.email, "updated@example.invalid");
    } finally {
      await f.db.user.update({ where: { id }, data: { email: current.email } });
    }
    const crossed = await request(f.app.getHttpServer())
      .get(`/v1/${accountType === "master" ? "welcome" : "admin/welcome"}`)
      .set("Cookie", `login_session=${session.raw}`);
    assert.equal(crossed.status, 401);
    assert.deepEqual(crossed.body, { message: INVALID });
    await f.db.session.update({
      where: { digest: digest(session.raw) },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    assert.deepEqual((await read()).body, { message: INVALID });
    assert.equal((await read()).status, 401);
  }
});

test("absent and restricted sessions never receive profile fields", async () => {
  for (const route of ["welcome", "admin/welcome"]) {
    const absent = await request(f.app.getHttpServer()).get(`/v1/${route}`);
    assert.equal(absent.status, 401);
    assert.deepEqual(absent.body, { message: INVALID });
    for (const stage of ["password", "setup", "mfa", "recovery"] as const) {
      const session = await f.work.run((tx) =>
        f.auth.sessions.createSession(tx, masterId, stage),
      );
      const response = await request(f.app.getHttpServer())
        .get(`/v1/${route}`)
        .set("Cookie", `login_session=${session.raw}`);
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { message: INVALID });
    }
  }
});
