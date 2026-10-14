import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { token, digest, hashPassword } from "../src/infra/security/crypto";
test(
  "existing members: roles, soft removal, isolation and closed direct provisioning",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(15444);
    t.after(() => f.close());
    const master = await f.db.user.findFirstOrThrow({
      where: { master: true },
    });
    await f.db.user.update({
      where: { id: master.id },
      data: { mustChangePassword: false, totpVerified: true },
    });
    const a = await f.db.organization.create({ data: { name: "A" } }),
      b = await f.db.organization.create({ data: { name: "B" } });
    const hash = await hashPassword("synthetic legacy password");
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
    const person = await account("person"),
      admin = await account("admin");
    await f.db.organizationMember.createMany({
      data: [
        { organizationId: a.id, userId: admin.id, role: "ORGANIZATION_ADMIN" },
        { organizationId: a.id, userId: person.id },
        { organizationId: b.id, userId: person.id },
      ],
    });
    async function cookie(userId: string, stage = "full") {
      const raw = token();
      await f.db.session.create({
        data: {
          digest: digest(raw),
          userId,
          stage,
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      return `login_session=${raw}`;
    }
    const cm = await cookie(master.id),
      ordinary = await cookie(person.id),
      base = `/v1/admin/organizations/${a.id}/members`;
    const post = (path: string, body: object, c = cm) =>
      request(f.app.getHttpServer())
        .post(path)
        .set("Cookie", c)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .send(body);
    const get = (path = base, c = cm) =>
      request(f.app.getHttpServer()).get(path).set("Cookie", c);
    for (const mode of ["new", "existing"])
      assert.equal(
        (
          await post(base, {
            mode,
            email: "new@example.invalid",
            password: "synthetic password",
            username: "new",
          })
        ).status,
        410,
      );
    assert.equal(await f.db.user.count(), 3);
    for (const c of ["", ordinary, await cookie(master.id, "mfa")]) {
      assert.equal((await get(base, c)).status, 401);
      assert.equal(
        (await post(`${base}/${person.id}`, { role: "MEMBER" }, c)).status,
        401,
      );
    }
    const listed = await get();
    assert.equal(listed.body.items.length, 2);
    assert.equal(
      listed.body.items.find((i: { userId: string }) => i.userId === person.id)
        .email,
      "person@example.invalid",
    );
    for (const role of ["MASTER", "OWNER", null])
      assert.equal((await post(`${base}/${person.id}`, { role })).status, 400);
    assert.equal(
      (await post(`${base}/${person.id}`, { role: "ORGANIZATION_ADMIN" }))
        .status,
      200,
    );
    assert.equal((await post(`${base}/${person.id}/remove`, {})).status, 200);
    assert.ok(await f.db.user.findUnique({ where: { id: person.id } }));
    assert.equal(
      (await get(`/v1/admin/organizations/${b.id}/members`)).body.items.length,
      1,
    );
    assert.equal((await post(`${base}/${person.id}/remove`, {})).status, 404);
    assert.equal((await post(`${base}/${person.id}/restore`, {})).status, 200);
    assert.equal(
      (
        await post(
          `/v1/admin/organizations/${b.id}/members/${admin.id}/remove`,
          {},
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(f.app.getHttpServer())
          .post(`${base}/${person.id}/remove`)
          .set("Cookie", cm)
          .send({})
      ).status,
      403,
    );
  },
);
