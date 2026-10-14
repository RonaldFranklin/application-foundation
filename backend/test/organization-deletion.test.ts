import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { createApp } from "../src/app";
import { digest, token, hashPassword } from "../src/infra/security/crypto";

test(
  "logical deletion: authorization, isolation, preservation, restoration and concurrency",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(15449),
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
    const passwordHash = await hashPassword(
      "synthetic deletion test passphrase",
    );
    async function user(name: string) {
      return f.db.user.create({
        data: {
          username: f.auth.vault.encrypt(name, "username"),
          email: f.auth.vault.encrypt(`${name}@example.invalid`, "email"),
          usernameIndex: f.auth.vault.index(name),
          emailIndex: f.auth.vault.index(`${name}@example.invalid`),
          passwordHash,
        },
      });
    }
    async function cookie(
      userId: string,
      stage: "full" | "mfa" = "full",
      expiresAt = new Date(Date.now() + 600000),
    ) {
      const raw = token();
      await f.db.session.create({
        data: { userId, digest: digest(raw), stage, expiresAt },
      });
      return `login_session=${raw}`;
    }
    const admin = await user("deletion-admin"),
      member = await user("deletion-member"),
      outsider = await user("deletion-outsider");
    const cm = await cookie(master.id),
      ca = await cookie(admin.id),
      cu = await cookie(member.id),
      co = await cookie(outsider.id);
    const restricted = await cookie(master.id, "mfa"),
      expired = await cookie(master.id, "full", new Date(0)),
      revoked = await cookie(master.id);
    await f.db.session.delete({
      where: { digest: digest(revoked.slice("login_session=".length)) },
    });
    const a = await f.db.organization.create({
        data: { name: "Preserved organization" },
      }),
      b = await f.db.organization.create({
        data: { name: "Other organization" },
      });
    await f.db.organizationMember.createMany({
      data: [
        { organizationId: a.id, userId: admin.id, role: "ORGANIZATION_ADMIN" },
        { organizationId: a.id, userId: member.id, role: "ORGANIZATION_ADMIN" },
        { organizationId: b.id, userId: member.id, role: "ORGANIZATION_ADMIN" },
      ],
    });
    const base = `/v1/admin/organizations/${a.id}`,
      common = `/v1/organizations/${a.id}`;
    const post = (path: string, body: object = {}, c = cm, app = f.app) =>
      request(app.getHttpServer())
        .post(path)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .set("Cookie", c)
        .send(body);
    const get = (path: string, c = cm) =>
      request(f.app.getHttpServer()).get(path).set("Cookie", c);
    const link = () =>
      f.db.organizationMember.findUniqueOrThrow({
        where: {
          organizationId_userId: { organizationId: a.id, userId: member.id },
        },
      });

    await t.test(
      "global Master authorization, strict inputs, CSRF and removed-list isolation",
      async () => {
        for (const c of ["", ca, cu, co, restricted, expired, revoked])
          for (const prefix of [base, common])
            for (const suffix of [
              "/remove",
              "/restore",
              `/members/${member.id}/restore`,
            ])
              assert.equal((await post(prefix + suffix, {}, c)).status, 401);
        assert.equal(
          (await get(`${common}/members?deleted=true`, ca)).status,
          403,
        );
        for (const suffix of [
          "/remove",
          "/restore",
          `/members/${member.id}/restore`,
        ]) {
          assert.equal(
            (await post(base + suffix, { master: true, organizationId: b.id }))
              .status,
            400,
          );
          assert.equal(
            (
              await request(f.app.getHttpServer())
                .post(base + suffix)
                .set("Cookie", cm)
                .set("Origin", "https://invalid.example")
                .send({})
            ).status,
            403,
          );
        }
        assert.equal(
          (await get("/v1/admin/organizations?deleted=invalid")).status,
          400,
        );
        assert.equal(
          (await get(`${base}/members?deleted=invalid`)).status,
          400,
        );
        assert.equal(
          (await post("/v1/admin/organizations/not-a-uuid/restore")).status,
          404,
        );
        assert.equal(
          (await post(`${base}/members/${outsider.id}/restore`)).status,
          404,
        );
      },
    );

    await t.test(
      "membership removal preserves account, sessions, other links and prior role; concurrent restore is idempotent",
      async () => {
        const before = await link(),
          accountBefore = await f.db.user.findUniqueOrThrow({
            where: { id: member.id },
          });
        assert.equal(before.deletedAt, null);
        assert.equal(
          (await post(`${base}/members/${member.id}/remove`)).status,
          200,
        );
        const removed = await link();
        assert.ok(removed.deletedAt);
        assert.equal(removed.role, before.role);
        assert.deepEqual(removed.createdAt, before.createdAt);
        assert.deepEqual(
          await f.db.user.findUniqueOrThrow({ where: { id: member.id } }),
          accountBefore,
        );
        assert.equal((await get("/v1/welcome", cu)).status, 200);
        assert.deepEqual(
          (await get("/v1/organizations", cu)).body.items.map(
            (o: { id: string }) => o.id,
          ),
          [b.id],
        );
        for (const suffix of ["", "/access", "/members", "/permissions"])
          assert.equal((await get(common + suffix, cu)).status, 403);
        assert.equal(
          (await post(common, { name: "forbidden" }, cu)).status,
          403,
        );
        assert.equal((await get(`${base}/members`)).body.total, 1);
        const deleted = await get(
          `${base}/members?deleted=true&role=ORGANIZATION_ADMIN&search=deletion-member`,
        );
        assert.equal(deleted.body.total, 1);
        assert.equal(deleted.body.items[0].userId, member.id);
        assert.equal(
          (await post(`${base}/members/${member.id}`, { role: "MEMBER" }))
            .status,
          404,
        );
        const duplicate = await post(`${base}/members`, {
          mode: "existing",
          email: "deletion-member@example.invalid",
          role: "MEMBER",
        });
        assert.equal(duplicate.status, 410);
        assert.match(duplicate.body.message, /convite/);
        const restored = await Promise.all([
          post(`${base}/members/${member.id}/restore`),
          post(`${base}/members/${member.id}/restore`, {}, cm, replica),
        ]);
        assert.deepEqual(
          restored.map((r) => r.status),
          [200, 200],
        );
        assert.deepEqual(await link(), before);
        assert.equal((await get(`${common}/access`, cu)).status, 200);
        assert.equal((await get(`${base}/members?deleted=true`)).body.total, 0);
      },
    );

    await t.test(
      "deleted organization hides lists/counts and denies all normal operations; restoration preserves removed links",
      async () => {
        await post(`${base}/permissions`, {
          role: "MEMBER",
          permissions: ["organization.read"],
        });
        await post(`${base}/members/${member.id}/remove`);
        const links = await f.db.organizationMember.findMany({
            where: { organizationId: a.id },
          }),
          grants = await f.db.organizationPermissionGrant.findMany({
            where: { organizationId: a.id },
          });
        assert.equal(a.deletedAt, null);
        assert.equal((await post(`${base}/remove`)).status, 200);
        const removed = await f.db.organization.findUniqueOrThrow({
          where: { id: a.id },
        });
        assert.equal(removed.active, false);
        assert.ok(removed.deletedAt);
        assert.equal(
          (await post(`${base}/remove`)).body.deletedAt,
          removed.deletedAt.toISOString(),
        );
        assert.equal((await get("/v1/admin/organizations")).body.total, 1);
        assert.equal(
          (await get("/v1/admin/organizations?status=inactive")).body.total,
          0,
        );
        assert.deepEqual((await get("/v1/organizations", ca)).body.items, []);
        for (const suffix of [
          "",
          "/access",
          "/members",
          "/members?deleted=true",
          "/permissions",
        ])
          assert.equal((await get(base + suffix)).status, 404);
        for (const [suffix, body] of [
          ["", { active: true }],
          [
            "/members",
            { mode: "existing", email: "deletion-outsider@example.invalid" },
          ],
          [`/members/${admin.id}`, { role: "MEMBER" }],
          [`/members/${member.id}/restore`, {}],
          [`/members/${admin.id}/remove`, {}],
          ["/permissions", { role: "MEMBER", permissions: [] }],
        ] as const)
          assert.equal((await post(base + suffix, body)).status, 404);
        assert.equal((await get(`${common}/access`, ca)).status, 403);
        assert.equal((await post(common, { active: true }, ca)).status, 403);
        const deleted = await get(
          "/v1/admin/organizations?deleted=true&search=Preserved&status=inactive&pageSize=1",
        );
        assert.equal(deleted.body.total, 1);
        assert.equal(deleted.body.items[0].id, a.id);
        assert.deepEqual(
          await f.db.organizationMember.findMany({
            where: { organizationId: a.id },
          }),
          links,
        );
        assert.deepEqual(
          await f.db.organizationPermissionGrant.findMany({
            where: { organizationId: a.id },
          }),
          grants,
        );
        assert.equal((await post(`${base}/restore`)).status, 200);
        const restored = await f.db.organization.findUniqueOrThrow({
          where: { id: a.id },
        });
        assert.equal(restored.active, true);
        assert.equal(restored.deletedAt, null);
        assert.deepEqual(
          await f.db.organizationMember.findMany({
            where: { organizationId: a.id },
          }),
          links,
        );
        assert.equal((await get(`${common}/access`, ca)).status, 200);
        assert.equal((await get(`${common}/access`, cu)).status, 403);
        assert.equal((await get(`${base}/members?deleted=true`)).body.total, 1);
      },
    );

    await t.test(
      "replicas serialize last-admin protection, restore/link and deletion/update",
      async () => {
        await post(`${base}/members/${member.id}/restore`);
        const outcomes = await Promise.all([
          post(`${base}/members/${member.id}/remove`),
          post(
            `${base.replace(a.id, a.id.toUpperCase())}/members/${admin.id}/remove`,
            {},
            cm,
            replica,
          ),
        ]);
        assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
        const removed = await f.db.organizationMember.findFirstOrThrow({
          where: { organizationId: a.id, deletedAt: { not: null } },
        });
        const email =
          removed.userId === member.id
            ? "deletion-member@example.invalid"
            : "deletion-admin@example.invalid";
        const duplicate = await Promise.all([
          post(`${base}/members/${removed.userId}/restore`),
          post(`${base}/members`, { mode: "existing", email }, cm, replica),
        ]);
        assert.deepEqual(
          duplicate.map((r) => r.status),
          [200, 410],
        );
        assert.equal(
          await f.db.organizationMember.count({
            where: { organizationId: a.id },
          }),
          2,
        );
        const deletion = await Promise.all([
          post(`${base}/remove`),
          post(
            base.replace(a.id, a.id.toUpperCase()),
            { active: true },
            cm,
            replica,
          ),
        ]);
        assert.equal(deletion[0].status, 200);
        assert.ok([200, 404].includes(deletion[1].status));
        const final = await f.db.organization.findUniqueOrThrow({
          where: { id: a.id },
        });
        assert.ok(final.deletedAt);
        assert.equal(final.active, false);
        await post(`${base}/restore`);
      },
    );
  },
);
