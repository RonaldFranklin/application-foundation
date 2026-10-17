import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { auditDetails } from "./audit.helpers";
import { token, digest } from "../src/infra/security/crypto";
import { PlatformRoles } from "../src/application/platform-admin/platform-roles";
import { PlatformAdmins } from "../src/application/platform-admin/platform-admins";
import {
  PlatformTransaction,
  platformContext,
} from "../src/application/platform-admin/ports";
import { UnitOfWork } from "../src/application/auth/ports/repositories";
import { AUTH_WORK } from "../src/auth/auth.tokens";
import { InvitationJob } from "../src/application/organization-invitations/ports";
import { ProtectedInvitationSecrets } from "../src/infra/security/invitation-secrets";

test(
  "platform roles preserve legacy grants, enforce Master authority, resolve invitations, revoke sessions and audit atomically",
  { timeout: 120000 },
  async (t) => {
    const f = await fixture(15459);
    t.after(() => f.close());
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
        .post(`/v1/admin/platform-admins${path}`)
        .set("Cookie", `login_session=${raw}`)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .send(body);
    const get = (path: string, raw = root) =>
      api
        .get(`/v1/admin/platform-admins${path}`)
        .set("Cookie", `login_session=${raw}`);
    const hash = await f.auth.passwords.hash(
      "Synthetic platform role password",
    );
    async function account(name: string, platform: boolean) {
      return f.db.user.create({
        data: {
          username: f.auth.vault.encrypt(name, "username"),
          email: f.auth.vault.encrypt(`${name}@example.invalid`, "email"),
          usernameIndex: f.auth.vault.index(name),
          emailIndex: f.auth.vault.index(`${name}@example.invalid`),
          passwordHash: hash,
          mustChangePassword: false,
          totpVerified: platform,
          ...(platform
            ? { platformAdmin: { create: { permissions: ["audit.read"] } } }
            : {}),
        },
      });
    }
    const delegate = await account("delegate", true),
      common = await account("member", false),
      orgadmin = await account("orgadmin", false);
    const org = await f.db.organization.create({
      data: { name: "Existing organization" },
    });
    await f.db.organizationMember.create({
      data: {
        userId: orgadmin.id,
        organizationId: org.id,
        role: "ORGANIZATION_ADMIN",
      },
    });
    assert.deepEqual((await get("/roles").expect(200)).body.roles, []);
    assert.deepEqual(
      (
        await f.db.platformAdmin.findUniqueOrThrow({
          where: { userId: delegate.id },
        })
      ).permissions,
      ["audit.read"],
    );
    for (const raw of [
      await session(delegate.id),
      await session(common.id),
      await session(orgadmin.id),
      await session(master.id, "mfa"),
      "",
    ]) {
      await get("/roles", raw).expect(403);
      await post("/roles", { name: "Forbidden", permissions: [] }, raw).expect(
        403,
      );
      await post(`/${delegate.id}/role`, { roleId: null }, raw).expect(403);
      await post(
        `/roles/${org.id}`,
        { name: "Forbidden", permissions: [], version: 1 },
        raw,
      ).expect(403);
      await post(`/roles/${org.id}/remove`, { version: 1 }, raw).expect(403);
      await post(`/invitations/${org.id}/role`, { roleId: null }, raw).expect(
        403,
      );
    }
    for (const body of [
      { name: "MASTER", permissions: [] },
      { name: "Invalid", permissions: ["members.roles"] },
      { name: "Invalid", permissions: ["audit.read", "audit.read"] },
      { name: "Invalid", permissions: [], master: true },
    ])
      await post("/roles", body).expect(400);
    await post("/roles", {
      name: "Operação",
      permissions: ["organizations.read"],
    }).expect(200);
    await post("/roles", { name: " operação ", permissions: [] }).expect(409);
    let role = (await get("/roles")).body.roles[0];
    assert.deepEqual(Object.keys(role).sort(), [
      "id",
      "name",
      "permissions",
      "version",
    ]);
    await post(`/${master.id}/role`, { roleId: role.id }).expect(403);
    await post(`/${orgadmin.id}/role`, { roleId: role.id }).expect(403);
    await post(`/${delegate.id}/role`, { roleId: org.id }).expect(409);
    const old = await session(delegate.id);
    await f.db.masterDevice.create({
      data: {
        digest: digest(token()),
        userId: delegate.id,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await post(`/${delegate.id}/role`, { roleId: role.id }).expect(200);
    assert.equal(await f.auth.sessions.session(old), null);
    assert.equal(
      await f.db.masterDevice.count({ where: { userId: delegate.id } }),
      0,
    );
    assert.equal(
      (
        await f.db.platformAdmin.findUniqueOrThrow({
          where: { userId: delegate.id },
        })
      ).roleId,
      role.id,
    );
    // Legacy state/grant payloads cannot override the role's authoritative permissions.
    await post(`/${delegate.id}`, {
      active: true,
      permissions: ["audit.read"],
    }).expect(200);
    assert.deepEqual(
      (
        await f.db.platformAdmin.findUniqueOrThrow({
          where: { userId: delegate.id },
        })
      ).permissions,
      ["organizations.read"],
    );
    const jobs: InvitationJob[] = [];
    Object.assign(f.app.get(PlatformAdmins), {
      publisher: {
        async publish(job: InvitationJob) {
          jobs.push(job);
        },
      },
    });
    await post("/invitations", {
      email: "role-invite@example.invalid",
      roleId: role.id,
    }).expect(200);
    const invitation = await f.db.platformAdminInvitation.findUniqueOrThrow({
      where: { id: jobs.at(-1)!.invitationId },
    });
    assert.equal(invitation.roleId, role.id);
    await post("/invitations", {
      email: "bad@example.invalid",
      roleId: role.id,
      permissions: [],
    }).expect(400);
    await post("/invitations", {
      email: "bad@example.invalid",
      roleId: org.id,
    }).expect(409);
    await post(`/roles/${role.id}/remove`, { version: role.version }).expect(
      409,
    );
    const active = await session(delegate.id);
    const work = f.app.get<UnitOfWork<PlatformTransaction>>(AUTH_WORK);
    const broken = new PlatformRoles(
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
    );
    await assert.rejects(
      broken.save(
        root,
        { name: role.name, permissions: [], version: role.version },
        role.id,
      ),
      /synthetic audit failure/,
    );
    assert.ok(await f.auth.sessions.session(active));
    assert.deepEqual(
      (
        await f.db.platformAdminInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).permissions,
      ["organizations.read"],
    );
    const simultaneous = await Promise.all([
      post(`/roles/${role.id}`, {
        name: role.name,
        permissions: ["audit.read"],
        version: role.version,
      }),
      post(`/roles/${role.id}`, {
        name: role.name,
        permissions: [],
        version: role.version,
      }),
    ]);
    assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 409]);
    role = (await get("/roles")).body.roles[0];
    assert.equal(await f.auth.sessions.session(active), null);
    assert.deepEqual(
      (
        await f.db.platformAdmin.findUniqueOrThrow({
          where: { userId: delegate.id },
        })
      ).permissions,
      role.permissions,
    );
    assert.deepEqual(
      (
        await f.db.platformAdminInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).permissions,
      role.permissions,
    );
    const secrets = new ProtectedInvitationSecrets(
      f.auth.vault,
      "platform-admin-invitation.v1",
    );
    const raw = secrets.decrypt(
      jobs[0].encryptedToken,
      platformContext(invitation),
    );
    await api
      .post("/v1/platform-admin-invitations/accept")
      .set("Origin", f.c.FRONTEND_ORIGIN)
      .send({
        token: `${invitation.id}.${raw}`,
        username: "role-invite",
        password: "Synthetic role invitation password",
        confirmPassword: "Synthetic role invitation password",
      })
      .expect(200);
    const accepted = await f.db.user.findUniqueOrThrow({
      where: { usernameIndex: f.auth.vault.index("role-invite") },
      include: { platformAdmin: true },
    });
    assert.equal(accepted.master, false);
    assert.equal(accepted.totpVerified, false);
    assert.equal(accepted.platformAdmin!.roleId, role.id);
    assert.deepEqual(accepted.platformAdmin!.permissions, role.permissions);
    await post(`/invitations/${invitation.id}/role`, { roleId: null }).expect(
      403,
    );
    await post("/invitations", {
      email: "legacy-invite@example.invalid",
      permissions: ["audit.read"],
    }).expect(200);
    const legacyId = jobs.at(-1)!.invitationId;
    await post(`/invitations/${legacyId}/role`, { roleId: role.id }).expect(
      200,
    );
    await post(`/invitations/${legacyId}/role`, { roleId: null }).expect(200);
    assert.equal(
      (
        await f.db.platformAdminInvitation.findUniqueOrThrow({
          where: { id: legacyId },
        })
      ).roleId,
      null,
    );
    await post(`/${delegate.id}/role`, { roleId: null }).expect(200);
    assert.deepEqual(
      (
        await f.db.platformAdmin.findUniqueOrThrow({
          where: { userId: delegate.id },
        })
      ).permissions,
      role.permissions,
    );
    await post("/roles", { name: "Unused", permissions: [] }).expect(200);
    const unused = (await get("/roles")).body.roles.find(
      (r: { name: string }) => r.name === "Unused",
    );
    await post(`/roles/${unused.id}/remove`, {
      version: unused.version,
    }).expect(200);
    await assert.rejects(
      f.db.platformRole.create({
        data: {
          name: "Invalid persisted",
          nameKey: "invalid-persisted",
          permissions: ["members.roles"],
        },
      }),
    );
    const listed = (await get("")).body;
    assert.ok(
      listed.roles.every((r: object) => !Object.keys(r).includes("nameKey")),
    );
    assert.equal(await f.db.organizationPermissionGrant.count(), 0);
    const events = await f.db.auditEvent.findMany({
      where: { action: { startsWith: "platform_role." } },
    });
    assert.equal(
      events.filter((e) => e.action === "platform_role.updated").length,
      1,
    );
    for (const event of events) {
      const details = auditDetails(event, f.auth.vault);
      assert.equal(details.actorId, master.id);
      assert.deepEqual(details.metadata, {});
    }
  },
);
