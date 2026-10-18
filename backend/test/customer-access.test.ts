import { readFileSync } from "node:fs";
import { Pool } from "pg";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { fixture } from "./helpers";
import {
  CustomerAccess,
  CustomerError,
  customerTokenContext,
} from "../src/application/customers/customer-access";
import { CustomerTransaction } from "../src/application/customers/ports";
import { UnitOfWork } from "../src/application/auth/ports/repositories";
import { ProtectedInvitationSecrets } from "../src/infra/security/invitation-secrets";
import { secureTokens, totpAdapter, totp } from "../src/infra/security/crypto";
import { DeliverCustomerEmail } from "../src/application/customers/deliver-customer-email";
import { QueryAudit } from "../src/application/audit/query-audit";

test("customer identity, organization isolation, one-use capabilities, MFA and HTTP boundaries", async (t) => {
  const f = await fixture(15465);
  try {
    await t.test(
      "empty-schema corrective reversal is transactional and preserves migration history",
      async () => {
        const pool = new Pool({ connectionString: f.c.DATABASE_URL });
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            readFileSync("prisma/rollback/customer-access.sql", "utf8"),
          );
          assert.equal(
            (
              await client.query(
                `SELECT to_regclass('public."Customer"') AS name`,
              )
            ).rows[0].name,
            null,
          );
          assert.ok(
            (
              await client.query(
                'SELECT COUNT(*)::int AS count FROM "_prisma_migrations"',
              )
            ).rows[0].count > 0,
          );
        } finally {
          await client.query("ROLLBACK");
          client.release();
          await pool.end();
        }
        assert.equal(await f.db.customer.count(), 0);
      },
    );
    const jobs: { invitationId: string; encryptedToken: string }[] = [];
    const secrets = new ProtectedInvitationSecrets(
      f.auth.vault,
      "customer-access.v1",
    );
    const customers = new CustomerAccess(
      f.work as UnitOfWork<CustomerTransaction>,
      f.auth.sessions,
      f.auth.vault,
      f.auth.passwords,
      secureTokens,
      totpAdapter,
      f.auth.rates,
      secrets,
      {
        publish: async (job) => {
          jobs.push(job);
        },
      },
    );
    const password = "customer fixture long password";
    const passwordHash = await f.auth.passwords.hash(password);
    const orgA = await f.db.organization.create({ data: { name: "A" } }),
      orgB = await f.db.organization.create({ data: { name: "B" } });
    async function actor(org: string, role: "ORGANIZATION_ADMIN" | "MEMBER") {
      const id = randomUUID();
      await f.db.user.create({
        data: {
          id,
          username: f.auth.vault.encrypt(id, "username"),
          email: f.auth.vault.encrypt(`${id}@example.invalid`, "email"),
          usernameIndex: f.auth.vault.index(id),
          emailIndex: f.auth.vault.index(`${id}@example.invalid`),
          passwordHash,
          memberships: { create: { organizationId: org, role } },
        },
      });
      const session = await f.work.run((tx) =>
        f.auth.sessions.createSession(tx, id, "full"),
      );
      return { id, raw: session.raw };
    }
    const a = await actor(orgA.id, "ORGANIZATION_ADMIN"),
      b = await actor(orgB.id, "ORGANIZATION_ADMIN"),
      member = await actor(orgA.id, "MEMBER");
    const master = await f.db.user.findFirstOrThrow({
      where: { master: true },
    });
    await f.db.user.update({
      where: { id: master.id },
      data: {
        mustChangePassword: false,
        totpVerified: true,
        totpSecret: f.auth.vault.encrypt(totp().secret.base32, "totp"),
      },
    });
    const ms = await f.work.run((tx) =>
      f.auth.sessions.createSession(tx, master.id, "full"),
    );
    const platform = await actor(orgB.id, "MEMBER");
    await f.db.organizationMember.deleteMany({
      where: { userId: platform.id },
    });
    await f.db.platformAdmin.create({
      data: {
        userId: platform.id,
        permissions: ["audit.read", "organizations.read"],
      },
    });
    const capability = async (job = jobs[jobs.length - 1]) => {
      const row = await f.db.customerToken.findUniqueOrThrow({
        where: { id: job.invitationId },
      });
      return `${row.id}.${secrets.decrypt(job.encryptedToken, customerTokenContext(row))}`;
    };
    const fails = (work: Promise<unknown>, status: number) =>
      assert.rejects(
        work,
        (e: unknown) => e instanceof CustomerError && e.status === status,
      );
    let id = "",
      raw = "",
      recovery: string[] = [],
      secret = "";
    await t.test(
      "administrators have no implicit global access; members need precise grants",
      async () => {
        await fails(customers.list(ms.raw, {}), 401);
        await fails(customers.list(platform.raw, {}), 401);
        await fails(customers.list(member.raw, {}), 403);
        await fails(
          customers.invite(a.raw, {
            email: "one@example.invalid",
            organizationId: orgB.id,
          }),
          400,
        );
        await customers.invite(a.raw, { email: " One@Example.Invalid " });
        id = (await customers.list(a.raw, {})).items[0].id;
        assert.equal((await customers.list(b.raw, {})).total, 0);
        await fails(customers.detail(b.raw, id, {}), 404);
        await fails(customers.cancel(b.raw, id, {}), 404);
        await fails(customers.invite(b.raw, {}, id), 404);
        await fails(customers.status(b.raw, id, { status: "suspended" }), 404);
        await fails(customers.list(a.raw, { organizationId: orgB.id }), 400);
        await fails(
          customers.invite(b.raw, { email: "one@example.invalid" }),
          409,
        );
        assert.equal(
          (
            await f.db.customer.findUniqueOrThrow({ where: { id } })
          ).email.includes("one@"),
          false,
        );
        const stored = await f.db.customer.findUniqueOrThrow({ where: { id } });
        await assert.rejects(
          f.db.customer.create({
            data: { ...stored, id: randomUUID(), organizationId: orgB.id },
          }),
        );
        await f.db.organizationPermissionGrant.create({
          data: {
            organizationId: orgA.id,
            role: "MEMBER",
            permission: "CUSTOMERS_READ",
          },
        });
        assert.equal((await customers.list(member.raw, {})).total, 1);
        const pool = new Pool({ connectionString: f.c.DATABASE_URL });
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await assert.rejects(
            client.query(
              readFileSync("prisma/rollback/customer-access.sql", "utf8"),
            ),
            /CUSTOMER_ROLLBACK_REQUIRES_DATA_PRESERVATION_PLAN/,
          );
        } finally {
          await client.query("ROLLBACK");
          client.release();
          await pool.end();
        }
        assert.equal(await f.db.customer.count(), 1);

        await fails(
          customers.invite(member.raw, { email: "no@example.invalid" }),
          403,
        );
      },
    );
    await t.test(
      "delivery is protected, invitation consumed atomically, no implicit session",
      async () => {
        let delivered = "";
        const delivery = new DeliverCustomerEmail(
          f.work as UnitOfWork<CustomerTransaction>,
          f.auth.vault,
          secrets,
          {
            send: async (message) => {
              delivered = message.text;
              return { accepted: true };
            },
          },
          f.c.FRONTEND_ORIGIN,
        );
        assert.deepEqual(await delivery.execute(jobs[0]), { accepted: true });
        assert.match(delivered, /customer\/accept#token=/);
        assert.deepEqual(await delivery.execute(jobs[0]), { ignored: true });
        const token = await capability();
        const results = await Promise.allSettled([
          customers.accept({
            token,
            name: "Customer",
            password,
            confirmPassword: password,
          }),
          customers.accept({
            token,
            name: "Customer",
            password,
            confirmPassword: password,
          }),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(await f.db.customerSession.count(), 0);
        await fails(
          customers.accept({
            token,
            name: "Customer",
            password,
            confirmPassword: password,
          }),
          400,
        );
        raw = (
          await customers.login(
            { email: "one@example.invalid", password },
            "test",
          )
        ).raw;
        assert.equal((await customers.profile(raw, {})).name, "Customer");
        await fails(customers.profile(raw, { id: randomUUID() }), 400);
        await fails(
          customers.update(raw, { name: "X", organizationId: orgB.id }),
          400,
        );
        assert.equal(await f.auth.sessions.authorized(raw), null);
        await fails(customers.profile(a.raw, {}), 401);
      },
    );
    await t.test(
      "HTTP cookies, CSRF, strict inputs and namespace separation",
      async () => {
        const server = f.app.getHttpServer();
        const login = await request(server)
          .post("/v1/customer/login")
          .set("Origin", f.c.FRONTEND_ORIGIN)
          .send({ email: "one@example.invalid", password });
        assert.equal(login.status, 200);
        assert.equal(login.body.raw, undefined);
        assert.equal(login.body.stage, "full");
        assert.match(
          String(login.headers["set-cookie"]),
          /customer_session=.*Path=\/v1\/customer;.*HttpOnly;.*SameSite=Lax/,
        );
        const cookie = `customer_session=${raw}`;
        assert.equal(
          (
            await request(server)
              .get("/v1/customer/account")
              .set("Cookie", cookie)
          ).status,
          200,
        );
        assert.equal(
          (
            await request(server)
              .get("/v1/welcome")
              .set("Cookie", `login_session=${raw}`)
          ).status,
          401,
        );
        assert.equal(
          (
            await request(server)
              .get("/v1/customer/account")
              .set("Cookie", `customer_session=${a.raw}`)
          ).status,
          401,
        );
        assert.equal(
          (
            await request(server)
              .get("/v1/organization-customers")
              .set("Cookie", `login_session=${ms.raw}`)
          ).status,
          401,
        );
        assert.equal(
          (
            await request(server)
              .get("/v1/admin/organization-customers")
              .set("Cookie", `login_session=${ms.raw}`)
          ).status >= 400,
          true,
        );
        assert.equal(
          (
            await request(server)
              .post("/v1/customer/account")
              .set("Cookie", cookie)
              .send({ name: "CSRF" })
          ).status,
          403,
        );
        assert.equal(
          (
            await request(server)
              .post("/v1/customer/account")
              .set("Origin", f.c.FRONTEND_ORIGIN)
              .set("Cookie", cookie)
              .send({ name: "safe", customerId: id })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "MFA enrollment confirms first; rotation, replay and concurrent recovery",
      async () => {
        secret = (await customers.setup(raw, { password })).secret;
        assert.equal((await customers.profile(raw, {})).mfaEnabled, false);
        const enrolled = await customers.enroll(raw, {
          code: totp(secret).generate(),
        });
        recovery = enrolled.recoveryCodes;
        const previous = raw;
        raw = enrolled.raw;
        await fails(customers.profile(previous, {}), 401);
        assert.equal((await customers.profile(raw, {})).mfaEnabled, true);
        const pending = await customers.login(
          { email: "one@example.invalid", password },
          "test",
        );
        assert.equal(pending.stage, "mfa");
        await fails(customers.profile(pending.raw, {}), 401);
        await fails(
          customers.mfa(pending.raw, { code: totp(secret).generate() }),
          401,
        );
        const pending2 = await customers.login(
          { email: "one@example.invalid", password },
          "test",
        );
        const results = await Promise.allSettled([
          customers.mfa(pending.raw, { code: recovery[0] }),
          customers.mfa(pending2.raw, { code: recovery[0] }),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(
          await f.db.customerRecoveryCode.count({ where: { customerId: id } }),
          9,
        );
        await fails(customers.disable(raw, { password, code: "000000" }), 401);
      },
    );
    await t.test(
      "reset is generic, one-use, preserves MFA and revokes every session",
      async () => {
        const unknown = await customers.requestReset({
          email: "unknown@example.invalid",
        });
        assert.deepEqual(
          await customers.requestReset({ email: "one@example.invalid" }),
          unknown,
        );
        const token = await capability(),
          newPassword = "replacement fixture password";
        const results = await Promise.allSettled([
          customers.reset({
            token,
            password: newPassword,
            confirmPassword: newPassword,
          }),
          customers.reset({
            token,
            password: newPassword,
            confirmPassword: newPassword,
          }),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(
          await f.db.customerSession.count({ where: { customerId: id } }),
          0,
        );
        const c = await f.db.customer.findUniqueOrThrow({ where: { id } });
        assert.ok(c.totpSecret);
        assert.equal(
          await f.db.customerRecoveryCode.count({ where: { customerId: id } }),
          9,
        );
        await fails(customers.profile(raw, {}), 401);
        const pending = await customers.login(
          { email: "one@example.invalid", password: newPassword },
          "test",
        );
        assert.equal(pending.stage, "mfa");
        raw = (await customers.mfa(pending.raw, { code: recovery[1] })).raw;
      },
    );
    await t.test(
      "state checked on every operation; own sessions only; audit excluded globally",
      async () => {
        await customers.invite(b.raw, { email: "two@example.invalid" });
        const token = await capability();
        await customers.accept({
          token,
          name: "Two",
          password,
          confirmPassword: password,
        });
        const two = await customers.login(
          { email: "two@example.invalid", password },
          "test",
        );
        const session = (await customers.listSessions(two.raw, {})).items[0];
        await customers.revokeSession(raw, { id: session.id });
        assert.equal((await customers.profile(two.raw, {})).name, "Two");
        await customers.status(a.raw, id, { status: "suspended" });
        await fails(customers.profile(raw, {}), 401);
        await customers.status(a.raw, id, { status: "active" });
        await fails(customers.profile(raw, {}), 401);
        await f.db.organization.update({
          where: { id: orgB.id },
          data: { active: false },
        });
        await fails(customers.profile(two.raw, {}), 401);
        await fails(customers.list(b.raw, {}), 403);
        const audit = f.app.get(QueryAudit),
          row = await f.db.auditEvent.findFirstOrThrow({
            where: { resourceType: "customer" },
          });
        const global = await audit.list(ms.raw, {
          pageSize: "100",
          organizationId: orgA.id,
        });
        assert.ok(global && "items" in global);
        assert.equal(
          global.items.some((e) => e.action.startsWith("customer.")),
          false,
        );
        assert.deepEqual(await audit.read(ms.raw, row.id), { missing: true });
        assert.deepEqual(await audit.readOrganization(b.raw, row.id), {
          forbidden: true,
        });
        const organizationAudit = await audit.listOrganization(a.raw, {
          pageSize: "100",
        });
        assert.ok(organizationAudit && "items" in organizationAudit);
        assert.ok(
          organizationAudit.items.some((e) => e.action.startsWith("customer.")),
        );
        const stored = await f.db.auditEvent.findMany({
          where: { resourceType: "customer" },
        });
        for (const event of stored) {
          assert.equal(
            JSON.stringify(event).includes("one@example.invalid"),
            false,
          );
          assert.equal(JSON.stringify(event).includes(recovery[0]), false);
        }
      },
    );
    await t.test(
      "concurrent email uniqueness, invalid attempts, expiry and audit rollback",
      async () => {
        await f.db.organization.update({
          where: { id: orgB.id },
          data: { active: true },
        });
        const attempts = await Promise.allSettled([
          customers.invite(a.raw, { email: "race@example.invalid" }),
          customers.invite(b.raw, { email: "RACE@example.invalid" }),
        ]);
        assert.equal(
          attempts.filter((r) => r.status === "fulfilled").length,
          1,
        );
        assert.equal(
          await f.db.customer.count({
            where: {
              emailIndex: f.auth.vault.index(
                "race@example.invalid",
                "customer-email",
              ),
            },
          }),
          1,
        );
        const correct = await capability();
        const [tokenId] = correct.split(".");
        for (let n = 0; n < 5; n++)
          await fails(
            customers.accept({
              token: `${tokenId}.${secureTokens.generate()}`,
              name: "Guess",
              password,
              confirmPassword: password,
            }),
            400,
          );
        const locked = await f.db.customerToken.findUniqueOrThrow({
          where: { id: tokenId },
        });
        assert.equal(locked.attempts, 5);
        assert.ok(locked.revokedAt);
        await fails(
          customers.accept({
            token: correct,
            name: "Revoked",
            password,
            confirmPassword: password,
          }),
          400,
        );
        await f.db.rateState.deleteMany({
          where: { key: { startsWith: "customer-reset:" } },
        });
        await customers.requestReset({ email: "two@example.invalid" });
        const reset = await capability();
        await f.db.customerToken.update({
          where: { id: reset.split(".")[0] },
          data: { expiresAt: new Date(0) },
        });
        await fails(
          customers.reset({
            token: reset,
            password,
            confirmPassword: password,
          }),
          400,
        );
        const two = await customers.login(
          { email: "two@example.invalid", password },
          "test",
        );
        const twoId = (await customers.profile(two.raw, {})).id;
        await f.db.$executeRawUnsafe(
          `CREATE FUNCTION fail_customer_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'customer.suspended' THEN RAISE EXCEPTION 'FIXTURE'; END IF; RETURN NEW; END $$`,
        );
        await f.db.$executeRawUnsafe(
          `CREATE TRIGGER fail_customer_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION fail_customer_audit()`,
        );
        await assert.rejects(
          customers.status(b.raw, twoId, { status: "suspended" }),
        );
        assert.equal((await customers.profile(two.raw, {})).status, "active");
        await f.db.$executeRawUnsafe(
          `DROP TRIGGER fail_customer_audit ON "AuditEvent"`,
        );
        await f.db.$executeRawUnsafe(`DROP FUNCTION fail_customer_audit()`);
        await f.db.customerSession.updateMany({
          where: { customerId: twoId },
          data: { expiresAt: new Date(0) },
        });
        await fails(customers.profile(two.raw, {}), 401);
        await f.db.organization.update({
          where: { id: orgB.id },
          data: { active: false, deletedAt: new Date() },
        });
        await fails(
          customers.login({ email: "two@example.invalid", password }, "test"),
          401,
        );
      },
    );
    await t.test(
      "expired and cancelled invitations/reset links reject and queue failure compensates",
      async () => {
        await customers.invite(a.raw, { email: "expire@example.invalid" });
        const old = await capability();
        const row = await f.db.customerToken.findUniqueOrThrow({
          where: { id: jobs[jobs.length - 1].invitationId },
        });
        await f.db.customerToken.update({
          where: { id: row.id },
          data: { expiresAt: new Date(0) },
        });
        await fails(
          customers.accept({
            token: old,
            name: "Expired",
            password,
            confirmPassword: password,
          }),
          400,
        );
        await f.db.rateState.deleteMany({
          where: { key: { contains: row.customerId } },
        });
        await customers.invite(a.raw, {}, row.customerId);
        const replacement = await capability();
        await fails(
          customers.accept({
            token: old,
            name: "Old",
            password,
            confirmPassword: password,
          }),
          400,
        );
        await customers.cancel(a.raw, row.customerId, {});
        await fails(
          customers.accept({
            token: replacement,
            name: "Cancelled",
            password,
            confirmPassword: password,
          }),
          400,
        );
        // Real registered service has delivery disabled in the fixture.
        await fails(
          f.app
            .get(CustomerAccess)
            .invite(a.raw, { email: "queue-failure@example.invalid" }),
          503,
        );
        const c = await f.db.customer.findUniqueOrThrow({
          where: {
            emailIndex: f.auth.vault.index(
              "queue-failure@example.invalid",
              "customer-email",
            ),
          },
        });
        assert.ok(
          (
            await f.db.customerToken.findFirstOrThrow({
              where: { customerId: c.id },
            })
          ).revokedAt,
        );
      },
    );
  } finally {
    await f.close();
  }
});
