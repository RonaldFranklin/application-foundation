import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { auditDetails } from "./audit.helpers";
import { token, digest, totp, totpAdapter } from "../src/infra/security/crypto";
import { ResetCredentials } from "../src/application/auth/use-cases/reset-credentials";
import { AUTH_WORK } from "../src/auth/auth.tokens";
import { UnitOfWork } from "../src/application/auth/ports/repositories";
import { MembersTransaction } from "../src/application/organizations/ports/members.repository";

test(
  "administrative credentials: server scope, mandatory password transition, optional MFA and atomic audit",
  { timeout: 120000 },
  async (t) => {
    const f = await fixture(15460);
    t.after(() => f.close());
    const api = request(f.app.getHttpServer());
    const pwd = "Synthetic unique password original";
    const temporaryPassword = "Temporary account specific credential";
    const password = "Final private password chosen by user";
    const hash = await f.auth.passwords.hash(pwd);
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
    async function user(name: string, platform = false) {
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
          userId,
          digest: digest(raw),
          stage,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return raw;
    }
    const cookie = (r: any) =>
      String(
        r.headers["set-cookie"].find((v: string) =>
          v.startsWith("login_session="),
        ),
      )
        .split(";")[0]
        .slice(14);
    const post = (path: string, body: object, raw = "") =>
      api
        .post(`/v1/${path}`)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .set("Cookie", `login_session=${raw}`)
        .send(body);
    const get = (path: string, raw: string) =>
      api.get(`/v1/${path}`).set("Cookie", `login_session=${raw}`);
    const admin = await user("orgadmin"),
      member = await user("member"),
      otherAdmin = await user("otheradmin"),
      foreign = await user("foreign"),
      delegate = await user("delegate", true);
    const a = await f.db.organization.create({ data: { name: "Scope A" } }),
      b = await f.db.organization.create({ data: { name: "Scope B" } });
    await f.db.organizationMember.createMany({
      data: [
        { organizationId: a.id, userId: admin.id, role: "ORGANIZATION_ADMIN" },
        {
          organizationId: a.id,
          userId: otherAdmin.id,
          role: "ORGANIZATION_ADMIN",
        },
        { organizationId: a.id, userId: member.id },
        { organizationId: b.id, userId: foreign.id },
      ],
    });
    const root = await session(master.id),
      actor = await session(admin.id),
      old = await session(member.id);
    const input = {
      currentPassword: pwd,
      temporaryPassword,
      confirmPassword: temporaryPassword,
    };
    for (const target of [
      admin.id,
      otherAdmin.id,
      foreign.id,
      delegate.id,
      master.id,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]) {
      for (const kind of ["password", "mfa"]) {
        await f.work.run((tx) => f.auth.rates.clear(tx, `profile:${admin.id}`));
        await post(
          `accounts/${target}/${kind}/reset`,
          kind === "password" ? input : { currentPassword: pwd },
          actor,
        ).expect(401);
      }
    }
    await post(`accounts/${member.id}/password/reset`, input, old).expect(401);
    await post(
      `admin/accounts/${member.id}/password/reset`,
      input,
      actor,
    ).expect(401);
    await post(
      `accounts/${member.id}/password/reset`,
      { ...input, organizationId: a.id },
      actor,
    ).expect(400);
    await post(
      `accounts/${member.id}/password/reset`,
      { ...input, temporaryPassword: "short" },
      actor,
    ).expect(400);
    await post(
      `accounts/${member.id}/password/reset`,
      { ...input, confirmPassword: "different" },
      actor,
    ).expect(400);
    await f.work.run((tx) => f.auth.rates.clear(tx, `profile:${admin.id}`));
    await f.db.masterDevice.create({
      data: {
        userId: member.id,
        digest: digest(token()),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const work = f.app.get<UnitOfWork<MembersTransaction>>(AUTH_WORK);
    const broken = new ResetCredentials(
      {
        run: (cb, options) =>
          work.run(
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
      broken.execute(actor, member.id, input, false, "password"),
      /synthetic audit failure/,
    );
    assert.equal(
      (await f.db.user.findUniqueOrThrow({ where: { id: member.id } }))
        .passwordHash,
      hash,
    );
    assert.ok(await f.auth.sessions.authorized(old, false));
    const reset = await post(
      `accounts/${member.id}/password/reset`,
      input,
      actor,
    ).expect(200);
    assert.deepEqual(reset.body, { ok: true });
    const changed = await f.db.user.findUniqueOrThrow({
      where: { id: member.id },
    });
    assert.equal(changed.mustChangePassword, true);
    assert.ok(
      await f.auth.passwords.verify(changed.passwordHash, temporaryPassword),
    );
    assert.equal(await f.db.session.count({ where: { userId: member.id } }), 0);
    assert.equal(
      await f.db.masterDevice.count({ where: { userId: member.id } }),
      0,
    );
    await post("auth/login", { identifier: "member", password: pwd }).expect(
      401,
    );
    const login = await post("auth/login", {
      identifier: "member",
      password: temporaryPassword,
    }).expect(200);
    assert.equal(login.body.stage, "password");
    const restricted = cookie(login);
    for (const path of [
      "welcome",
      `organizations/${a.id}/members`,
      "audit",
      "admin/platform-admins",
    ])
      assert.ok([401, 403].includes((await get(path, restricted)).status));
    await post("auth/mfa/start", {}, restricted).expect(401);
    await post(
      "auth/initial-password",
      { password: temporaryPassword, confirmPassword: temporaryPassword },
      restricted,
    ).expect(401);
    const complete = await post(
      "auth/initial-password",
      { password, confirmPassword: password },
      restricted,
    ).expect(200);
    assert.equal(complete.body.stage, "full");
    await get("welcome", cookie(complete)).expect(200);
    await get("welcome", restricted).expect(401);
    await post("auth/login", {
      identifier: "member",
      password: temporaryPassword,
    }).expect(401);
    // Opt-in enrollment for ordinary accounts uses the existing restricted setup/recovery flow.
    const start = await post("auth/mfa/start", {}, cookie(complete)).expect(
      200,
    );
    const setup = await post("auth/totp/setup", {}, cookie(start)).expect(200);
    const factor = totp(setup.body.secret);
    const enrolled = await post(
      "auth/totp/enroll",
      { code: factor.generate() },
      cookie(start),
    ).expect(200);
    assert.equal(enrolled.body.stage, "recovery");
    await get("welcome", cookie(enrolled)).expect(401);
    const full = await post("auth/confirm", {}, cookie(enrolled)).expect(200);
    assert.equal(
      (await post("auth/login", { identifier: "member", password }).expect(200))
        .body.stage,
      "mfa",
    );
    const mfaReset = await post(
      `admin/accounts/${member.id}/mfa/reset`,
      {
        currentPassword: f.c.MASTER_INITIAL_PASSWORD,
        code: masterTotp.generate(),
      },
      root,
    ).expect(200);
    assert.deepEqual(mfaReset.body, { ok: true });
    assert.equal(
      await f.db.recoveryCode.count({ where: { userId: member.id } }),
      0,
    );
    await get("welcome", cookie(full)).expect(401);
    assert.equal(
      (await post("auth/login", { identifier: "member", password }).expect(200))
        .body.stage,
      "full",
    );
    // A password-only reset preserves an enrolled factor and must not bypass it after password replacement.
    await f.db.user.update({
      where: { id: member.id },
      data: {
        totpSecret: f.auth.vault.encrypt(factor.secret.base32, "totp"),
        totpVerified: true,
        lastTotpStep: -1n,
      },
    });
    await post(`accounts/${member.id}/password/reset`, input, actor).expect(
      200,
    );
    const again = await post("auth/login", {
      identifier: "member",
      password: temporaryPassword,
    }).expect(200);
    const after = await post(
      "auth/initial-password",
      { password, confirmPassword: password },
      cookie(again),
    ).expect(200);
    assert.equal(after.body.stage, "mfa");
    await get("welcome", cookie(after)).expect(401);
    await f.work.run((tx) => f.auth.rates.failure(tx, "master-risk", true));
    const riskBefore = await f.auth.rates.read("master-risk");
    await post("auth/mfa", { code: factor.generate() }, cookie(after)).expect(
      200,
    );
    assert.equal(
      (await f.auth.rates.read("master-risk")).hits.length,
      riskBefore.hits.length,
    );
    await f.work.run((tx) => f.auth.rates.clear(tx, "master-risk"));
    // Master may reset a delegate; the exemption only follows an explicit administrative MFA reset.
    assert.equal(
      (
        await post("admin/auth/login", {
          identifier: "delegate",
          password: pwd,
        }).expect(200)
      ).body.stage,
      "setup",
    );
    await f.db.user.update({
      where: { id: master.id },
      data: { lastTotpStep: -1n },
    });
    const rootBody = {
      currentPassword: f.c.MASTER_INITIAL_PASSWORD,
      code: masterTotp.generate(),
    };
    await post(`admin/accounts/${master.id}/mfa/reset`, rootBody, root).expect(
      401,
    );
    await post(
      `admin/accounts/${master.id}/password/reset`,
      { ...input, ...rootBody },
      root,
    ).expect(401);
    await post(
      `admin/accounts/${delegate.id}/mfa/reset`,
      rootBody,
      root,
    ).expect(200);
    const optional = await post("admin/auth/login", {
      identifier: "delegate",
      password: pwd,
    }).expect(200);
    assert.equal(optional.body.stage, "full");
    await get("admin/welcome", cookie(optional)).expect(200);
    await get("admin/organizations", cookie(optional)).expect(200);
    await post(
      `accounts/${member.id}/mfa/reset`,
      { currentPassword: pwd },
      cookie(optional),
    ).expect(401);
    await f.db.user.update({
      where: { id: master.id },
      data: { lastTotpStep: -1n },
    });
    await post(
      `admin/accounts/${delegate.id}/password/reset`,
      { ...input, ...rootBody },
      root,
    ).expect(200);
    await f.work.run(async (tx) => {
      await f.auth.rates.clear(tx, "master-risk");
      await f.auth.rates.clear(tx, "master-anonymous");
    });
    const tempDelegate = await post("admin/auth/login", {
      identifier: "delegate",
      password: temporaryPassword,
    }).expect(200);
    assert.equal(tempDelegate.body.stage, "password");
    await get("admin/welcome", cookie(tempDelegate)).expect(401);
    const finalDelegate = await post(
      "admin/auth/password",
      { password },
      cookie(tempDelegate),
    ).expect(200);
    assert.equal(finalDelegate.body.stage, "full");
    await assert.rejects(
      f.db.user.update({
        where: { id: master.id },
        data: { mfaEnrollmentOptional: true },
      }),
    );
    const events = await f.db.auditEvent.findMany({
      where: {
        action: { in: ["account.password_reset", "account.mfa_reset"] },
      },
    });
    for (const event of events) {
      const details = auditDetails(event, f.auth.vault);
      assert.deepEqual(details.metadata, {});
      assert.equal(JSON.stringify(details).includes(temporaryPassword), false);
    }
    assert.equal(
      events.filter(
        (e) =>
          e.action === "account.password_reset" &&
          auditDetails(e, f.auth.vault).organizationId === a.id,
      ).length,
      2,
    );
    // Membership changes between requests are authoritative; no organizational IDs are accepted.
    await f.db.organizationMember.update({
      where: {
        organizationId_userId: { organizationId: a.id, userId: member.id },
      },
      data: { role: "ORGANIZATION_ADMIN" },
    });
    await post(
      `accounts/${member.id}/mfa/reset`,
      { currentPassword: pwd },
      actor,
    ).expect(401);
    await f.db.organization.update({
      where: { id: a.id },
      data: { active: false },
    });
    await post(`accounts/${foreign.id}/password/reset`, input, actor).expect(
      401,
    );
  },
);
