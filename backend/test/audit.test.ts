import { OrganizationContext } from "../src/application/organizations/use-cases/organization-context";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { auditDetails } from "./audit.helpers";
import { validateAudit } from "../src/application/audit/events";
import { Organizations } from "../src/application/organizations/use-cases/organizations";
import { Members } from "../src/application/organizations/use-cases/members";
import { Permissions } from "../src/application/organizations/use-cases/permissions";
import { ExpireInvitations } from "../src/application/organization-invitations/expire-invitations";
import { InvitationsTransaction } from "../src/application/organization-invitations/ports";
import { UnitOfWork } from "../src/application/auth/ports/repositories";
import { AUTH_WORK } from "../src/auth/auth.tokens";
import { digest, token } from "../src/infra/security/crypto";

test("audit rejects arbitrary metadata, identifiers and payloads without echoing secrets", () => {
  const actorId = randomUUID();
  for (const event of [
    {
      action: "account.password_changed",
      actorId,
      metadata: { password: "secret" },
    },
    { action: "account.updated", actorId, metadata: { fields: ["password"] } },
    {
      action: "permissions.changed",
      actorId,
      metadata: { permissions: ["audit.read"] },
    },
    { action: "member.added", actorId, metadata: { role: "MASTER" } },
    { action: "auth.login", actorId: "personal@example.invalid" },
    { action: "custom.payload", actorId },
    { action: "auth.login", actorId, body: { secret: "secret" } },
  ])
    assert.throws(
      () => validateAudit(event as never),
      /^Error: AUDIT_INPUT_INVALID$/,
    );
});

