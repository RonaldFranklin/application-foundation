import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { auditDetails } from "./audit.helpers";
import { PlatformAdmins } from "../src/application/platform-admin/platform-admins";
import {
  PlatformTransaction,
  platformContext,
} from "../src/application/platform-admin/ports";
import { DeliverPlatformInvitation } from "../src/application/platform-admin/deliver-platform-invitation";
import { UnitOfWork } from "../src/application/auth/ports/repositories";
import { InvitationJob } from "../src/application/organization-invitations/ports";
import { ProtectedInvitationSecrets } from "../src/infra/security/invitation-secrets";
import { AUTH_WORK } from "../src/auth/auth.tokens";
import { digest, token, totp } from "../src/infra/security/crypto";
import { platformPermissionKeys } from "../src/application/platform-admin/permissions";

test(
  "platform administrators: invitation, MFA, explicit authorization, isolation, revocation and races",
  { timeout: 120000 },
  async (t) => {
    const f = await fixture(15457);
    t.after(() => f.close());
    const work = f.app.get<UnitOfWork<PlatformTransaction>>(AUTH_WORK);
    const service = f.app.get(PlatformAdmins);
    const secrets = new ProtectedInvitationSecrets(
      f.auth.vault,
      "platform-admin-invitation.v1",
    );
    const jobs: InvitationJob[] = [];
    let now = Date.now();
    let unavailable = false;
    Object.assign(service, {
      publisher: {
        async publish(job: InvitationJob) {
          jobs.push(job);
          if (unavailable) throw new Error("PRIVATE_QUEUE_DETAIL");
        },
      },
      now: () => now,
    });
    const master = await f.db.user.findFirstOrThrow({
      where: { master: true },
    });
    await f.db.user.update({
      where: { id: master.id },
      data: { mustChangePassword: false, totpVerified: true },
    });
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
    const root = await session(master.id);
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
        .slice("login_session=".length);
    const pwd = "Synthetic platform password 2026";
    async function invite(email: string, permissions: string[] = []) {
      await post("admin/platform-admins/invitations", {
        email,
        permissions,
      }).expect(200);
      const job = jobs.at(-1)!;
      const i = await f.db.platformAdminInvitation.findUniqueOrThrow({
        where: { id: job.invitationId },
      });
      return {
        i,
        job,
        raw: `${i.id}.${secrets.decrypt(job.encryptedToken, platformContext(i))}`,
      };
    }
    const duplicates = await Promise.all([
      post("admin/platform-admins/invitations", {
        email: "duplicate@example.invalid",
        permissions: [],
      }),
      post("admin/platform-admins/invitations", {
        email: "duplicate@example.invalid",
        permissions: [],
      }),
    ]);
    assert.deepEqual(duplicates.map((r) => r.status).sort(), [200, 409]);
    const created = await invite("delegate@example.invalid");
    const body = {
      token: created.raw,
      username: "delegate",
      password: pwd,
      confirmPassword: pwd,
    };
    await post("platform-admin-invitations/accept", {
      ...body,
      master: true,
    }).expect(400);
    const accepts = await Promise.all([
      post("platform-admin-invitations/accept", body),
      post("platform-admin-invitations/accept", body),
    ]);
    assert.deepEqual(accepts.map((r) => r.status).sort(), [200, 400]);
    assert.equal(
      accepts.find((r) => r.status === 200)!.headers["set-cookie"],
      undefined,
    );
    const delegate = await f.db.user.findUniqueOrThrow({
      where: { emailIndex: f.auth.vault.index("delegate@example.invalid") },
      include: { platformAdmin: true, memberships: true },
    });
    assert.equal(delegate.master, false);
    assert.equal(delegate.memberships.length, 0);
    assert.deepEqual(delegate.platformAdmin!.permissions, []);
    assert.equal(delegate.totpVerified, false);
    await post(
      "auth/login",
      { identifier: "delegate@example.invalid", password: pwd },
      "",
    ).expect(401);
    let response = await post(
      "admin/auth/login",
      { identifier: "delegate@example.invalid", password: pwd },
      "",
    ).expect(200);
    assert.equal(response.body.stage, "setup");
    let raw = cookie(response);
    await get("admin/welcome", raw).expect(401);
    await get("admin/platform-admins", raw).expect(403);
    response = await post("admin/auth/totp/setup", {}, raw).expect(200);
    const secret = response.body.secret;
    response = await post(
      "admin/auth/totp/enroll",
      { code: totp(secret).generate() },
      raw,
    ).expect(200);
    assert.equal(response.body.stage, "recovery");
    const recovery = response.body.recoveryCodes[0];
    raw = cookie(response);
    await get("admin/welcome", raw).expect(401);
    response = await post("admin/auth/confirm", {}, raw).expect(200);
    raw = cookie(response);
    response = await get("admin/welcome", raw).expect(200);
    assert.equal(response.body.accountType, "platform-admin");
    assert.deepEqual(response.body.platformPermissions, []);
    assert.equal((await get("auth/session", raw)).body.master, false);
    assert.equal((await get("auth/session", raw)).body.administrative, true);
    await get("welcome", raw).expect(401);
    await get("organizations", raw).expect(401);
    await get("admin/organizations", raw).expect(401);
    await get("admin/audit", raw).expect(401);
    await get(`admin/audit/${randomUUID()}`, raw).expect(401);
    await get("admin/platform-admins", raw).expect(403);
    await post(
      "admin/platform-admins/invitations",
      { email: "escalate@example.invalid", permissions: ["audit.read"] },
      raw,
    ).expect(403);
    await post(
      `admin/platform-admins/${delegate.id}`,
      { active: true, permissions: platformPermissionKeys },
      raw,
    ).expect(403);
    await post(`admin/platform-admins/${master.id}`, {
      active: false,
      permissions: [],
    }).expect(403);
    await post(`admin/platform-admins/${delegate.id}`, {
      active: true,
      permissions: ["master"],
    }).expect(400);
    const org = (
      await post("admin/organizations", { name: "Platform scope" }).expect(200)
    ).body;
    async function grant(perms: string[], active = true) {
      await post(`admin/platform-admins/${delegate.id}`, {
        active,
        permissions: perms,
      }).expect(200);
      assert.equal(
        await f.db.session.count({ where: { userId: delegate.id } }),
        0,
      );
      raw = await session(delegate.id);
    }
    await grant(["organizations.read"]);
    await get("admin/organizations", raw).expect(200);
    await get(`admin/organizations/${org.id}`, raw).expect(200);
    await post("admin/organizations", { name: "Denied" }, raw).expect(401);
    await post(`admin/organizations/${org.id}`, { name: "Denied" }, raw).expect(
      403,
    );
    await post(`admin/organizations/${org.id}`, { active: false }, raw).expect(
      403,
    );
    await get(`admin/organizations/${org.id}/members`, raw).expect(403);
    await get(`admin/organizations/${org.id}/permissions`, raw).expect(403);
    await get(`admin/organizations/${org.id}/invitations`, raw).expect(403);
    await grant(["organizations.create"]);
    await post("organizations", { name: "Wrong namespace" }, raw).expect(401);
    await post("admin/organizations", { name: "Explicit create" }, raw).expect(
      200,
    );
    await get("admin/organizations", raw).expect(401);
    await grant(["organizations.update"]);
    await post(
      `admin/organizations/${org.id}`,
      { name: "Updated" },
      raw,
    ).expect(200);
    await post(
      `admin/organizations/${org.id}`,
      { name: "No partial write", active: false },
      raw,
    ).expect(403);
    assert.equal(
      (await f.db.organization.findUniqueOrThrow({ where: { id: org.id } }))
        .name,
      "Updated",
    );
    await grant(["organizations.status"]);
    await post(`admin/organizations/${org.id}`, { active: false }, raw).expect(
      200,
    );
    await post(`admin/organizations/${org.id}`, { active: true }, raw).expect(
      200,
    );
    await grant(["organizations.delete"]);
    await post(`organizations/${org.id}/remove`, {}, raw).expect(401);
    await post(`admin/organizations/${org.id}/remove`, {}, raw).expect(200);
    await post(`admin/organizations/${org.id}/restore`, {}, raw).expect(200);
    await grant(["audit.read"]);
    const audit = await get("admin/audit", raw).expect(200);
    await get(`admin/audit/${audit.body.items[0].id}`, raw).expect(200);
    await get("admin/organizations", raw).expect(401);
    const stale = raw;
    await grant([]);
    await get("admin/audit", stale).expect(401);
    await get("admin/audit", raw).expect(401);
    await grant(["audit.read"], false);
    await get("admin/welcome", raw).expect(401);
    await post(
      "admin/auth/login",
      { identifier: "delegate@example.invalid", password: pwd },
      "",
    ).expect(401);
    await grant(["audit.read", "organizations.read"]);
    // All global authorization holds the same lock as grants; a waiting request re-reads revoked sessions.
    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((r) => (locked = r));
    const gate = new Promise<void>((r) => (release = r));
    const revoke = work.run(async (tx) => {
      await tx.lock("platform-access");
      locked();
      await gate;
      await tx.lock(`account:${delegate.id}`);
      await tx.platformAdmins.save(delegate.id, true, []);
      await tx.sessions.deleteForUser(delegate.id);
    });
    await acquired;
    const waiting = get("admin/audit", raw).then((r) => r.status);
    const waitingOrganization = get(`admin/organizations/${org.id}`, raw).then(
      (r) => r.status,
    );
    release();
    await revoke;
    assert.equal(await waiting, 401);
    assert.equal(await waitingOrganization, 401);
    // Recovery login uses the same MFA flow after restored eligibility.
    await f.db.rateState.deleteMany();
    response = await post(
      "admin/auth/login",
      { identifier: "delegate@example.invalid", password: pwd },
      "",
    ).expect(200);
    assert.equal(response.body.stage, "mfa");
    raw = cookie(response);
    response = await post("admin/auth/mfa", { code: recovery }, raw).expect(
      200,
    );
    raw = cookie(response);
    await get("admin/welcome", raw).expect(200);
    // Organization accounts cannot be converted, nor attached to platform identities (even by direct persistence).
    const common = await f.db.user.create({
      data: {
        username: "cipher",
        email: "cipher",
        usernameIndex: "common-platform-test",
        emailIndex: f.auth.vault.index("common@example.invalid"),
        passwordHash: "unused",
      },
    });
    await f.db.organizationMember.create({
      data: {
        userId: common.id,
        organizationId: org.id,
        role: "ORGANIZATION_ADMIN",
      },
    });
    const commonSession = await session(common.id);
    await get("admin/platform-admins", commonSession).expect(403);
    await get("admin/organizations", commonSession).expect(401);
    await post("admin/platform-admins/invitations", {
      email: "common@example.invalid",
      permissions: [],
    }).expect(409);
    await assert.rejects(
      f.db.platformAdmin.create({
        data: { userId: common.id, permissions: [] },
      }),
    );
    await assert.rejects(
      f.db.organizationMember.create({
        data: { userId: delegate.id, organizationId: org.id },
      }),
    );
    await assert.rejects(
      f.db.user.update({ where: { id: delegate.id }, data: { master: true } }),
    );
    // Expiry, resend, revocation, budgets, protected delivery and failure compensation.
    const pending = await invite("pending@example.invalid", [
      "organizations.read",
    ]);
    await post("admin/platform-admins/invitations", {
      email: "pending@example.invalid",
      permissions: [],
    }).expect(409);
    await post(
      `admin/platform-admins/invitations/${pending.i.id}/resend`,
      {},
    ).expect(429);
    now += 61000;
    await post(
      `admin/platform-admins/invitations/${pending.i.id}/resend`,
      {},
    ).expect(200);
    await post("platform-admin-invitations/accept", {
      ...body,
      token: pending.raw,
      username: "pending",
    }).expect(400);
    let sent = 0;
    const deliver = new DeliverPlatformInvitation(
      work,
      secrets,
      f.auth.vault,
      {
        async send(message) {
          sent++;
          assert.match(message.text, /\/admin\/invitations\/accept#token=/);
          assert.equal(message.to, "pending@example.invalid");
          return { accepted: true };
        },
      },
      f.c.FRONTEND_ORIGIN,
    );
    assert.deepEqual(await deliver.execute(pending.job), { ignored: true });
    assert.equal(sent, 0);
    assert.deepEqual(await deliver.execute(jobs.at(-1)), { accepted: true });
    assert.deepEqual(await deliver.execute(jobs.at(-1)), { ignored: true });
    assert.equal(sent, 1);
    await post(
      `admin/platform-admins/invitations/${pending.i.id}/revoke`,
      {},
    ).expect(200);
    const expired = await invite("expired@example.invalid");
    now += 8 * 86400000;
    const expiredResult = await post("platform-admin-invitations/accept", {
      ...body,
      token: expired.raw,
      username: "expired",
    }).expect(400);
    assert.equal(expiredResult.body.code, "INVITATION_EXPIRED");
    const guessed = await invite("guesses@example.invalid");
    for (let n = 0; n < 10; n++)
      await post("platform-admin-invitations/accept", {
        ...body,
        token: `${guessed.i.id}.${token()}`,
        username: "guesses",
      }).expect(400);
    await post("platform-admin-invitations/accept", {
      ...body,
      token: guessed.raw,
      username: "guesses",
    }).expect(400);
    unavailable = true;
    await post("admin/platform-admins/invitations", {
      email: "queue-fail@example.invalid",
      permissions: [],
    }).expect(503);
    assert.ok(
      (
        await f.db.platformAdminInvitation.findUniqueOrThrow({
          where: { id: jobs.at(-1)!.invitationId },
        })
      ).revokedAt,
    );
    unavailable = false;
    // Administrative writes roll back when mandatory audit cannot persist.
    const before = await f.db.platformAdmin.findUniqueOrThrow({
      where: { userId: delegate.id },
    });
    const failingWork: UnitOfWork<PlatformTransaction> = {
      run: (action) =>
        work.run((tx) =>
          action({
            ...tx,
            audit: {
              ...tx.audit,
              append: async () => {
                throw new Error("synthetic audit failure");
              },
              bestEffort: async () => {},
            },
          }),
        ),
    };
    const failing = new PlatformAdmins(
      failingWork,
      f.auth.sessions,
      f.auth.vault,
      f.auth.passwords,
      secrets,
      { publish: async () => {} },
    );
    await assert.rejects(
      failing.change(root, delegate.id, {
        active: false,
        permissions: ["audit.read"],
      }),
    );
    assert.deepEqual(
      await f.db.platformAdmin.findUniqueOrThrow({
        where: { userId: delegate.id },
      }),
      before,
    );
    const rows = await f.db.auditEvent.findMany();
    for (const row of rows) {
      const details = JSON.stringify(auditDetails(row, f.auth.vault));
      for (const secretValue of [
        pwd,
        created.raw,
        created.i.digest,
        "delegate@example.invalid",
        secret,
      ])
        assert.equal(details.includes(secretValue), false);
    }
    assert.ok(
      rows.some((r) => r.action === "platform_admin.permissions_changed"),
    );
    const list = await get(
      "admin/platform-admins?status=active&search=delegate",
    ).expect(200);
    assert.equal(list.body.items.length, 1);
    assert.equal("digest" in list.body.items[0], false);
  },
);
