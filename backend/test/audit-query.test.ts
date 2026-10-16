import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { fixture } from "./helpers";
import { digest, token } from "../src/infra/security/crypto";
import { QueryAudit } from "../src/application/audit/query-audit";
import { AuditEvent } from "../src/application/audit/events";

test(
  "Master audit query: authorization, bounded pagination, filters, safe projections and authenticated details",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(15453);
    t.after(() => f.close());
    const master = await f.db.user.findFirstOrThrow({
      where: { master: true },
    });
    await f.db.user.update({
      where: { id: master.id },
      data: { totpVerified: true, mustChangePassword: false },
    });
    const member = await f.db.user.create({
      data: {
        username: f.auth.vault.encrypt("Nome atual", "username"),
        email: f.auth.vault.encrypt("private@example.invalid", "email"),
        usernameIndex: "query-user",
        emailIndex: "query-user",
        passwordHash: "private-password-hash",
      },
    });
    const org = await f.db.organization.create({
      data: { name: "Organização atual" },
    });
    await f.db.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: org.id,
        role: "ORGANIZATION_ADMIN",
      },
    });
    async function session(userId: string, stage = "full", expired = false) {
      const raw = token();
      await f.db.session.create({
        data: {
          digest: digest(raw),
          userId,
          stage,
          expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)),
        },
      });
      return raw;
    }
    const raw = await session(master.id),
      common = await session(member.id);
    const get = (path: string, session = raw) =>
      request(f.app.getHttpServer())
        .get(`/v1/admin/audit${path}`)
        .set("Cookie", `login_session=${session}`);
    const instant = new Date("2026-01-02T12:00:00.000Z");
    async function record(event: AuditEvent) {
      await f.work.run((tx) =>
        tx.audit.append({ occurredAt: instant, ...event }),
      );
    }
    for (let n = 0; n < 12; n++)
      await record({
        action: "account.updated",
        actorId: member.id,
        resourceId: member.id,
        organizationId: org.id,
        metadata: { fields: ["username"] },
      });
    await record({ action: "auth.login_failed" });
    await record({
      action: "organization.deleted",
      actorId: randomUUID(),
      organizationId: randomUUID(),
      resourceId: randomUUID(),
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const stored = await f.db.auditEvent.findMany({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    });
    const eventId = stored.find((r) => r.action === "account.updated")!.id;
    const service = f.app.get(QueryAudit);
    let reads = 0;
    const decrypt = f.auth.vault.decrypt.bind(f.auth.vault);
    const spy = t.mock.method(
      f.auth.vault,
      "decrypt",
      (...args: Parameters<typeof decrypt>) => {
        reads++;
        return decrypt(...args);
      },
    );
    try {
      for (const denied of [
        "",
        common,
        await session(master.id, "mfa"),
        await session(master.id, "full", true),
      ]) {
        for (const path of [
          "",
          `/${eventId}`,
          "?master=true&actorId=forged&organizationId=forged",
          `/${eventId}?role=MASTER`,
        ])
          await get(path, denied).expect(401);
      }
      // Case-insensitive router matches still hit the same Master-only use case.
      await request(f.app.getHttpServer())
        .get(`/v1/ADMIN/AUDIT/${eventId}`)
        .set("Cookie", `login_session=${common}`)
        .expect(401);
      await f.db.organizationMember.update({
        where: {
          organizationId_userId: { organizationId: org.id, userId: member.id },
        },
        data: { role: "MEMBER" },
      });
      await get("", common).expect(401);
      assert.equal(await service.list(common, {}), null);
      assert.equal(
        reads,
        0,
        "unauthorized queries must not decrypt any event or identity",
      );
      for (const bad of [
        "?page=0",
        "?page=1.5",
        "?page=1000001",
        "?pageSize=101",
        "?pageSize=-1",
        "?pageSize=1&pageSize=2",
        "?from=not-a-date",
        "?from=2026-01-01",
        "?from=2026-02-30T00:00:00Z",
        "?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z",
        "?action=unknown",
        "?outcome=anything",
        `?actorId=${member.id}`,
        `?organizationId=${org.id}`,
        "?master=true",
      ])
        await get(bad).expect(400);
      assert.equal(reads, 0);
      const first = await get("?pageSize=5").expect(200);
      assert.equal(first.headers["cache-control"], "no-store");
      assert.equal(first.body.total, 14);
      assert.equal(first.body.items.length, 5);
      assert.deepEqual(
        first.body.items.map((i: { id: string }) => i.id),
        stored.slice(0, 5).map((i) => i.id),
      );
      assert.ok(
        reads <= 6,
        "decrypt only the page and its distinct user references",
      );
      const second = await get("?page=2&pageSize=5").expect(200);
      assert.deepEqual(
        second.body.items.map((i: { id: string }) => i.id),
        stored.slice(5, 10).map((i) => i.id),
      );
      assert.equal(
        (await get("?page=100&pageSize=5").expect(200)).body.items.length,
        0,
      );
      const failed = (await get("?outcome=failure").expect(200)).body;
      assert.equal(failed.total, 1);
      assert.equal(failed.items[0].actor, "Sistema ou ator não identificado");
      assert.equal(failed.items[0].organization, null);
      const failedDetail = (await get(`/${failed.items[0].id}`).expect(200))
        .body;
      assert.deepEqual(failedDetail.metadata, []);
      const anonymousRow = stored.find((row) => row.id === failed.items[0].id)!;
      const anonymousPurpose = JSON.stringify([
        "audit:v1",
        anonymousRow.id,
        anonymousRow.occurredAt.toISOString(),
        anonymousRow.action,
        anonymousRow.outcome,
        anonymousRow.resourceType,
      ]);
      await f.db.auditEvent.update({
        where: { id: anonymousRow.id },
        data: {
          details: f.auth.vault.encrypt(
            JSON.stringify({
              actorId: null,
              organizationId: null,
              resourceId: null,
            }),
            anonymousPurpose,
          ),
        },
      });
      assert.deepEqual(
        (await get(`/${anonymousRow.id}`).expect(200)).body.metadata,
        [],
      );
      const filtered = (
        await get(
          "?action=account.updated&from=2026-01-02T12%3A00%3A00.000Z&to=2026-01-02T12%3A00%3A00.000Z",
        ).expect(200)
      ).body;
      assert.equal(filtered.total, 12);
      const detail = (await get(`/${eventId}`).expect(200)).body;
      assert.equal(detail.actor, "Nome atual");
      assert.equal(detail.organization, "Organização atual");
      assert.equal(detail.resource, "Conta: Nome atual");
      assert.deepEqual(detail.metadata, [
        { label: "Campos alterados", value: "Usuário" },
      ]);
      assert.deepEqual(
        Object.keys(detail).sort(),
        [
          "id",
          "occurredAt",
          "action",
          "actionLabel",
          "outcome",
          "actor",
          "organization",
          "resource",
          "resourceType",
          "metadata",
        ].sort(),
      );
      const output = JSON.stringify([
        first.body,
        second.body,
        detail,
        failedDetail,
      ]);
      for (const sensitive of [
        member.id,
        master.id,
        org.id,
        "private@example.invalid",
        "private-password-hash",
        "actorId",
        "organizationId",
        "resourceId",
        '"details"',
        stored[0].details,
        raw,
      ])
        assert.ok(!output.includes(sensitive), sensitive);
      assert.ok(!("metadata" in first.body.items[0]));
      await f.db.user.update({
        where: { id: member.id },
        data: { username: f.auth.vault.encrypt("Nome alterado", "username") },
      });
      assert.equal(
        (await get(`/${eventId}`).expect(200)).body.actor,
        "Nome alterado",
      );
      const missing = (await get(`/${stored.at(-1)!.id}`).expect(200)).body;
      assert.equal(missing.actor, "Conta não disponível");
      assert.equal(missing.organization, "Organização não disponível");
      await get(`/${eventId}?actorId=forged`).expect(400);
      await get(`/${randomUUID()}`).expect(404);
      await get("/invalid").expect(404);

      // Corrupt old ciphertext must not break another page or leak via the detail error.
      const old = stored.at(-1)!;
      await f.db.auditEvent.update({
        where: { id: old.id },
        data: { details: "private-malformed-ciphertext" },
      });
      await get("?pageSize=5").expect(200);
      const bad = await get(`/${old.id}`).expect(500);
      assert.ok(!JSON.stringify(bad.body).includes("private"));
      // Even authenticated ciphertext cannot smuggle unknown metadata into the response.
      const row = stored.find((r) => r.id === eventId)!;
      const purpose = JSON.stringify([
        "audit:v1",
        row.id,
        row.occurredAt.toISOString(),
        row.action,
        row.outcome,
        row.resourceType,
      ]);
      await f.db.auditEvent.update({
        where: { id: eventId },
        data: {
          details: f.auth.vault.encrypt(
            JSON.stringify({
              actorId: member.id,
              organizationId: org.id,
              resourceId: member.id,
              metadata: { fields: ["username"], token: "private-token" },
            }),
            purpose,
          ),
        },
      });
      const rejected = await get(`/${eventId}`).expect(500);
      assert.ok(!JSON.stringify(rejected.body).includes("private-token"));
      await f.db.session.delete({ where: { digest: digest(raw) } });
      await get(`/${eventId}`).expect(401);
    } finally {
      spy.mock.restore();
    }
  },
);
