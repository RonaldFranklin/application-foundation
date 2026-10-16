import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { auditDetails } from "./audit.helpers";
import { ResetMfa } from "../src/application/auth/use-cases/reset-mfa";
import { token, digest, totp, totpAdapter } from "../src/infra/security/crypto";

test(
  "completed login projection and Master MFA reset: authorization, revocation, rollback and concurrency",
  { timeout: 120000 },
  async (t) => {
    const f = await fixture(15458);
    t.after(() => f.close());
    const master = await f.db.user.findFirstOrThrow({
      where: { master: true },
    });
    const masterTotp = totp();
    await f.db.user.update({
      where: { id: master.id },
      data: {
        mustChangePassword: false,
        totpVerified: true,
        totpSecret: f.auth.vault.encrypt(masterTotp.secret.base32, "totp"),
      },
    });
    const pwd = "Synthetic member security password";
    const hash = await f.auth.passwords.hash(pwd);
    async function account(name: string, platform = false) {
      return f.db.user.create({
        data: {
          username: f.auth.vault.encrypt(name, "username"),
          email: f.auth.vault.encrypt(`${name}@example.invalid`, "email"),
          usernameIndex: f.auth.vault.index(name),
          emailIndex: f.auth.vault.index(`${name}@example.invalid`),
          passwordHash: hash,
          mustChangePassword: false,
          ...(platform
            ? {
                platformAdmin: {
                  create: { permissions: ["organizations.read"] },
                },
              }
            : {}),
        },
      });
    }
    async function session(userId: string, stage = "full") {
      const raw = token();
      await f.db.session.create({
        data: {
          digest: digest(raw),
          userId,
          stage,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return raw;
    }
    const root = await session(master.id),
      member = await account("member"),
      admin = await account("orgadmin"),
      delegate = await account("delegate", true);
    const api = request(f.app.getHttpServer());
    const post = (path: string, body: object, raw = root) =>
      api
        .post(`/v1/${path}`)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .set("Cookie", `login_session=${raw}`)
        .send(body);
    const get = (path: string, raw = root) =>
      api.get(`/v1/${path}`).set("Cookie", `login_session=${raw}`);
    const cookie = (r: { headers: Record<string, unknown> }) =>
      String(
        (r.headers["set-cookie"] as string[]).find((v) =>
          v.startsWith("login_session="),
        ),
      )
        .split(";")[0]
        .slice(14);
    const read = (id: string) => f.db.user.findUniqueOrThrow({ where: { id } });
    const a = await f.db.organization.create({
        data: { name: "Authorized organization" },
      }),
      b = await f.db.organization.create({
        data: { name: "Other organization" },
      });
    await f.db.organizationMember.createMany({
      data: [
        { organizationId: a.id, userId: admin.id, role: "ORGANIZATION_ADMIN" },
        { organizationId: a.id, userId: member.id },
      ],
    });
    const common = await session(member.id),
      orgadmin = await session(admin.id);
    const list = await get(`organizations/${a.id}/members`, orgadmin).expect(
      200,
    );
    assert.deepEqual(list.body.items[0].organization, {
      id: a.id,
      name: a.name,
    });
    assert.deepEqual(
      Object.keys(list.body.items[0]).sort(),
      [
        "userId",
        "username",
        "email",
        "role",
        "createdAt",
        "deletedAt",
        "organization",
        "mfa",
        "lastLoginAt",
      ].sort(),
    );
    assert.deepEqual(list.body.items[0].mfa, {
      configured: false,
      verified: false,
    });
    assert.equal(list.body.items[0].lastLoginAt, null);
    await get(`organizations/${b.id}/members`, orgadmin).expect(403);
    await post(
      "auth/login",
      { identifier: "member", password: "incorrect" },
      "",
    ).expect(401);
    assert.equal((await read(member.id)).lastLoginAt, null);
    await post(
      "auth/login",
      { identifier: "member", password: pwd },
      "",
    ).expect(200);
    const last = (await read(member.id)).lastLoginAt!;
    assert.ok(last);
    // Existing account lock + monotonic maximum also handles clock corrections.
    const future = new Date(Date.now() + 60000);
    await f.db.user.update({
      where: { id: member.id },
      data: { lastLoginAt: future },
    });
    await post(
      "auth/login",
      { identifier: "member", password: pwd },
      "",
    ).expect(200);
    assert.equal(+(await read(member.id)).lastLoginAt!, +future);
    const login = await post(
      "admin/auth/login",
      { identifier: "delegate", password: pwd },
      "",
    ).expect(200);
    assert.equal(login.body.stage, "setup");
    assert.equal((await read(delegate.id)).lastLoginAt, null);
    const restricted = cookie(login);
    const setup = await post("admin/auth/totp/setup", {}, restricted).expect(
      200,
    );
    assert.equal((await read(delegate.id)).lastLoginAt, null);
    await post(
      "admin/auth/totp/enroll",
      { code: "invalid" },
      restricted,
    ).expect(401);
    const enrolled = await post(
      "admin/auth/totp/enroll",
      { code: totp(setup.body.secret).generate() },
      restricted,
    ).expect(200);
    assert.equal((await read(delegate.id)).lastLoginAt, null);
    const full = await post("admin/auth/confirm", {}, cookie(enrolled)).expect(
      200,
    );
    const delegated = cookie(full);
    const delegatedLast = (await read(delegate.id)).lastLoginAt!;
    assert.ok(delegatedLast);
    const path = `admin/accounts/${delegate.id}/mfa/reset`;
    const body = () => ({
      currentPassword: f.c.MASTER_INITIAL_PASSWORD,
      code: masterTotp.generate(),
    });
    for (const raw of [
      common,
      orgadmin,
      delegated,
      await session(master.id, "mfa"),
      "",
    ])
      await post(path, body(), raw).expect(401);
    await post(`admin/accounts/${master.id}/mfa/reset`, body()).expect(401);
    const failed = await post(path, {
      ...body(),
      currentPassword: "incorrect",
    }).expect(401);
    assert.equal(failed.body.code, "REAUTHENTICATION_FAILED");
    const invalid = await post(path, { ...body(), code: "000000" }).expect(401);
    assert.equal(invalid.body.code, "MFA_INVALID");
    await f.work.run((tx) => f.auth.rates.clear(tx, `profile:${master.id}`));
    // A failing mandatory audit must roll back factors, replay state, sessions and codes.
    const broken = new ResetMfa(
      {
        run: (cb, options) =>
          f.work.run(
            (tx) =>
              cb({
                ...tx,
                audit: {
                  ...tx.audit,
                  append: async () => {
                    throw new Error("synthetic audit failure");
                  },
                },
              }),
            options,
          ),
      },
      f.auth.sessions,
      f.auth.passwords,
      f.auth.vault,
      totpAdapter,
      f.auth.rates,
    );
    await assert.rejects(
      broken.execute(root, delegate.id, body()),
      /synthetic audit failure/,
    );
    assert.equal((await read(delegate.id)).totpVerified, true);
    assert.ok(await f.auth.sessions.authorized(delegated, undefined));
    assert.equal(
      await f.db.recoveryCode.count({ where: { userId: delegate.id } }),
      10,
    );
    assert.equal((await read(master.id)).lastTotpStep, -1n);
    await f.work.run((tx) => f.auth.rates.clear(tx, `profile:${master.id}`));
    const results = await Promise.all([post(path, body()), post(path, body())]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
    const reset = await read(delegate.id);
    assert.equal(reset.totpSecret, null);
    assert.equal(reset.totpVerified, false);
    assert.equal(reset.lastTotpStep, -1n);
    assert.equal(reset.passwordHash, hash);
    assert.equal(+reset.lastLoginAt!, +delegatedLast);
    assert.equal(
      await f.db.session.count({ where: { userId: delegate.id } }),
      0,
    );
    assert.equal(
      await f.db.masterDevice.count({ where: { userId: delegate.id } }),
      0,
    );
    assert.equal(
      await f.db.recoveryCode.count({ where: { userId: delegate.id } }),
      0,
    );
    await get("admin/welcome", delegated).expect(401);
    await post(
      "admin/auth/mfa",
      { code: enrolled.body.recoveryCodes[0] },
      delegated,
    ).expect(401);
    const again = await post(
      "admin/auth/login",
      { identifier: "delegate", password: pwd },
      "",
    ).expect(200);
    assert.equal(again.body.stage, "setup");
    await get("admin/welcome", cookie(again)).expect(401);
    await post("admin/auth/confirm", {}, cookie(again)).expect(401);
    assert.equal(+(await read(delegate.id)).lastLoginAt!, +delegatedLast);
    // Fresh setup and enrollment still cannot enter administration until confirmation.
    const nextSetup = await post(
      "admin/auth/totp/setup",
      {},
      cookie(again),
    ).expect(200);
    assert.notEqual(nextSetup.body.secret, setup.body.secret);
    const nextEnroll = await post(
      "admin/auth/totp/enroll",
      { code: totp(nextSetup.body.secret).generate() },
      cookie(again),
    ).expect(200);
    await get("admin/welcome", cookie(nextEnroll)).expect(401);
    assert.equal(+(await read(delegate.id)).lastLoginAt!, +delegatedLast);
    const nextFull = await post(
      "admin/auth/confirm",
      {},
      cookie(nextEnroll),
    ).expect(200);
    await get("admin/welcome", cookie(nextFull)).expect(200);
    assert.ok(+(await read(delegate.id)).lastLoginAt! >= +delegatedLast);
    const events = await f.db.auditEvent.findMany({
      where: { action: "account.mfa_reset" },
    });
    assert.equal(events.length, 1);
    const details = auditDetails(events[0], f.auth.vault);
    assert.equal(details.actorId, master.id);
    assert.equal(details.resourceId, delegate.id);
    assert.deepEqual(details.metadata, {});
    // Common organization accounts keep their role, identity and password policy.
    await post(`admin/accounts/${member.id}/mfa/reset`, {
      currentPassword: f.c.MASTER_INITIAL_PASSWORD,
      code: masterTotp.generate({ timestamp: Date.now() + 30000 }),
    }).expect(200);
    const commonReset = await read(member.id);
    assert.equal(commonReset.passwordHash, member.passwordHash);
    assert.equal(commonReset.email, member.email);
    assert.equal(commonReset.mustChangePassword, false);
    assert.equal(await f.db.session.count({ where: { userId: member.id } }), 0);
    assert.equal(
      await f.db.organizationMember.count({
        where: { userId: member.id, organizationId: a.id, role: "MEMBER" },
      }),
      1,
    );
  },
);
