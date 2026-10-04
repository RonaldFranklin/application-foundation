import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { token, digest, verifyPassword } from "../src/infra/security/crypto";
test(
  "organization members: provision, roles, duplicates, isolation, authorization and concurrent writes",
  { timeout: 60000 },
  async () => {
    const f = await fixture(15444);
    try {
      const http = f.app.getHttpServer();
      const master = await f.db.user.findFirstOrThrow({
        where: { master: true },
      });
      const a = await f.db.organization.create({ data: { name: "A" } });
      const b = await f.db.organization.create({ data: { name: "B" } });
      const root = `/v1/admin/organizations/${a.id}/members`;
      async function cookie(
        userId: string,
        stage = "full",
        expiresAt = new Date(Date.now() + 600000),
      ) {
        const raw = token();
        await f.db.session.create({
          data: { digest: digest(raw), userId, stage, expiresAt },
        });
        return `login_session=${raw}`;
      }
      const cm = await cookie(master.id);
      const post = (path: string, body: object, c = cm) =>
        request(http)
          .post(path)
          .set("Cookie", c)
          .set("Origin", f.c.FRONTEND_ORIGIN)
          .send(body);
      const get = (path = root, c = cm) =>
        request(http).get(path).set("Cookie", c);
      const data = {
        mode: "new",
        username: "  Person  ",
        email: " PERSON@EXAMPLE.INVALID ",
        password: "synthetic strong password",
      };
      assert.equal((await post(root, data)).status, 401);
      await f.db.user.update({
        where: { id: master.id },
        data: { mustChangePassword: false, totpVerified: true },
      });
      assert.equal((await post(root, data)).status, 200);
      const person = await f.db.user.findUniqueOrThrow({
        where: { emailIndex: f.auth.vault.index("person@example.invalid") },
      });
      assert.equal(person.master, false);
      assert.equal(person.mustChangePassword, true);
      assert.ok(await verifyPassword(person.passwordHash, data.password));
      assert.notEqual(person.email, "person@example.invalid");
      assert.equal(
        await f.db.session.count({ where: { userId: person.id } }),
        0,
      );
      const first = (await get()).body.items[0];
      assert.deepEqual(Object.keys(first).sort(), [
        "createdAt",
        "email",
        "role",
        "userId",
        "username",
      ]);
      assert.equal(first.username, "person");
      assert.equal(first.email, "person@example.invalid");
      assert.equal(first.role, "MEMBER");
      assert.equal((await post(root, data)).status, 409);
      assert.equal(
        (await post(root, { mode: "existing", email: first.email })).status,
        409,
      );
      assert.equal(
        (
          await post(root, {
            ...data,
            username: "other",
            email: "other@example.invalid",
            role: "ORGANIZATION_ADMIN",
          })
        ).status,
        200,
      );
      assert.equal((await get()).body.items[1].role, "ORGANIZATION_ADMIN");
      assert.equal(
        (await post(`${root}/${person.id}`, { role: "ORGANIZATION_ADMIN" }))
          .status,
        200,
      );
      const ordinary = await cookie(person.id);
      async function denied(c: string) {
        assert.equal((await get(root, c)).status, 401);
        assert.equal((await post(root, data, c)).status, 401);
        assert.equal(
          (await post(`${root}/${person.id}`, { role: "MEMBER" }, c)).status,
          401,
        );
        assert.equal(
          (await post(`${root}/${person.id}/remove`, {}, c)).status,
          401,
        );
      }
      await denied("");
      await denied(ordinary); // An organization admin is not a global Master.
      for (const stage of ["password", "setup", "recovery", "mfa"])
        await denied(await cookie(master.id, stage));
      await denied(
        await cookie(master.id, "full", new Date(Date.now() - 1000)),
      );
      const second = `/v1/admin/organizations/${b.id}/members`;
      assert.deepEqual((await get(second)).body.items, []);
      assert.equal(
        (await post(`${second}/${person.id}`, { role: "MEMBER" })).status,
        404,
      );
      assert.equal(
        (await post(`${second}/${person.id}/remove`, {})).status,
        404,
      );
      const concurrent = await Promise.all([
        post(second, { mode: "existing", email: first.email }),
        post(second, { mode: "existing", email: first.email }),
      ]);
      assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await get(second)).body.items[0].role, "MEMBER");
      assert.equal(
        (await post(`${root}/${person.id}`, { role: "MEMBER" })).status,
        200,
      );
      assert.equal((await post(`${root}/${person.id}/remove`, {})).status, 200);
      assert.equal((await get(second)).body.items.length, 1);
      assert.ok(await f.db.user.findUnique({ where: { id: person.id } }));
      assert.ok(await f.db.session.findFirst({ where: { userId: person.id } }));
      for (const role of ["MASTER", "master", "OWNER", null]) {
        assert.equal(
          (await post(root, { mode: "existing", email: first.email, role }))
            .status,
          400,
        );
        assert.equal(
          (await post(`${second}/${person.id}`, { role })).status,
          400,
        );
      }
      assert.equal((await post(root, { ...data, master: true })).status, 400);
      assert.equal(
        (await post(root, { ...data, organizationId: b.id })).status,
        400,
      );
      assert.equal(
        (await post(root, { ...data, password: "short" })).status,
        400,
      );
      assert.equal(
        (await post(root, { mode: "existing", email: "bad" })).status,
        400,
      );
      assert.equal(
        (
          await post(root, {
            mode: "existing",
            email: "master@example.invalid",
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await post(root, {
            mode: "existing",
            email: "missing@example.invalid",
          })
        ).status,
        404,
      );
      // Cross-namespace collisions must not replace an existing account or its password.
      assert.equal(
        (
          await post(root, {
            ...data,
            username: first.email,
            email: "fresh@example.invalid",
          })
        ).status,
        409,
      );
      assert.equal(
        (await f.db.user.findUniqueOrThrow({ where: { id: person.id } }))
          .passwordHash,
        person.passwordHash,
      );
      const fresh = {
        ...data,
        username: "concurrent",
        email: "concurrent@example.invalid",
      };
      const simultaneous = await Promise.all([
        post(root, fresh),
        post(root, fresh),
      ]);
      assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 409]);
      assert.equal(
        await f.db.user.count({
          where: { emailIndex: f.auth.vault.index(fresh.email) },
        }),
        1,
      );
      assert.equal(
        (await post(`/v1/admin/organizations/${randomUUID()}/members`, fresh))
          .status,
        404,
      );
      assert.equal(
        (await request(http).post(root).set("Cookie", cm).send(data)).status,
        403,
      );
      const login = await request(http)
        .post("/v1/auth/login")
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .send({ identifier: first.email, password: data.password });
      assert.equal(login.status, 200);
      assert.equal(login.body.stage, "password");
      await f.db.session.deleteMany({ where: { userId: master.id } });
      await denied(cm);
      assert.equal(await f.db.user.count({ where: { master: true } }), 1);
    } finally {
      await f.close();
    }
  },
);
