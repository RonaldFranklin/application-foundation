import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import request from "supertest";
import { fixture } from "./helpers";
import { auditDetails } from "./audit.helpers";
import { token, digest } from "../src/infra/security/crypto";
import { OrganizationAccess } from "../src/application/organizations/use-cases/organization-access";
import { Members } from "../src/application/organizations/use-cases/members";
import { Invitations } from "../src/application/organization-invitations/invitations";
import {
  InvitationJob,
  InvitationsTransaction,
  invitationContext,
} from "../src/application/organization-invitations/ports";
import { ProtectedInvitationSecrets } from "../src/infra/security/invitation-secrets";
import { AUTH_WORK } from "../src/auth/auth.tokens";
import { UnitOfWork } from "../src/application/auth/ports/repositories";

test(
  "Master alone controls organization administrators, including legacy grants and invitations",
  { timeout: 120000 },
  async (t) => {
    const f = await fixture(15463);
    t.after(() => f.close());
    const work = f.app.get<UnitOfWork<InvitationsTransaction>>(AUTH_WORK);
    const master = await f.db.user.findFirstOrThrow({
      where: { master: true },
    });
    await f.db.user.update({
      where: { id: master.id },
      data: { mustChangePassword: false, totpVerified: true },
    });
    const hash = await f.auth.passwords.hash(
      "Synthetic role security password",
    );
    async function user(name: string) {
      return f.db.user.create({
        data: {
          username: f.auth.vault.encrypt(name, "username"),
          email: f.auth.vault.encrypt(`${name}@example.invalid`, "email"),
          usernameIndex: f.auth.vault.index(name),
          emailIndex: f.auth.vault.index(`${name}@example.invalid`),
          passwordHash: hash,
        },
      });
    }
    async function session(id: string) {
      const raw = token();
      await f.db.session.create({
        data: {
          userId: id,
          digest: digest(raw),
          stage: "full",
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return raw;
    }
    const admin = await user("role-admin"),
      member = await user("role-member"),
      foreign = await user("role-foreign");
    const a = await f.db.organization.create({
        data: { name: "Role scope A" },
      }),
      b = await f.db.organization.create({ data: { name: "Role scope B" } });
    await f.db.organizationMember.createMany({
      data: [
        { organizationId: a.id, userId: admin.id, role: "ORGANIZATION_ADMIN" },
        { organizationId: a.id, userId: member.id },
        { organizationId: b.id, userId: foreign.id },
      ],
    });
    const root = await session(master.id),
      ca = await session(admin.id),
      cm = await session(member.id);
    const post = (path: string, body: object = {}, raw = root) =>
      request(f.app.getHttpServer())
        .post(`/v1/${path}`)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .set("Cookie", `login_session=${raw}`)
        .send(body);
    const base = `organizations/${a.id}`,
      global = `admin/${base}`;
    await post(
      `${base}/permissions`,
      {
        role: "MEMBER",
        permissions: [
          "permissions.manage",
          "members.remove",
          "members.create",
          "members.link",
          "members.read",
        ],
      },
      ca,
    ).expect(200);
    await post(
      `${base}/permissions`,
      { role: "MEMBER", permissions: ["members.roles"] },
      cm,
    ).expect(400);
    // Simulate an upgraded database with a stale grant before cleanup: application must ignore it too.
    await f.db.$executeRawUnsafe(
      'ALTER TABLE "OrganizationPermissionGrant" DROP CONSTRAINT "OrganizationPermissionGrant_no_role_delegation"',
    );
    await f.db.organizationPermissionGrant.create({
      data: { organizationId: a.id, permission: "MEMBERS_ROLES" },
    });
    for (const raw of [ca, cm]) {
      for (const route of [base, base.toUpperCase()]) {
        await post(
          `${route}/members/${member.id}`,
          { role: "ORGANIZATION_ADMIN" },
          raw,
        ).expect(403);
        await post(
          `${route}/members/${admin.id}`,
          { role: "MEMBER" },
          raw,
        ).expect(403);
        await post(`${route}/members/${admin.id}/remove`, {}, raw).expect(403);
        await post(`${route}/members/${admin.id}/restore`, {}, raw).expect(401);
      }
      await post(
        `${global}/members/${member.id}`,
        { role: "ORGANIZATION_ADMIN" },
        raw,
      ).expect(401);
      await post(
        `organizations/${b.id}/members/${foreign.id}/remove`,
        {},
        raw,
      ).expect(403);
    }
    for (const extra of [
      { master: true },
      { userId: master.id },
      { organizationId: b.id },
      { permissions: ["members.roles"] },
    ])
      await post(`${global}/members/${member.id}`, {
        role: "ORGANIZATION_ADMIN",
        ...extra,
      }).expect(400);
    await post(`${global}/members/${foreign.id}`, {
      role: "ORGANIZATION_ADMIN",
    }).expect(404);
    // Only Master may remove the last admin, restore it, demote it and promote a member.
    await post(`${global}/members/${admin.id}/remove`).expect(200);
    await post(`${global}/members/${admin.id}/restore`).expect(200);
    await post(`${global}/members/${admin.id}`, { role: "MEMBER" }).expect(200);
    await post(`${global}/members/${member.id}`, {
      role: "ORGANIZATION_ADMIN",
    }).expect(200);
    await post(`${global}/members/${member.id}`, { role: "MEMBER" }).expect(
      200,
    );
    await post(`${global}/members/${admin.id}`, {
      role: "ORGANIZATION_ADMIN",
    }).expect(200);
    // A mandatory audit failure rolls the role mutation back.
    const broken = new Members(
      new OrganizationAccess(f.auth.sessions, {
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
      }),
      f.auth.vault,
    );
    await assert.rejects(
      broken.update(root, a.id, admin.id, { role: "MEMBER" }),
      /synthetic audit failure/,
    );
    assert.equal(
      (
        await f.db.organizationMember.findUniqueOrThrow({
          where: {
            organizationId_userId: { organizationId: a.id, userId: admin.id },
          },
        })
      ).role,
      "ORGANIZATION_ADMIN",
    );
    const jobs: InvitationJob[] = [];
    let now = Date.now();
    Object.assign(f.app.get(Invitations), {
      publisher: {
        publish: async (job: InvitationJob) => {
          jobs.push(job);
        },
      },
      now: () => now,
    });
    const secrets = new ProtectedInvitationSecrets(f.auth.vault);
    async function envelope() {
      const job = jobs.at(-1)!;
      const i = await f.db.organizationInvitation.findUniqueOrThrow({
        where: { id: job.invitationId },
      });
      return {
        i,
        token: `${i.id}.${secrets.decrypt(job.encryptedToken, invitationContext(i))}`,
      };
    }
    for (const raw of [ca, cm])
      await post(
        `${base}/invitations`,
        { email: "grant@example.invalid", role: "ORGANIZATION_ADMIN" },
        raw,
      ).expect(403);
    await post(`${global}/invitations`, {
      email: "grant@example.invalid",
      role: "ORGANIZATION_ADMIN",
    }).expect(200);
    const invitation = await envelope();
    for (const raw of [ca, cm]) {
      await post(
        `${base}/invitations/${invitation.i.id}/resend`,
        {},
        raw,
      ).expect(403);
      await post(
        `${base}/invitations/${invitation.i.id}/revoke`,
        {},
        raw,
      ).expect(403);
    }
    // Expired admin invitations cannot be overwritten as MEMBER by an ordinary admin.
    now += 8 * 86400000;
    await post(
      `${base}/invitations`,
      { email: "grant@example.invalid", role: "MEMBER" },
      ca,
    ).expect(403);
    await post(`${global}/invitations/${invitation.i.id}/resend`).expect(200);
    const current = await envelope();
    const accept = {
      token: current.token,
      mode: "new",
      username: "granted-admin",
      password: "Synthetic accepted password",
      confirmPassword: "Synthetic accepted password",
    };
    await post("invitations/accept", { ...accept, master: true }, "").expect(
      400,
    );
    await post("invitations/accept", accept, "").expect(200);
    const granted = await f.db.user.findUniqueOrThrow({
      where: { emailIndex: current.i.emailFingerprint },
    });
    assert.equal(
      (
        await f.db.organizationMember.findUniqueOrThrow({
          where: {
            organizationId_userId: { organizationId: a.id, userId: granted.id },
          },
        })
      ).role,
      "ORGANIZATION_ADMIN",
    );
    // A legacy invitation is rejected even before migration revokes it.
    await post(`${global}/invitations`, {
      email: "legacy@example.invalid",
      role: "ORGANIZATION_ADMIN",
    }).expect(200);
    const legacy = await envelope();
    await f.db.organizationInvitation.update({
      where: { id: legacy.i.id },
      data: { createdBy: admin.id },
    });
    await post("invitations/preview", { token: legacy.token }, "").expect(400);
    await post(
      "invitations/accept",
      { ...accept, token: legacy.token, username: "legacy-admin" },
      "",
    ).expect(400);
    // Reapply only the new migration to seeded old state in this disposable database.
    const sql = readFileSync(
      "prisma/migrations/202610170001_master_organization_admin/migration.sql",
      "utf8",
    );
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await f.db.$executeRawUnsafe(statement);
    assert.equal(
      await f.db.organizationPermissionGrant.count({
        where: { permission: "MEMBERS_ROLES" },
      }),
      0,
    );
    assert.ok(
      await f.db.organizationPermissionGrant.findFirst({
        where: { permission: "PERMISSIONS_MANAGE" },
      }),
    );
    assert.ok(
      (
        await f.db.organizationInvitation.findUniqueOrThrow({
          where: { id: legacy.i.id },
        })
      ).revokedAt,
    );
    await assert.rejects(
      f.db.organizationPermissionGrant.create({
        data: { organizationId: a.id, permission: "MEMBERS_ROLES" },
      }),
    );
    // Concurrent issue/demotion cannot transfer Master authority to the ordinary actor.
    const race = await Promise.all([
      post(`${global}/members/${admin.id}`, { role: "MEMBER" }),
      post(
        `${base}/invitations`,
        { email: "race@example.invalid", role: "ORGANIZATION_ADMIN" },
        ca,
      ),
    ]);
    assert.deepEqual(
      race.map((r) => r.status),
      [200, 403],
    );
    await post(`${global}/invitations`, {
      email: "revocation-race@example.invalid",
      role: "ORGANIZATION_ADMIN",
    }).expect(200);
    const revocable = await envelope();
    const competing = await Promise.all([
      post(`${global}/invitations/${revocable.i.id}/revoke`),
      post(
        "invitations/accept",
        { ...accept, token: revocable.token, username: "race-admin" },
        "",
      ),
    ]);
    const final = await f.db.organizationInvitation.findUniqueOrThrow({
      where: { id: revocable.i.id },
    });
    assert.ok(Boolean(final.revokedAt) !== Boolean(final.acceptedAt));
    assert.deepEqual(competing.map((r) => r.status).sort(), [200, 400]);
    const events = await f.db.auditEvent.findMany({
      where: {
        action: {
          in: [
            "member.role_changed",
            "member.removed",
            "member.restored",
            "member.added",
          ],
        },
      },
    });
    for (const event of events) {
      const detail = auditDetails(event, f.auth.vault);
      assert.equal(detail.actorId, master.id);
      assert.equal(detail.organizationId, a.id);
      assert.ok(detail.resourceId);
      assert.equal(JSON.stringify(detail).includes("password"), false);
      assert.equal(JSON.stringify(detail).includes(current.token), false);
    }
  },
);