test(
  "audit: trusted context, encrypted identifiers, administrative coverage, rollback and deduplicated expiry",
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(15452);
    t.after(() => f.close());
    const work = f.app.get<UnitOfWork<InvitationsTransaction>>(AUTH_WORK);
    const orgs = f.app.get(Organizations),
      members = f.app.get(Members),
      permissions = f.app.get(Permissions);
    const master = await f.db.user.findFirstOrThrow({
      where: { master: true },
    });
    await f.db.user.update({
      where: { id: master.id },
      data: { mustChangePassword: false, totpVerified: true },
    });
    const common = await f.db.user.create({
      data: {
        username: "unused",
        email: "unused",
        usernameIndex: "audit-user",
        emailIndex: "audit-user",
        passwordHash: "unused",
      },
    });
    async function session(userId: string) {
      const raw = token();
      await f.db.session.create({
        data: {
          digest: digest(raw),
          userId,
          stage: "full",
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      return raw;
    }
    const raw = await session(master.id),
      ordinary = await session(common.id);
    const created = await orgs.create(raw, {
      name: "Private organization name",
    });
    assert.ok(created && "id" in created);
    const id = created.id;
    await orgs.update(raw, id, { name: "Changed private name" });
    await orgs.update(raw, id, { active: false });
    await orgs.update(raw, id, { active: true });
    await orgs.setDeleted(raw, id, {}, true);
    await orgs.setDeleted(raw, id, {}, true);
    await orgs.setDeleted(raw, id, {}, false);
    await orgs.setDeleted(raw, id, {}, false);
    await f.db.organizationMember.create({
      data: { organizationId: id, userId: common.id },
    });
    await members.update(raw, id, common.id, { role: "ORGANIZATION_ADMIN" });
    await f.app
      .get(OrganizationContext)
      .select(ordinary, { organizationId: id });
    await permissions.execute(raw, id, {
      role: "MEMBER",
      permissions: ["members.read"],
    });
    // Preserve last-admin policy while exercising removal/restoration on a second member.
    const target = await f.db.user.create({
      data: {
        username: "unused2",
        email: "unused2",
        usernameIndex: "audit-user2",
        emailIndex: "audit-user2",
        passwordHash: "unused",
      },
    });
    await f.db.organizationMember.create({
      data: { organizationId: id, userId: target.id },
    });
    await members.update(raw, id, target.id, {}, true);
    await members.restore(raw, id, target.id, {});
    assert.deepEqual(
      await orgs.update(ordinary, id, { active: false }, false),
      { forbidden: true },
    );
    const foreign = await f.db.organization.create({
      data: { name: "Foreign organization" },
    });
    assert.deepEqual(
      await orgs.update(ordinary, foreign.id, { name: "Forbidden" }, false),
      { forbidden: true },
    );
    assert.equal(
      await orgs.update(ordinary, id, { name: "Wrong namespace" }, true),
      null,
    );
    assert.deepEqual(
      await orgs.update(raw, id, { name: "Spoof", actorId: target.id }),
      { invalid: true },
    );

    const rows = await f.db.auditEvent.findMany();
    for (const action of [
      "organization.created",
      "organization.updated",
      "organization.deactivated",
      "organization.reactivated",
      "organization.deleted",
      "organization.restored",
      "member.role_changed",
      "permissions.changed",
      "member.removed",
      "member.restored",
    ]) {
      const matches = rows.filter((r) => r.action === action);
      assert.equal(matches.length, 1, action);
      assert.equal(matches[0].outcome, "success");
      const details = auditDetails(matches[0], f.auth.vault);
      assert.equal(details.actorId, master.id);
      assert.equal(details.organizationId, id);
      assert.equal(
        details.resourceId,
        action.startsWith("member.")
          ? action === "member.role_changed"
            ? common.id
            : target.id
          : id,
      );
    }
    const denied = rows.filter((r) => r.action === "administration.denied");
    assert.equal(denied.length, 3);
    for (const row of denied) {
      assert.equal(row.outcome, "failure");
      assert.equal(auditDetails(row, f.auth.vault).actorId, common.id);
    }
    const stored = JSON.stringify(rows);
    for (const secret of [
      master.id,
      common.id,
      target.id,
      id,
      raw,
      ordinary,
      "Private organization",
      "Changed private",
      "passwordHash",
      "usernameIndex",
    ])
      assert.ok(!stored.includes(secret), secret);
    const first = rows[0];
    assert.throws(() =>
      auditDetails({ ...first, action: "auth.login" }, f.auth.vault),
    );
    assert.throws(() =>
      auditDetails({ ...first, id: randomUUID() }, f.auth.vault),
    );

    // Inject a database-side audit failure: operation must roll back, including organization creation.
    await f.db.$executeRawUnsafe(
      `CREATE FUNCTION audit_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`,
    );
    await f.db.$executeRawUnsafe(
      `CREATE TRIGGER audit_test_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION audit_test_failure()`,
    );
    const count = await f.db.organization.count();
    await assert.rejects(
      () => orgs.create(raw, { name: "Must roll back" }),
      /Falha de persistência/,
    );
    assert.equal(await f.db.organization.count(), count);
    await assert.rejects(
      () => orgs.update(raw, id, { name: "Must also roll back" }),
      /Falha de persistência/,
    );
    assert.equal(
      (await f.db.organization.findUniqueOrThrow({ where: { id } })).name,
      "Changed private name",
    );
    const logs: unknown[][] = [];
    const warn = t.mock.method(console, "warn", (...args: unknown[]) =>
      logs.push(args),
    );
    try {
      assert.deepEqual(
        await orgs.update(ordinary, id, { active: false }, false),
        { forbidden: true },
      );
      const failed = await f.auth.login.execute(
        false,
        { identifier: "unknown", password: "incorrect" },
        { ip: "127.0.0.1" },
      );
      assert.equal("ok" in failed && failed.ok, false);
      await work.run(async (tx) => {
        await tx.audit.bestEffort({
          action: "auth.mfa_failed",
          actorId: master.id,
          resourceId: master.id,
        });
        await tx.rates.saveHits("audit-savepoint-test", [new Date()]);
      });
      assert.ok(
        await f.db.rateState.findUnique({
          where: { key: "audit-savepoint-test" },
        }),
      );
      assert.ok(logs.length >= 3);
      assert.ok(
        logs.every(
          (args) =>
            JSON.stringify(args) ===
            JSON.stringify(['{"event":"audit_write_failed"}']),
        ),
      );
    } finally {
      warn.mock.restore();
      await f.db.$executeRawUnsafe(
        `DROP TRIGGER audit_test_failure ON "AuditEvent"`,
      );
      await f.db.$executeRawUnsafe(`DROP FUNCTION audit_test_failure()`);
    }
    // Failure after audit insertion must also roll the event back.
    const before = await f.db.auditEvent.count();
    await assert.rejects(() =>
      work.run(async (tx) => {
        await tx.audit.append({
          action: "organization.updated",
          actorId: master.id,
          organizationId: id,
          resourceId: id,
        });
        throw new Error("synthetic operation failure");
      }),
    );
    assert.equal(await f.db.auditEvent.count(), before);

    const expiry = new Date(Date.now() - 10000);
    const invitation = await f.db.organizationInvitation.create({
      data: {
        id: randomUUID(),
        organizationId: id,
        email: "unused",
        emailFingerprint: "expiry-fixture",
        role: "MEMBER",
        digest: "unused",
        createdBy: master.id,
        expiresAt: expiry,
      },
    });
    const expire = new ExpireInvitations(work);
    await Promise.all([expire.execute(), expire.execute()]);
    await expire.execute();
    const expired = await f.db.auditEvent.findMany({
      where: { action: "invitation.expired" },
    });
    assert.equal(expired.length, 1);
    assert.equal(+expired[0].occurredAt, +expiry);
    assert.deepEqual(auditDetails(expired[0], f.auth.vault), {
      actorId: null,
      organizationId: id,
      resourceId: invitation.id,
      metadata: {},
    });
    assert.ok(
      (
        await f.db.organizationInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).expiryAuditedAt,
    );
  },
);
