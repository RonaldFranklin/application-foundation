import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { createApp } from "../src/app";
import { hashPassword, token, digest } from "../src/infra/security/crypto";
import { delegablePermissionKeys as permissionKeys } from "../src/application/organizations/permissions";

test(
  "organization permissions: defaults, strict catalogue, live isolation, filtered members and concurrent Master administration",
  { timeout: 60000 },
  async () => {
    const f = await fixture(15446);
    const replica = await createApp(f.c);
    try {
      const master = await f.db.user.findFirstOrThrow({
        where: { master: true },
      });
      await f.db.user.update({
        where: { id: master.id },
        data: { mustChangePassword: false, totpVerified: true },
      });
      const a = await f.db.organization.create({
        data: { name: "Organization A" },
      });
      const b = await f.db.organization.create({
        data: { name: "Organization B" },
      });
      const pass = "synthetic organization passphrase";
      const hash = await hashPassword(pass);
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
      async function cookie(userId: string) {
        const raw = token();
        await f.db.session.create({
          data: {
            digest: digest(raw),
            userId,
            stage: "full",
            expiresAt: new Date(Date.now() + 600000),
          },
        });
        return `login_session=${raw}`;
      }
      const admin = await user("admin-a"),
        admin2 = await user("admin-a2"),
        member = await user("member-a"),
        outsider = await user("admin-b");
      await f.db.organizationMember.createMany({
        data: [
          {
            organizationId: a.id,
            userId: admin.id,
            role: "ORGANIZATION_ADMIN",
          },
          {
            organizationId: a.id,
            userId: admin2.id,
            role: "ORGANIZATION_ADMIN",
          },
          { organizationId: a.id, userId: member.id, role: "MEMBER" },
          {
            organizationId: b.id,
            userId: outsider.id,
            role: "ORGANIZATION_ADMIN",
          },
        ],
      });
      const ca = await cookie(admin.id),
        ca2 = await cookie(admin2.id),
        cm = await cookie(member.id),
        cb = await cookie(outsider.id),
        masterCookie = await cookie(master.id);
      const base = `/v1/organizations/${a.id}`;
      const get = (path: string, c = ca) =>
        request(f.app.getHttpServer()).get(path).set("Cookie", c);
      const post = (path: string, data: object, c = ca, app = f.app) =>
        request(app.getHttpServer())
          .post(path)
          .set("Cookie", c)
          .set("Origin", f.c.FRONTEND_ORIGIN)
          .send(data);
      const config = await get(`${base}/permissions`);
      assert.equal(config.status, 200);
      assert.deepEqual(config.body.roles.MEMBER.permissions, []);
      assert.equal(config.body.roles.ORGANIZATION_ADMIN.protected, true);
      assert.deepEqual(
        config.body.roles.ORGANIZATION_ADMIN.permissions.sort(),
        [...permissionKeys].sort(),
      );
      assert.equal((await get("/v1/welcome", cm)).status, 200);
      assert.deepEqual((await get("/v1/organizations", cm)).body, {
        items: [],
      });
      for (const path of [
        base,
        `${base}/access`,
        `${base}/members`,
        `${base}/permissions`,
      ]) {
        assert.equal((await get(path, cm)).status, 403);
        assert.equal((await get(path, cb)).status, 403);
      }
      for (const [path, body] of [
        [base, { name: "stolen" }],
        [
          `${base}/members`,
          { mode: "existing", email: "member-a@example.invalid" },
        ],
        [`${base}/members/${admin.id}`, { role: "MEMBER" }],
        [`${base}/members/${admin.id}/remove`, {}],
        [
          `${base}/permissions`,
          { role: "MEMBER", permissions: permissionKeys },
        ],
      ] as const)
        assert.equal((await post(path, body, cb)).status, 403);
      assert.equal(
        (await get(`/v1/admin/organizations/${a.id}`, ca)).status,
        401,
      );
      assert.equal(
        (await get(`/v1/admin/organizations/${b.id}`, masterCookie)).status,
        200,
      );
      for (const body of [
        { role: "ORGANIZATION_ADMIN", permissions: [] },
        { role: "MASTER", permissions: [] },
        { role: "MEMBER", permissions: ["unknown"] },
        { role: "MEMBER", permissions: ["members.read", "members.read"] },
        { role: "MEMBER", permissions: [], organizationId: b.id },
      ])
        assert.equal((await post(`${base}/permissions`, body)).status, 400);
      assert.equal(
        (await post(`${base}/members/${member.id}`, { role: "MASTER" })).status,
        403,
      );
      const list = await get(
        `${base}/members?search=admin&role=ORGANIZATION_ADMIN&pageSize=1&page=2`,
      );
      assert.equal(list.status, 200);
      assert.equal(list.body.total, 2);
      assert.equal(list.body.items.length, 1);
      assert.equal(list.body.items[0].role, "ORGANIZATION_ADMIN");
      assert.equal((await get(`${base}/members?search=admin-b`)).body.total, 0);
      assert.equal((await get(`${base}/members?page=0`)).status, 400);
      assert.equal((await get(`${base}/members?role=MASTER`)).status, 400);
      assert.equal(
        (
          await post(`${base}/permissions`, {
            role: "MEMBER",
            permissions: ["members.read"],
          })
        ).status,
        200,
      );
      assert.deepEqual(
        (await get(`${base}/permissions`)).body.roles.MEMBER.permissions,
        ["members.read"],
      );
      assert.equal((await get(`${base}/members`, cm)).status, 200);
      assert.equal((await get(base, cm)).status, 403);
      assert.equal(
        (await post(`${base}/members/${admin.id}`, { role: "MEMBER" }, cm))
          .status,
        403,
      );
      assert.equal(
        (
          await post(
            `${base}/permissions`,
            { role: "MEMBER", permissions: [] },
            cm,
          )
        ).status,
        403,
      );
      assert.equal((await get("/v1/organizations", cm)).body.items.length, 1);
      await post(`${base}/permissions`, { role: "MEMBER", permissions: [] });
      assert.equal((await get(`${base}/members`, cm)).status, 403); // Same session: grants are never cached in cookies.
      // Direct provisioning is closed even for a member granted creation capabilities.
      await post(`${base}/permissions`, {
        role: "MEMBER",
        permissions: ["members.create"],
      });
      assert.equal(
        (
          await post(
            `${base}/members`,
            {
              mode: "new",
              email: "new-person@example.invalid",
              username: "new-person",
              password: pass,
            },
            cm,
          )
        ).status,
        410,
      );
      assert.equal(
        await f.db.user.count({
          where: {
            emailIndex: f.auth.vault.index("new-person@example.invalid"),
          },
        }),
        0,
      );
      await post(`${base}/permissions`, { role: "MEMBER", permissions: [] });
      // Master can leave zero administrators, even across replicas and UUID aliases.
      const outcomes = await Promise.all([
        post(`${base}/members/${admin.id}/remove`, {}, masterCookie, f.app),
        post(
          `${base.replace(a.id, a.id.toUpperCase())}/members/${admin2.id}`,
          { role: "MEMBER" },
          masterCookie,
          replica,
        ),
      ]);
      assert.deepEqual(
        outcomes.map((r) => r.status),
        [200, 200],
      );
      assert.equal(
        await f.db.organizationMember.count({
          where: {
            organizationId: a.id,
            role: "ORGANIZATION_ADMIN",
            deletedAt: null,
          },
        }),
        0,
      );
      assert.equal((await get(`${base}/permissions`, ca)).status, 403);
      assert.equal((await get(`${base}/permissions`, ca2)).status, 403);
      // Constraints provide a second boundary for the fixed catalogue and protected role.
      await assert.rejects(
        f.db.organizationPermissionGrant.create({
          data: {
            organizationId: a.id,
            role: "ORGANIZATION_ADMIN",
            permission: "MEMBERS_READ",
          },
        }),
      );
      await f.db.organizationPermissionGrant.create({
        data: { organizationId: a.id, permission: "MEMBERS_READ" },
      });
      await assert.rejects(
        f.db.organizationPermissionGrant.create({
          data: { organizationId: a.id, permission: "MEMBERS_READ" },
        }),
      );
      assert.equal((await post("/v1/auth/logout", {}, cm)).status, 204);
    } finally {
      await replica.close();
      await f.close();
    }
  },
);
