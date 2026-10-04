import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { digest, token } from "../src/infra/security/crypto";

test(
  "organizations: master authorization, validation, persistence, filters and deterministic pagination",
  { timeout: 60000 },
  async () => {
    const f = await fixture(15443);
    const http = f.app.getHttpServer();
    const root = "/v1/admin/organizations";
    try {
      const master = await f.db.user.findFirstOrThrow({
        where: { master: true },
      });
      const common = await f.db.user.create({
        data: {
          username: "fixture",
          email: "fixture",
          usernameIndex: "organization-fixture",
          emailIndex: "organization-fixture",
          passwordHash: "unused",
        },
      });
      async function cookie(userId: string, stage = "full", expired = false) {
        const raw = token();
        await f.db.session.create({
          data: {
            digest: digest(raw),
            userId,
            stage,
            expiresAt: new Date(Date.now() + (expired ? -1000 : 600000)),
          },
        });
        return `login_session=${raw}`;
      }
      const cm = await cookie(master.id);
      const id = randomUUID();
      const routes = [
        ["get", root],
        ["post", root],
        ["get", `${root}/${id}`],
        ["post", `${root}/${id}`],
      ] as const;
      async function denied(c: string) {
        for (const [method, path] of routes) {
          const call = request(http)
            [method](path)
            .set("Cookie", c)
            .set("Origin", f.c.FRONTEND_ORIGIN);
          assert.equal(
            (await (method === "post" ? call.send({ name: "Denied" }) : call))
              .status,
            401,
          );
        }
      }
      await denied("");
      await denied(await cookie(common.id));
      await denied(cm);
      await f.db.user.update({
        where: { id: master.id },
        data: { mustChangePassword: false, totpVerified: true },
      });
      for (const stage of ["password", "setup", "recovery", "mfa"])
        await denied(await cookie(master.id, stage));
      await denied(await cookie(master.id, "full", true));
      const post = (path: string, body: object) =>
        request(http)
          .post(root + path)
          .set("Cookie", cm)
          .set("Origin", f.c.FRONTEND_ORIGIN)
          .send(body);
      const get = (path = "") =>
        request(http)
          .get(root + path)
          .set("Cookie", cm);
      assert.equal(
        (
          await request(http)
            .post(root)
            .set("Cookie", cm)
            .send({ name: "Blocked" })
        ).status,
        403,
      );
      for (const body of [
        {},
        { name: "   " },
        { name: "x".repeat(201) },
        { name: "Ok", slug: "no" },
        { name: 4 },
      ])
        assert.equal((await post("", body)).status, 400);
      const created = await post("", { name: "  Alpha  " });
      assert.equal(created.status, 200);
      assert.equal(created.body.name, "Alpha");
      assert.equal(created.body.active, true);
      const duplicate = await post("", { name: "Alpha" });
      assert.equal(duplicate.status, 200);
      assert.notEqual(duplicate.body.id, created.body.id);
      const special = await post("", { name: "100%_works" });
      assert.equal(special.status, 200);
      assert.equal((await get("?search=%25_")).body.total, 1);
      assert.equal((await get("?search=ALP")).body.total, 2);
      for (const query of [
        "page=0",
        "page=-1",
        "page=1.5",
        "page=1e2",
        "pageSize=101",
        "pageSize=0",
        "page=1000001",
        "status=other",
        "page=1&page=2",
      ])
        assert.equal((await get(`?${query}`)).status, 400, query);
      const sameTime = new Date();
      await f.db.organization.updateMany({ data: { createdAt: sameTime } });
      const first = (await get("?pageSize=1")).body;
      const second = (await get("?pageSize=1&page=2")).body;
      assert.equal(first.total, 3);
      assert.notEqual(first.items[0].id, second.items[0].id);
      assert.deepEqual((await get("?pageSize=1")).body, first);
      assert.equal((await get("?page=999")).body.items.length, 0);
      const changed = await post(`/${created.body.id}`, {
        name: "Renamed",
        active: false,
      });
      assert.equal(changed.status, 200);
      assert.equal(changed.body.active, false);
      assert.ok(
        new Date(changed.body.updatedAt) >= new Date(created.body.updatedAt),
      );
      assert.equal((await get(`/${created.body.id}`)).body.name, "Renamed");
      assert.equal((await get("?status=inactive")).body.total, 1);
      assert.equal((await get("?status=active")).body.total, 2);
      assert.equal(
        (await post(`/${created.body.id}`, { active: true })).body.active,
        true,
      );
      assert.equal((await post(`/${created.body.id}`, {})).status, 400);
      assert.equal(
        (await post(`/${created.body.id}`, { active: "false" })).status,
        400,
      );
      for (const missing of [id, "invalid"]) {
        assert.equal((await get(`/${missing}`)).status, 404);
        assert.equal(
          (await post(`/${missing}`, { name: "missing" })).status,
          404,
        );
      }
      assert.equal(await f.db.organization.count(), 3);
      await f.db.session.deleteMany({ where: { userId: master.id } });
      await denied(cm);
    } finally {
      await f.close();
    }
  },
);
