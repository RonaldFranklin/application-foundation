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
  "organization audit derives and pins scope; filters, details and writes cannot cross organizations",
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
    ).auditOrganization!;
    assert.ok(!pinned.includes(a.id));
    assert.equal(
      f.auth.vault.decrypt(pinned, `audit-session:${digest(rawA)}`),
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
    // Losing roles or organization availability revokes list and details immediately.
    for (const data of [
      { active: false },
      { active: false, deletedAt: new Date() },
    ]) {
      await f.db.organization.update({ where: { id: a.id }, data });
      await get("/audit").expect(403);
      await get(`/audit/${eventA.id}`).expect(403);
    }
    await f.db.organization.update({
      where: { id: a.id },
      data: { active: true, deletedAt: null },
    });
    await f.db.organizationMember.update({
      where: {
        organizationId_userId: { organizationId: a.id, userId: adminA.id },
      },
      data: { role: "MEMBER" },
    });
    await get("/audit").expect(403);
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
    await get("/audit").expect(403); // multiple administrative memberships: no choice by URL
    await get(`/audit?organizationId=${b.id}`).expect(403);
    const ambiguous = await session(adminA.id);
    await get("/audit/access", ambiguous).expect(403);
    assert.equal(
      (
        await f.db.session.findUniqueOrThrow({
          where: { digest: digest(ambiguous) },
        })
      ).auditOrganization,
      null,
    );

    await f.db.organizationMember.update({
      where: {
        organizationId_userId: { organizationId: a.id, userId: adminA.id },
      },
      data: { deletedAt: new Date() },
    });
    await get("/audit").expect(403); // only B now, but this session remains bound to A
    const newSession = await session(adminA.id);
    assert.equal(
      (await get("/audit", newSession).expect(200)).body.items[0].id,
      eventB.id,
    );
    // AAD binds the context to its session; copying it cannot change scope.
    await f.db.session.update({
      where: { digest: digest(newSession) },
      data: { auditOrganization: pinned },
    });
    await get("/audit", newSession).expect(403);
    await f.db.session.delete({ where: { digest: digest(rawA) } });
    await get("/audit").expect(401);
  },
);
