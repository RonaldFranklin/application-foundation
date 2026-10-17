import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { createApp } from "../src/app";
import { digest, token, hashPassword } from "../src/infra/security/crypto";
import { delegablePermissionKeys as permissionKeys } from "../src/application/organizations/permissions";

test(
  "organization administration: live role, scope, protected operations and concurrent access changes",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(15450),
      replica = await createApp(f.c);
    t.after(async () => {
      await replica.close();
      await f.close();
    });
    const master = await f.db.user.findFirstOrThrow({
      where: { master: true },
    });
    await f.db.user.update({
      where: { id: master.id },
      data: { mustChangePassword: false, totpVerified: true },
    });
    const hash = await hashPassword("synthetic organizational password");
    async function account(name: string) {
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
    async function cookie(
      userId: string,
      stage: "full" | "password" = "full",
      expiresAt = new Date(Date.now() + 600000),
    ) {
      const raw = token();
      await f.db.session.create({
        data: { digest: digest(raw), userId, stage, expiresAt },
      });
      return `login_session=${raw}`;
    }
    const admin = await account("admin-one"),
      admin2 = await account("admin-two"),
      member = await account("member-one"),
      outside = await account("outside");
    const a = await f.db.organization.create({
        data: { name: "Own organization" },
      }),
      b = await f.db.organization.create({
        data: { name: "Other organization" },
      });
    await f.db.organizationMember.createMany({
      data: [
        { organizationId: a.id, userId: admin.id, role: "ORGANIZATION_ADMIN" },
        { organizationId: a.id, userId: admin2.id, role: "ORGANIZATION_ADMIN" },
        { organizationId: a.id, userId: member.id },
        {
          organizationId: b.id,
          userId: outside.id,
          role: "ORGANIZATION_ADMIN",
        },
      ],
    });
    const ca = await cookie(admin.id),
      ca2 = await cookie(admin2.id),
      cm = await cookie(member.id),
      cg = await cookie(master.id);
    const base = `/v1/organizations/${a.id}`,
      global = `/v1/admin/organizations/${a.id}`;
    const get = (path: string, c = ca) =>
      request(f.app.getHttpServer()).get(path).set("Cookie", c);
    const post = (path: string, data: object = {}, c = ca, app = f.app) =>
      request(app.getHttpServer())
        .post(path)
        .set("Cookie", c)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .send(data);

    await t.test(
      "directory and access disclose only current authorized memberships; invalid sessions and foreign IDs denied",
      async () => {
        const list = await get("/v1/organizations");
        assert.equal(list.status, 200);
        assert.equal(list.body.items.length, 1);
        assert.equal(list.body.items[0].id, a.id);
        assert.equal(list.body.items[0].role, "ORGANIZATION_ADMIN");
        assert.equal(list.body.items[0].userId, admin.id);
        assert.deepEqual(list.body.items[0].permissions, permissionKeys);
        assert.equal(
          (await get(`${base}/access`)).body.role,
          "ORGANIZATION_ADMIN",
        );
        for (const c of [
          "",
          await cookie(admin.id, "password"),
          await cookie(admin.id, "full", new Date(0)),
        ]) {
          assert.equal((await get(`${base}/access`, c)).status, 401);
          assert.equal((await post(base, { name: "invalid" }, c)).status, 401);
        }
        for (const suffix of ["", "/access", "/members", "/permissions"]) {
          const foreign = await get(`/v1/organizations/${b.id}${suffix}`);
          const missing = await get(
            `/v1/organizations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa${suffix}`,
          );
          assert.equal(foreign.status, 403);
          assert.deepEqual(foreign.body, missing.body);
          assert.equal((await get(base + suffix, cm)).status, 403);
          assert.equal((await get(global + suffix)).status, 401);
        }
        for (const [suffix, body] of [
          ["", { name: "attack" }],
          [
            "/members",
            { mode: "existing", email: "member-one@example.invalid" },
          ],
          [`/members/${outside.id}`, { role: "MEMBER" }],
          [`/members/${outside.id}/remove`, {}],
          ["/permissions", { role: "MEMBER", permissions: permissionKeys }],
        ] as const) {
          assert.equal(
            (await post(`/v1/organizations/${b.id}${suffix}`, body)).status,
            403,
          );
          assert.equal((await post(base + suffix, body, cm)).status, 403);
        }
        assert.deepEqual((await get("/v1/organizations", cm)).body.items, []);
      },
    );

    await t.test(
      "administrative namespace remains Master-only regardless of URL casing",
      async () => {
        for (const prefix of [
          "/v1/admin/organizations",
          "/V1/ADMIN/organizations",
          "/v1/Admin/organizations",
        ]) {
          assert.equal((await get(prefix)).status, 401);
          for (const suffix of ["", "/access", "/members", "/permissions"])
            assert.equal((await get(`${prefix}/${a.id}${suffix}`)).status, 401);
          for (const [suffix, body] of [
            ["", { name: "namespace attack" }],
            [
              "/members",
              { mode: "existing", email: "outside@example.invalid" },
            ],
            [`/members/${member.id}`, { role: "ORGANIZATION_ADMIN" }],
            [`/members/${member.id}/remove`, {}],
            ["/permissions", { role: "MEMBER", permissions: permissionKeys }],
          ] as const)
            assert.equal(
              (await post(`${prefix}/${a.id}${suffix}`, body)).status,
              401,
            );
          for (const org of [a, b]) {
            assert.equal((await get(`${prefix}/${org.id}`, cg)).status, 200);
            assert.equal(
              (await post(`${prefix}/${org.id}`, { name: org.name }, cg))
                .status,
              200,
            );
          }
        }
      },
    );

    await t.test(
      "client scope hints never authorize another organization or member",
      async () => {
        const directory = await get(
          `/v1/organizations?organizationId=${b.id}&deleted=true`,
        ).set("X-Organization-Id", b.id);
        assert.deepEqual(
          directory.body.items.map((item: { id: string }) => item.id),
          [a.id],
        );
        const foreign = `/v1/organizations/${b.id}`;
        assert.equal(
          (
            await get(`${foreign}?organizationId=${a.id}`).set(
              "X-Organization-Id",
              a.id,
            )
          ).status,
          403,
        );
        assert.equal(
          (await get(`${base}/members?organizationId=${b.id}`)).status,
          400,
        );
        assert.equal(
          (
            await get(`${base}/members`).set("X-Organization-Id", b.id)
          ).body.items.some(
            (item: { userId: string }) => item.userId === outside.id,
          ),
          false,
        );
        for (const suffix of [
          "/remove",
          "/restore",
          `/members/${outside.id}/restore`,
        ])
          assert.equal((await post(foreign + suffix)).status, 401);
        assert.equal((await post(foreign, { active: false })).status, 403);
        for (const [suffix, body] of [
          [`/members/${outside.id}`, { role: "MEMBER" }],
          [`/members/${outside.id}/remove`, {}],
        ] as const)
          assert.equal(
            (await post(base + suffix, body)).status,
            suffix.endsWith("/remove") ? 404 : 403,
          );
        assert.equal(
          (
            await post(`${base}/members`, {
              mode: "existing",
              email: "outside@example.invalid",
              organizationId: b.id,
            })
          ).status,
          410,
        );
        const unlinked = await account("unlinked-audit");
        const cu = await cookie(unlinked.id);
        assert.deepEqual((await get("/v1/organizations", cu)).body.items, []);
        assert.equal((await get(base, cu)).status, 403);
        assert.equal((await post(base, { name: "denied" }, cu)).status, 403);
      },
    );

    await t.test(
      "own name, existing membership role/removal and permission management preserve current flows",
      async () => {
        assert.equal(
          (await post(base, { name: "  Renamed own organization  " })).status,
          200,
        );
        assert.equal((await get(base)).body.name, "Renamed own organization");
        assert.equal(
          (await post(base, { name: "invalid", organizationId: b.id })).status,
          400,
        );
        const newAccount = {
          mode: "new",
          username: "new-organizational-member",
          email: "new-organizational-member@example.invalid",
          password: "synthetic temporary password",
          role: "MEMBER",
        };
        assert.equal((await post(`${base}/members`, newAccount)).status, 410);
        const created = await account("new-organizational-member");
        await f.db.organizationMember.create({
          data: { organizationId: a.id, userId: created.id },
        });
        assert.equal(
          (
            await post(`${base}/members/${created.id}`, {
              role: "ORGANIZATION_ADMIN",
            })
          ).status,
          403,
        );
        assert.equal(
          (await post(`${base}/members/${created.id}/remove`)).status,
          200,
        );
        assert.ok(
          (
            await f.db.organizationMember.findUniqueOrThrow({
              where: {
                organizationId_userId: {
                  organizationId: a.id,
                  userId: created.id,
                },
              },
            })
          ).deletedAt,
        );
        assert.equal(
          (
            await post(`${base}/permissions`, {
              role: "MEMBER",
              permissions: ["organization.read", "members.read"],
            })
          ).status,
          200,
        );
        assert.equal((await get(`${base}/members`, cm)).status, 200);
        assert.equal((await get(`${base}/permissions`, cm)).status, 403);
        assert.equal((await post(base, { name: "denied" }, cm)).status, 403);
        assert.equal((await get(`${base}/access`, cm)).body.role, "MEMBER");
        for (const role of ["MASTER", "ORGANIZATION_ADMIN"])
          assert.equal(
            (await post(`${base}/permissions`, { role, permissions: [] }))
              .status,
            400,
          );
        assert.equal(
          (await post(`${base}/members/${member.id}`, { role: "MASTER" }))
            .status,
          403,
        );
        assert.equal(
          (await post(`${base}/members`, { ...newAccount, master: true }))
            .status,
          410,
        );
        assert.equal(
          (
            await post(`${base}/members`, {
              mode: "existing",
              email: "master@example.invalid",
            })
          ).status,
          410,
        );
        assert.equal(
          (await get(`${base}/permissions`)).body.roles.ORGANIZATION_ADMIN
            .protected,
          true,
        );
        assert.deepEqual(
          (await get(`${base}/permissions`)).body.roles.ORGANIZATION_ADMIN
            .permissions,
          permissionKeys,
        );
        assert.equal(
          (await f.db.organization.findUniqueOrThrow({ where: { id: b.id } }))
            .name,
          b.name,
        );
        assert.equal(
          (
            await f.db.organizationMember.findUniqueOrThrow({
              where: {
                organizationId_userId: {
                  organizationId: b.id,
                  userId: outside.id,
                },
              },
            })
          ).role,
          "ORGANIZATION_ADMIN",
        );
      },
    );

    await t.test(
      "global operations are Master-only; own administrative access remains protected even with a second admin",
      async () => {
        for (const active of [false, true])
          assert.equal(
            (await post(base, { name: "must not persist", active })).status,
            403,
          );
        assert.equal((await get(base)).body.name, "Renamed own organization");
        for (const suffix of [
          "/remove",
          "/restore",
          `/members/${member.id}/restore`,
        ])
          assert.equal((await post(base + suffix)).status, 401);
        assert.equal((await get(`${base}/members?deleted=true`)).status, 403);
        assert.equal(
          (await post("/v1/organizations", { name: "global creation" })).status,
          401,
        );
        for (const target of [admin.id, admin.id.toUpperCase()]) {
          assert.equal(
            (await post(`${base}/members/${target}`, { role: "MEMBER" }))
              .status,
            403,
          );
          assert.equal(
            (await post(`${base}/members/${target}/remove`)).status,
            403,
          );
        }
        assert.equal((await post(global, { active: false }, cg)).status, 200);
        assert.equal((await get(`${base}/access`)).status, 403);
        assert.deepEqual((await get("/v1/organizations")).body.items, []);
        assert.equal((await post(base, { active: true })).status, 403);
        assert.equal((await post(global, { active: true }, cg)).status, 200);
        assert.equal((await post(`${global}/remove`, {}, cg)).status, 200);
        assert.equal((await get(`${base}/access`)).status, 403);
        assert.equal((await post(`${global}/restore`, {}, cg)).status, 200);
        assert.equal((await get(`${base}/access`)).status, 200);
      },
    );

    await t.test(
      "ordinary administrators cannot remove each other; Master can remove and restore the last admin",
      async () => {
        const results = await Promise.all([
          post(`${base}/members/${admin2.id}/remove`),
          post(`${base}/members/${admin.id}/remove`, {}, ca2, replica),
        ]);
        assert.deepEqual(
          results.map((r) => r.status),
          [403, 403],
        );
        for (const target of [admin.id, admin2.id]) {
          assert.equal(
            (await post(`${global}/members/${target}/remove`, {}, cg)).status,
            200,
          );
        }
        assert.equal((await get(`${base}/access`, ca)).status, 403);
        assert.equal((await get(`${base}/access`, ca2)).status, 403);
        assert.equal(
          (await post(`${global}/members/${admin.id}/restore`, {}, cg)).status,
          200,
        );
      },
    );
  },
);
