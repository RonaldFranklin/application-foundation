import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { token, digest, hashPassword } from "../src/infra/security/crypto";
import { ManageSessions } from "../src/application/auth/use-cases/manage-sessions";
import { auditDetails } from "./audit.helpers";

test(
  "own sessions: private projection, scope, atomic revocation, current preservation and restricted stages",
  { timeout: 60000 },
  async () => {
    const f = await fixture(15461);
    const v = f.auth.vault;
    async function account(name: string) {
      return f.db.user.create({
        data: {
          username: v.encrypt(name, "username"),
          email: v.encrypt(`${name}@example.invalid`, "email"),
          usernameIndex: v.index(name),
          emailIndex: v.index(`${name}@example.invalid`),
          passwordHash: await hashPassword("synthetic account password"),
        },
      });
    }
    async function session(
      userId: string,
      stage = "full",
      expires = Date.now() + 600000,
    ) {
      const raw = token();
      const row = await f.db.session.create({
        data: {
          userId,
          stage,
          digest: digest(raw),
          expiresAt: new Date(expires),
        },
      });
      return { raw, cookie: `login_session=${raw}`, row };
    }
    const get = (cookie: string, query = "") =>
      request(f.app.getHttpServer())
        .get(`/v1/auth/sessions${query}`)
        .set("Cookie", cookie);
    const post = (cookie: string, id: string, body = {}) =>
      request(f.app.getHttpServer())
        .post(`/v1/auth/sessions/${id}/revoke`)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .set("Cookie", cookie)
        .send(body);
    try {
      const a = await account("sessions-a"),
        b = await account("sessions-b");
      const organization = await f.db.organization.create({
        data: { name: "Session scope fixture" },
      });
      await f.db.organizationMember.createMany({
        data: [
          {
            userId: a.id,
            organizationId: organization.id,
            role: "ORGANIZATION_ADMIN",
          },
          { userId: b.id, organizationId: organization.id, role: "MEMBER" },
        ],
      });
      const current = await session(a.id),
        other = await session(a.id),
        foreign = await session(b.id);
      const pending = await session(a.id, "mfa"),
        expired = await session(a.id, "full", Date.now() - 1000);
      const device = await f.db.masterDevice.create({
        data: {
          userId: a.id,
          digest: digest(token()),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      const response = await get(current.cookie);
      assert.equal(response.status, 200);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.body.items.length, 3);
      assert.deepEqual(
        response.body.items.find((s: { current: boolean }) => s.current),
        {
          id: current.row.publicId,
          current: true,
          createdAt: current.row.createdAt.toISOString(),
          expiresAt: current.row.expiresAt.toISOString(),
          status: "authenticated",
        },
      );
      assert.equal(
        response.body.items.find(
          (s: { id: string }) => s.id === pending.row.publicId,
        ).status,
        "pending",
      );
      for (const row of response.body.items)
        assert.deepEqual(Object.keys(row).sort(), [
          "createdAt",
          "current",
          "expiresAt",
          "id",
          "status",
        ]);
      assert.ok(!JSON.stringify(response.body).includes(current.row.digest));
      assert.ok(!JSON.stringify(response.body).includes(current.raw));
      assert.equal(
        (await get(`login_session=${current.row.publicId}`)).status,
        401,
      );
      assert.equal((await get(current.cookie, `?userId=${b.id}`)).status, 400);
      assert.equal((await get("")).status, 401);
      for (const stage of ["password", "setup", "mfa", "recovery"]) {
        const restricted = await session(a.id, stage);
        assert.equal((await get(restricted.cookie)).status, 401);
        assert.equal((await post(restricted.cookie, "others")).status, 401);
      }
      await f.db.user.update({
        where: { id: a.id },
        data: { mustChangePassword: true },
      });
      assert.equal((await get(current.cookie)).status, 401);
      assert.equal((await post(current.cookie, "others")).status, 401);
      await f.db.user.update({
        where: { id: a.id },
        data: { mustChangePassword: false },
      });
      assert.equal((await get(expired.cookie)).status, 401);
      assert.equal(
        (await post(current.cookie, "others", { userId: b.id })).status,
        400,
      );
      assert.equal((await post(current.cookie, "bad-id")).status, 400);
      const outside = await post(current.cookie, foreign.row.publicId);
      const missing = await post(
        current.cookie,
        "00000000-0000-4000-8000-000000000000",
      );
      assert.equal(outside.status, 404);
      assert.deepEqual(outside.body, missing.body);
      assert.equal((await get(foreign.cookie)).status, 200);
      assert.equal(
        (
          await request(f.app.getHttpServer())
            .post(`/v1/auth/sessions/${other.row.publicId}/revoke`)
            .set("Cookie", current.cookie)
            .send({})
        ).status,
        403,
      );
      // Mandatory audit failure must roll back deletion.
      const broken = new ManageSessions(
        {
          run: (fn) =>
            f.work.run((tx) =>
              fn({
                ...tx,
                audit: {
                  ...tx.audit,
                  append: async () => {
                    throw new Error("synthetic audit failure");
                  },
                },
              }),
            ),
        },
        f.auth.sessions,
      );
      await assert.rejects(() =>
        broken.revoke(current.raw, other.row.publicId, {}),
      );
      assert.equal((await get(other.cookie)).status, 200);
      const ended = await post(current.cookie, other.row.publicId);
      assert.deepEqual(ended.body, { ok: true, endedCurrent: false });
      assert.equal((await get(other.cookie)).status, 401);
      assert.equal((await get(current.cookie)).status, 200);
      const result = await post(current.cookie, "others");
      assert.deepEqual(result.body, { ok: true, endedCurrent: false });
      assert.equal((await get(pending.cookie)).status, 401);
      assert.equal((await get(current.cookie)).body.items.length, 1);
      assert.equal((await get(foreign.cookie)).status, 200);
      assert.equal(
        await f.db.masterDevice.count({ where: { digest: device.digest } }),
        1,
      );
      // Bulk is safe to retry and never rotates/revokes the current credential.
      assert.equal((await post(current.cookie, "others")).status, 200);
      const concurrent = await Promise.all([
        post(current.cookie, current.row.publicId),
        post(current.cookie, current.row.publicId),
      ]);
      assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 401]);
      const success = concurrent.find((r) => r.status === 200)!;
      assert.equal(success.body.endedCurrent, true);
      assert.match(success.headers["set-cookie"][0], /login_session=;/);
      assert.equal((await get(current.cookie)).status, 401);
      const events = await f.db.auditEvent.findMany({
        where: { action: "account.sessions_revoked" },
      });
      assert.equal(events.length, 4);
      for (const event of events) {
        const details = auditDetails(event, f.auth.vault);
        assert.equal(details.actorId, a.id);
        assert.equal(details.resourceId, a.id);
        assert.deepEqual(Object.keys(details.metadata).sort(), [
          "count",
          "scope",
        ]);
        assert.ok(!JSON.stringify(details).includes(current.raw));
        assert.ok(!JSON.stringify(details).includes(current.row.digest));
      }
      // Same own-account scope for Master, never a backdoor to another account.
      const master = await f.db.user.findFirstOrThrow({
        where: { master: true },
      });
      await f.db.user.update({
        where: { id: master.id },
        data: { mustChangePassword: false, totpVerified: true },
      });
      const cm = await session(master.id);
      assert.equal((await get(cm.cookie)).body.items.length, 1);
      assert.equal((await post(cm.cookie, foreign.row.publicId)).status, 404);
      const detail = await request(f.app.getHttpServer())
        .get(`/v1/admin/audit/${events[0].id}`)
        .set("Cookie", cm.cookie);
      assert.equal(detail.status, 200);
      assert.ok(
        detail.body.metadata.some(
          (item: { label: string }) => item.label === "Sessões encerradas",
        ),
      );
      await f.db.user.update({
        where: { id: master.id },
        data: { totpVerified: false },
      });
      assert.equal((await get(cm.cookie)).status, 401);
    } finally {
      await f.close();
    }
  },
);
