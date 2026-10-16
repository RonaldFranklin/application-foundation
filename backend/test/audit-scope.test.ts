import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { fixture } from "./helpers";
import { auditDetails } from "./audit.helpers";
import { digest, token } from "../src/infra/security/crypto";
import { QueryAudit } from "../src/application/audit/query-audit";
import { backfillAuditOrganizations } from "../src/infra/database/repositories/backfill-audit-organizations";

test(
  "organization audit validates explicit context; filters, details and writes cannot cross organizations",
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(15454);
    t.after(() => f.close());
    const master = await f.db.user.findFirstOrThrow({
      where: { master: true },
    });
    await f.db.user.update({
      where: { id: master.id },
      data: { mustChangePassword: false, totpVerified: true },
    });
    async function user(name: string) {
      return f.db.user.create({
        data: {
          username: f.auth.vault.encrypt(name, "username"),
          email: f.auth.vault.encrypt(`${name}@example.invalid`, "email"),
          usernameIndex: name,
          emailIndex: name,
          passwordHash: "unused",
        },
      });
    }
    async function session(userId: string, stage = "full") {
      const raw = token();
      await f.db.session.create({
        data: {
          digest: digest(raw),
          userId,
          stage,
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      return raw;
    }
    const adminA = await user("Admin A"),
      adminB = await user("Admin B"),
      member = await user("Member");
    const a = await f.db.organization.create({
      data: { name: "Organização A" },
    });
    const b = await f.db.organization.create({
      data: { name: "Organização B" },
    });
    await f.db.organizationMember.createMany({
      data: [
        { organizationId: a.id, userId: adminA.id, role: "ORGANIZATION_ADMIN" },
        { organizationId: b.id, userId: adminB.id, role: "ORGANIZATION_ADMIN" },
        { organizationId: a.id, userId: member.id, role: "MEMBER" },
      ],
    });
    await f.db.organizationPermissionGrant.create({
      data: {
        organizationId: a.id,
        role: "MEMBER",
        permission: "PERMISSIONS_MANAGE",
      },
    });
    const rawA = await session(adminA.id),
      rawB = await session(adminB.id),
      rawMember = await session(member.id),
      rawMaster = await session(master.id);
    const get = (path: string, raw = rawA) =>
      request(f.app.getHttpServer())
        .get(`/v1${path}`)
        .set("Cookie", `login_session=${raw}`);
    const update = (id: string, body: object, raw = rawA) =>
      request(f.app.getHttpServer())
        .post(`/v1/organizations/${id}`)
        .set("Cookie", `login_session=${raw}`)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .send(body);
    const select = (id: string, raw = rawA) =>
      request(f.app.getHttpServer())
        .post("/v1/organization-context")
        .set("Cookie", `login_session=${raw}`)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .send({ organizationId: id });
    await get("/audit").expect(409);
    await get("/organization-context").expect(409);
    await update(a.id, { name: "not selected" }).expect(409);
    await select(b.id).expect(403);
    await select(randomUUID()).expect(403);
    await select(a.id, rawMember).expect(403);
    await select(a.id, rawMaster).expect(401);
    await select(a.id, "").expect(401);
    await request(f.app.getHttpServer())
      .post("/v1/organization-context")
      .set("Cookie", `login_session=${rawA}`)
      .set("Origin", "https://foreign.invalid")
      .send({ organizationId: a.id })
      .expect(403);
    await request(f.app.getHttpServer())
      .post("/v1/organization-context")
      .set("Cookie", `login_session=${rawA}`)
      .set("Origin", f.c.FRONTEND_ORIGIN)
      .send({ organizationId: a.id, master: true })
      .expect(400);
    await select(a.id).expect(200);
    await select(b.id, rawB).expect(200);
    await update(a.id, { name: "Organização A atual" }).expect(200);
    await update(b.id, { name: "Organização B atual" }, rawB).expect(200);
    // Body spoofing is rejected; an unauthorized target never becomes an event's origin.
    await update(a.id, { name: "forged", organizationId: b.id }).expect(400);
    await update(b.id, { name: "forged" }).expect(403);
    await update(a.id, { active: false }).expect(403);
    await f.work.run((tx) => tx.audit.append({ action: "auth.login_failed" }));
    const rows = await f.db.auditEvent.findMany();
    const eventA = rows.find(
      (r) =>
        r.action === "organization.updated" &&
        auditDetails(r, f.auth.vault).organizationId === a.id,
    )!;
    const eventB = rows.find(
      (r) =>
        r.action === "organization.updated" &&
        auditDetails(r, f.auth.vault).organizationId === b.id,
    )!;
    const global = rows.find((r) => r.action === "auth.login_failed")!;
    const denied = rows
      .filter((r) => r.action === "administration.denied")
      .map((r) => auditDetails(r, f.auth.vault).organizationId);
    assert.deepEqual(denied.sort(), [null, a.id].sort());
    // Historic unscoped events stay unscoped after indexing, even for an actor now linked to A.
    await f.work.run((tx) =>
      tx.audit.append({
        action: "account.updated",
        actorId: adminA.id,
        metadata: { fields: [] },
      }),
    );
    await f.db.auditEvent.updateMany({ data: { organizationIndex: null } });
    await backfillAuditOrganizations(f.db, f.auth.vault);
    const access = await get("/audit/access").expect(200);
    assert.deepEqual(access.body, { organization: "Organização A atual" });
    const pinned = (
      await f.db.session.findUniqueOrThrow({ where: { digest: digest(rawA) } })
    ).activeOrganization!;
    assert.ok(!pinned.includes(a.id));
    assert.equal(
      f.auth.vault.decrypt(pinned, `organization-session:${digest(rawA)}`),
      a.id,
    );
    const list = (await get("/audit?pageSize=1").expect(200)).body;
    assert.equal(list.total, 2);
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].organization, "Organização A atual");
    const second = (await get("/audit?page=2&pageSize=1").expect(200)).body;
    assert.notEqual(list.items[0].id, second.items[0].id);
    const filtered = (
      await get(
        "/audit?action=organization.updated&outcome=success&from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z",
      ).expect(200)
    ).body;
    assert.deepEqual(
      filtered.items.map((r: { id: string }) => r.id),
      [eventA.id],
    );
    assert.equal(
      (await get("/audit?action=auth.login_failed").expect(200)).body.total,
      0,
    );
    const detail = (await get(`/audit/${eventA.id}`).expect(200)).body;
    await get(`/audit/${eventB.id}`).expect(404);
    // The blind index is not trusted as an authorization assertion on its own.
    await f.db.auditEvent.update({
      where: { id: eventB.id },
      data: {
        organizationIndex: f.auth.vault.index(a.id, "audit-organization"),
      },
    });
    const corrupted = await get(`/audit/${eventB.id}`).expect(500);
    assert.ok(!JSON.stringify(corrupted.body).includes("Organização B"));
    await f.db.auditEvent.update({
      where: { id: eventB.id },
      data: {
        organizationIndex: f.auth.vault.index(b.id, "audit-organization"),
      },
    });

    await get(`/audit/${global.id}`).expect(404);
    await get(`/audit/${randomUUID()}`).expect(404);
    for (const id of [a.id, b.id, randomUUID(), ""]) {
      await get(`/audit?organizationId=${id}`).expect(400);
      await get(`/audit/${eventA.id}?organizationId=${id}`).expect(400);
      assert.deepEqual(
        (await get(`/audit/access?organizationId=${id}`).expect(200)).body,
        access.body,
      );
    }
    const forged = (
      await get("/audit").set("X-Organization-Id", b.id).expect(200)
    ).body;
    assert.equal(forged.total, 2);
    await get("/admin/audit", rawA).expect(401);
    await get("/admin/audit/organizations", rawA).expect(401);
    const all = (await get("/admin/audit", rawMaster).expect(200)).body;
    assert.equal(all.total, rows.length + 1);
    assert.equal(
      (await get(`/admin/audit?organizationId=${a.id}`, rawMaster).expect(200))
        .body.total,
      2,
    );
    await get(`/admin/audit/${eventB.id}`, rawMaster).expect(200);
    const service = f.app.get(QueryAudit);
    assert.deepEqual(
      await service.listOrganization(rawA, { organizationId: b.id }),
      { invalid: true },
    );
    for (const [raw, status] of [
      ["", 401],
      [rawMember, 403],
      [rawMaster, 401],
      [await session(adminA.id, "password"), 401],
    ] as const) {
      for (const path of ["/audit", "/audit/access", `/audit/${eventA.id}`])
        await get(path, raw).expect(status);
    }
    const output = JSON.stringify([
      access.body,
      list,
      second,
      filtered,
      detail,
    ]);
    for (const secret of [
      a.id,
      b.id,
      adminA.id,
      adminB.id,
      rawA,
      pinned,
      eventA.details,
      "@example.invalid",
      "organizationIndex",
      "organizationId",
      "auditOrganization",
    ])
      assert.ok(!output.includes(secret));
    // Revocation clears the prior selection; restoring a role never selects implicitly.
    await f.db.organization.update({
      where: { id: a.id },
      data: { active: false },
    });
    await get("/audit").expect(403);
    await get(`/audit/${eventA.id}`).expect(409);
    await select(a.id).expect(403);
    assert.equal(
      (
        await f.db.session.findUniqueOrThrow({
          where: { digest: digest(rawA) },
        })
      ).activeOrganization,
      null,
    );
    await f.db.organization.update({
      where: { id: a.id },
      data: { active: true },
    });
    await get("/audit").expect(409);
    await select(a.id).expect(200);
    await f.db.organizationMember.update({
      where: {
        organizationId_userId: { organizationId: a.id, userId: adminA.id },
      },
      data: { role: "MEMBER" },
    });
    await get("/audit").expect(403);
    await select(a.id).expect(403);
    await f.db.organizationMember.update({
      where: {
        organizationId_userId: { organizationId: a.id, userId: adminA.id },
      },
      data: { role: "ORGANIZATION_ADMIN" },
    });
    await f.db.organizationMember.create({
      data: {
        organizationId: b.id,
        userId: adminA.id,
        role: "ORGANIZATION_ADMIN",
      },
    });
    await get("/audit").expect(409);
    await select(a.id).expect(200);
    await update(b.id, { name: "wrong active context" }).expect(409);
    await get(`/audit?organizationId=${b.id}`).expect(400);
    assert.equal((await get("/audit").expect(200)).body.total, 2);
    // Only the explicit POST changes context; query/header hints do not.
    assert.equal(
      (
        await get(`/organization-context?organizationId=${b.id}`)
          .set("X-Organization-Id", b.id)
          .expect(200)
      ).body.organizationId,
      a.id,
    );
    await select(b.id).expect(200);
    assert.equal((await get("/audit").expect(200)).body.items[0].id, eventB.id);
    await get(`/audit/${eventA.id}`).expect(404);
    await get(`/audit/${eventB.id}`).expect(200);
    const newSession = await session(adminA.id);
    await get("/audit", newSession).expect(409);
    // The deprecated implicit context is deliberately ignored after migration.
    await f.db.session.update({
      where: { digest: digest(newSession) },
      data: { auditOrganization: pinned },
    });
    await get("/audit", newSession).expect(409);
    await select(a.id, newSession).expect(200);
    await f.db.session.update({
      where: { digest: digest(newSession) },
      data: { activeOrganization: pinned },
    });
    await get("/audit", newSession).expect(403);
    await f.db.organizationMember.update({
      where: {
        organizationId_userId: { organizationId: b.id, userId: adminA.id },
      },
      data: { deletedAt: new Date() },
    });
    await get("/audit").expect(403);
    await select(b.id).expect(403);
    await f.db.session.delete({ where: { digest: digest(rawA) } });
    await get("/audit").expect(401);
  },
);
