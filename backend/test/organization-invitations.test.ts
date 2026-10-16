import { auditDetails } from "./audit.helpers";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { Invitations } from "../src/application/organization-invitations/invitations";
import { DeliverInvitation } from "../src/application/organization-invitations/deliver-invitation";
import {
  InvitationJob,
  InvitationsTransaction,
  invitationContext,
  invitationEmailPurpose,
} from "../src/application/organization-invitations/ports";
import { ProtectedInvitationSecrets } from "../src/infra/security/invitation-secrets";
import { OrganizationAccess } from "../src/application/organizations/use-cases/organization-access";
import { UnitOfWork } from "../src/application/auth/ports/repositories";
import { AUTH_WORK } from "../src/auth/auth.tokens";
import {
  digest,
  token,
  hashPassword,
  verifyPassword,
} from "../src/infra/security/crypto";
import {
  EmailInvitationPublisher,
  INVITATION_JOB,
  invitationJobOptions,
} from "../src/infra/queues/invitation-publisher";
import { EmailProcessor } from "../src/infra/queues/email-processor";
import { DeliverEmail } from "../src/application/email/deliver-email";

test(
  "organization invitations: authorization, lifecycle, atomic acceptance and protected delivery",
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(15451);
    const replica = await createApp(f.c);
    t.after(async () => {
      await replica.close();
      await f.close();
    });
    const work = f.app.get<UnitOfWork<InvitationsTransaction>>(AUTH_WORK);
    const secrets = new ProtectedInvitationSecrets(f.auth.vault);
    const jobs: InvitationJob[] = [];
    let now = Date.now(),
      unavailable = false;
    const publisher = {
      async publish(job: InvitationJob) {
        jobs.push(job);
        if (unavailable) throw new Error("private queue details");
      },
    };
    const service = new Invitations(
      work,
      f.app.get(OrganizationAccess),
      f.auth.sessions,
      f.auth.vault,
      f.auth.passwords,
      secrets,
      publisher,
      () => now,
    );
    // Exercise the actual controllers with only the external queue port replaced.
    const registered = f.app.get(Invitations);
    Object.assign(registered, { publisher, now: () => now });
    Object.assign(replica.get(Invitations), { publisher, now: () => now });
    const master = await f.db.user.findFirstOrThrow({
      where: { master: true },
    });
    await f.db.user.update({
      where: { id: master.id },
      data: { mustChangePassword: false, totpVerified: true },
    });
    const hash = await hashPassword("synthetic invitation password");
    async function user(name: string) {
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
    async function session(userId: string, stage = "full") {
      const raw = token();
      await f.db.session.create({
        data: {
          digest: digest(raw),
          userId,
          stage,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return raw;
    }
    const admin = await user("admin"),
      member = await user("member"),
      other = await user("other"),
      existing = await user("existing");
    const a = await f.db.organization.create({ data: { name: "A" } }),
      b = await f.db.organization.create({ data: { name: "B" } });
    await f.db.organizationMember.createMany({
      data: [
        { organizationId: a.id, userId: admin.id, role: "ORGANIZATION_ADMIN" },
        { organizationId: a.id, userId: member.id },
        { organizationId: b.id, userId: other.id, role: "ORGANIZATION_ADMIN" },
      ],
    });
    const ca = await session(admin.id),
      cm = await session(member.id),
      cg = await session(master.id),
      ce = await session(existing.id);
    const base = `/v1/organizations/${a.id}/invitations`;
    const post = (path: string, body: object, raw = ca, app = f.app) =>
      request(app.getHttpServer())
        .post(path)
        .set("Cookie", `login_session=${raw}`)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .send(body);
    const get = (path: string, raw = ca) =>
      request(f.app.getHttpServer())
        .get(path)
        .set("Cookie", `login_session=${raw}`);
    async function envelope(job = jobs.at(-1)!) {
      const i = await f.db.organizationInvitation.findUniqueOrThrow({
        where: { id: job.invitationId },
      });
      return `${i.id}.${secrets.decrypt(job.encryptedToken, invitationContext(i))}`;
    }
    const newBody = (token: string, username: string) => ({
      token,
      mode: "new",
      username,
      password: "new synthetic invitation password",
      confirmPassword: "new synthetic invitation password",
    });
    await post("/v1/organization-context", { organizationId: a.id }).expect(
      200,
    );
    await t.test(
      "scope and permissions; legacy create and link cannot bypass consent",
      async () => {
        for (const raw of [ca, cm]) {
          assert.equal(
            (
              await post(
                `/v1/organizations/${b.id}/invitations`,
                { email: "foreign@example.invalid" },
                raw,
              )
            ).status,
            403,
          );
          assert.equal(
            (await get(`/v1/organizations/${b.id}/invitations`, raw)).status,
            403,
          );
        }
        assert.equal(
          (await post(base, { email: "denied@example.invalid" }, cm)).status,
          403,
        );
        assert.equal((await get(base, cm)).status, 403);
        assert.equal(
          (await get(`/V1/ADMIN/organizations/${a.id}/invitations`)).status,
          401,
        );
        for (const mode of ["new", "existing"])
          assert.equal(
            (
              await post(`/v1/organizations/${a.id}/members`, {
                mode,
                email: "direct@example.invalid",
                username: "direct",
                password: "synthetic direct password",
              })
            ).status,
            410,
          );
        await f.db.organizationPermissionGrant.createMany({
          data: ["MEMBERS_CREATE", "MEMBERS_LINK"].map((permission) => ({
            organizationId: a.id,
            role: "MEMBER" as const,
            permission: permission as "MEMBERS_CREATE" | "MEMBERS_LINK",
          })),
        });
        assert.equal(
          (
            await post(
              base,
              { email: "promote@example.invalid", role: "ORGANIZATION_ADMIN" },
              cm,
            )
          ).status,
          403,
        );
        assert.equal(
          (await post(base, { email: "allowed@example.invalid" }, cm)).status,
          200,
        );
        for (const org of [a, b])
          assert.equal(
            (
              await post(
                `/v1/admin/organizations/${org.id}/invitations`,
                { email: "master-issued@example.invalid" },
                cg,
              )
            ).status,
            200,
          );
        assert.equal(
          (
            await post(base, {
              email: "attack@example.invalid",
              role: "MASTER",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await post(base, {
              email: "attack@example.invalid",
              organizationId: b.id,
            })
          ).status,
          400,
        );
        const foreign = await f.db.organizationInvitation.findFirstOrThrow({
          where: { organizationId: b.id },
        });
        for (const action of ["resend", "revoke"]) {
          assert.equal(
            (
              await post(
                `/v1/organizations/${b.id}/invitations/${foreign.id}/${action}`,
                {},
              )
            ).status,
            403,
          );
          assert.equal(
            (await post(`${base}/${foreign.id}/${action}`, {})).status,
            400,
          );
        }
        const list = await get(base);
        assert.equal(list.status, 200);
        assert.ok(
          list.body.items.every((i: { id: string }) => i.id !== foreign.id),
        );
      },
    );
    await t.test(
      "scoped current emissions: search, statuses, counts, pagination and safe creator projection",
      async () => {
        const source = await f.db.organizationInvitation.findFirstOrThrow({
          where: { organizationId: a.id },
        });
        const states = ["pending", "expired", "accepted", "revoked"] as const;
        const ids: string[] = [];
        for (const [index, state] of states.entries()) {
          const id = randomUUID();
          ids.push(id);
          const row = {
            ...source,
            id,
            role: "MEMBER" as const,
            createdBy: master.id,
            createdAt: new Date(now - 1000),
            expiresAt: new Date(state === "pending" ? now + 60000 : now),
            acceptedAt: state === "accepted" ? new Date(now - 1) : null,
            revokedAt: state === "revoked" ? new Date(now - 1) : null,
            deliveredAt: state === "pending" ? null : new Date(now - 500),
          };
          row.email = f.auth.vault.encrypt(
            `listing-${index}@example.invalid`,
            invitationEmailPurpose(row),
          );
          row.emailFingerprint = f.auth.vault.index(
            `listing-${index}@example.invalid`,
          );
          await f.db.organizationInvitation.create({ data: row });
        }
        const foreign = {
          ...source,
          id: randomUUID(),
          organizationId: b.id,
          emailFingerprint: f.auth.vault.index(
            "listing-foreign@example.invalid",
          ),
        };
        foreign.email = f.auth.vault.encrypt(
          "listing-foreign@example.invalid",
          invitationEmailPurpose(foreign),
        );
        await f.db.organizationInvitation.create({ data: foreign });
        const result = await get(`${base}?search=%20LISTING-%20&pageSize=2`);
        assert.equal(result.status, 200);
        assert.equal(result.body.total, 4);
        assert.equal(result.body.items.length, 2);
        assert.deepEqual(result.body.counts, {
          all: 4,
          pending: 1,
          expired: 1,
          accepted: 1,
          revoked: 1,
        });
        const second = await get(`${base}?search=listing-&page=2&pageSize=2`);
        assert.equal(
          new Set([...result.body.items, ...second.body.items].map((i) => i.id))
            .size,
          4,
        );
        assert.deepEqual(
          (await get(`${base}?search=listing-&page=10`)).body.items,
          [],
        );
        for (const state of states) {
          const response = await get(`${base}?search=listing-&status=${state}`);
          assert.equal(response.body.total, 1);
          const item = response.body.items[0];
          assert.equal(item.status, state);
          assert.equal(
            item.createdBy,
            f.auth.vault.decrypt(master.username, "username"),
          );
          assert.equal(item.deliveredAt === null, state === "pending");
          assert.deepEqual(
            Object.keys(item).sort(),
            [
              "id",
              "email",
              "role",
              "createdBy",
              "createdAt",
              "deliveredAt",
              "expiresAt",
              "status",
            ].sort(),
          );
        }
        for (const query of [
          "page=0",
          "page=1.5",
          "page=1000001",
          "pageSize=101",
          "pageSize=0",
          "status=unknown",
          "search=" + "x".repeat(255),
          "organizationId=" + b.id,
          "page=1&page=2",
        ])
          assert.equal((await get(`${base}?${query}`)).status, 400);
        assert.equal(
          (
            await get(
              `/v1/organizations/${b.id}/invitations?search=listing-&status=all`,
            )
          ).status,
          403,
        );
        const other = await get(
          `/v1/admin/organizations/${b.id}/invitations?search=listing-`,
          cg,
        );
        assert.equal(other.body.total, 1);
        assert.equal(other.body.items[0].id, foreign.id);
        assert.equal((await post(`${base}/${ids[1]}/resend`, {})).status, 200);
        const reissued = (await get(`${base}?search=listing-&pageSize=100`))
          .body;
        assert.equal(reissued.total, 4);
        assert.equal(reissued.counts.expired, 0);
        assert.equal(reissued.counts.pending, 2);
        const latest = reissued.items.find(
          (i: { id: string }) => i.id === ids[1],
        );
        assert.equal(latest.deliveredAt, null);
        assert.equal(latest.createdAt, new Date(now).toISOString());
        assert.equal(
          latest.createdBy,
          f.auth.vault.decrypt(admin.username, "username"),
        );
        // Administrative invitations require role management for cancellation as well as resend.
        await f.db.organizationInvitation.update({
          where: { id: ids[0] },
          data: { role: "ORGANIZATION_ADMIN" },
        });
        assert.equal(
          (await post(`${base}/${ids[0]}/revoke`, {}, cm)).status,
          403,
        );
        assert.equal(
          (await post(`${base}/${ids[0]}/resend`, {}, cm)).status,
          403,
        );
        assert.equal(
          (
            await f.db.organizationInvitation.findUniqueOrThrow({
              where: { id: ids[0] },
            })
          ).revokedAt,
          null,
        );
      },
    );
    await t.test(
      "new account and membership are created only by explicit acceptance; one concurrent winner",
      async () => {
        const before = await f.db.user.count();
        const results = await Promise.all([
          post(base, { email: " New@example.invalid " }),
          post(base, { email: "new@example.invalid" }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        assert.equal(await f.db.user.count(), before);
        const i = await f.db.organizationInvitation.findUniqueOrThrow({
          where: {
            organizationId_emailFingerprint: {
              organizationId: a.id,
              emailFingerprint: f.auth.vault.index("new@example.invalid"),
            },
          },
        });
        const job = jobs.find((j) => j.invitationId === i.id)!;
        const secret = await envelope(job);
        assert.deepEqual(Object.keys(job).sort(), [
          "encryptedToken",
          "invitationId",
        ]);
        assert.ok(!JSON.stringify(job).includes("new@example.invalid"));
        assert.ok(!JSON.stringify(i).includes(secret.split(".")[1]));
        assert.equal(
          f.auth.vault.decrypt(i.email, invitationEmailPurpose(i)),
          "new@example.invalid",
        );
        const preview = await post(
          "/v1/invitations/preview",
          { token: secret },
          "",
        );
        assert.equal(preview.status, 200);
        assert.deepEqual(Object.keys(preview.body).sort(), [
          "expiresAt",
          "organization",
          "role",
        ]);
        await get(`/v1/invitations/accept`); // GET is not an acceptance operation.
        assert.equal(await f.db.user.count(), before);
        const accepted = await Promise.all([
          post("/v1/invitations/accept", newBody(secret, "new-person"), ""),
          post(
            "/v1/invitations/accept",
            newBody(secret, "new-person"),
            "",
            replica,
          ),
        ]);
        assert.deepEqual(accepted.map((r) => r.status).sort(), [200, 400]);
        assert.ok(accepted.every((r) => !r.headers["set-cookie"]));
        const u = await f.db.user.findUniqueOrThrow({
          where: { emailIndex: i.emailFingerprint },
        });
        assert.equal(u.master, false);
        assert.equal(u.mustChangePassword, false);
        assert.ok(u.emailVerifiedAt);
        assert.ok(
          await verifyPassword(
            u.passwordHash,
            "new synthetic invitation password",
          ),
        );
        assert.equal(
          await f.db.organizationMember.count({
            where: { organizationId: a.id, userId: u.id },
          }),
          1,
        );
        assert.equal(
          ((await service.preview({ token: secret })) as { error: string })
            .error,
          "INVITATION_USED",
        );
      },
    );
    await t.test(
      "existing account requires full matching non-Master session; no account enumeration in preview",
      async () => {
        assert.equal(
          (
            await post(base, {
              email: "existing@example.invalid",
              role: "ORGANIZATION_ADMIN",
            })
          ).status,
          200,
        );
        const secret = await envelope();
        const before = await f.db.user.count();
        for (const raw of ["", await session(existing.id, "password"), cg])
          assert.equal(
            (
              await post(
                "/v1/invitations/accept",
                { token: secret, mode: "existing" },
                raw,
              )
            ).status,
            401,
          );
        assert.equal(
          (
            await post(
              "/v1/invitations/accept",
              { token: secret, mode: "existing" },
              ca,
            )
          ).body.code,
          "ACCEPT_UNAVAILABLE",
        );
        assert.equal(
          (await post("/v1/invitations/accept", newBody(secret, "another"), ""))
            .body.code,
          "ACCEPT_UNAVAILABLE",
        );
        assert.equal(
          (
            await post(
              "/v1/invitations/accept",
              { token: secret, mode: "existing", role: "MASTER" },
              ce,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await post(
              "/v1/invitations/accept",
              { token: secret, mode: "existing" },
              ce,
            )
          ).status,
          200,
        );
        assert.equal(await f.db.user.count(), before);
        assert.ok(
          (await f.db.user.findUniqueOrThrow({ where: { id: existing.id } }))
            .emailVerifiedAt,
        );
        assert.equal(
          (
            await f.db.organizationMember.findUniqueOrThrow({
              where: {
                organizationId_userId: {
                  organizationId: a.id,
                  userId: existing.id,
                },
              },
            })
          ).role,
          "ORGANIZATION_ADMIN",
        );
      },
    );
    await t.test(
      "rotation, cancellation, expiration, durable limits and queue failure",
      async () => {
        await post(base, { email: "rotate@example.invalid" });
        const old = await envelope(),
          job = jobs.at(-1)!;
        assert.equal(
          (await post(`${base}/${job.invitationId}/resend`, {})).status,
          429,
        );
        now += 61000;
        assert.equal(
          (await post(`${base}/${job.invitationId}/resend`, {})).status,
          200,
        );
        const current = await envelope();
        assert.notEqual(current, old);
        assert.equal(
          (await post("/v1/invitations/preview", { token: old }, "")).body.code,
          "INVITATION_INVALID",
        );
        assert.equal(
          (await post(`${base}/${job.invitationId}/revoke`, {})).status,
          200,
        );
        assert.equal(
          (
            await post(
              "/v1/invitations/accept",
              newBody(current, "revoked"),
              "",
            )
          ).body.code,
          "INVITATION_REVOKED",
        );
        now += 61000;
        await post(base, { email: "rotate@example.invalid" });
        const expired = await envelope();
        now += 7 * 86400000 + 1;
        assert.equal(
          (await post("/v1/invitations/preview", { token: expired }, "")).body
            .code,
          "INVITATION_EXPIRED",
        );
        unavailable = true;
        assert.equal(
          (await post(base, { email: "queue-failure@example.invalid" })).status,
          503,
        );
        const failed = await envelope();
        unavailable = false;
        assert.equal(
          (await post("/v1/invitations/preview", { token: failed }, "")).body
            .code,
          "INVITATION_REVOKED",
        );
        assert.equal(
          ((await service.preview({ token: "bad" })) as { error: string })
            .error,
          "INVITATION_INVALID",
        );
        for (let n = 0; n < 5; n++) {
          now += 61000;
          const r = await service.issue(
            ca,
            a.id,
            { email: "limited@example.invalid" },
            false,
          );
          if (n === 0) assert.ok("queued" in r);
          else {
            const i = await f.db.organizationInvitation.findFirstOrThrow({
              where: {
                emailFingerprint: f.auth.vault.index("limited@example.invalid"),
              },
            });
            assert.ok(
              "queued" in (await service.issue(ca, a.id, {}, false, i.id)),
            );
          }
        }
        now += 61000;
        const limited = await f.db.organizationInvitation.findFirstOrThrow({
          where: {
            emailFingerprint: f.auth.vault.index("limited@example.invalid"),
          },
        });
        assert.equal(
          (
            (await service.issue(ca, a.id, {}, false, limited.id)) as {
              error: string;
            }
          ).error,
          "RATE_LIMIT",
        );
      },
    );
    await t.test(
      "inactive organization, removed membership and transaction rollback",
      async () => {
        await post(base, { email: "rollback@example.invalid" });
        const secret = await envelope();
        const failingWork: UnitOfWork<InvitationsTransaction> = {
          run: (action, options) =>
            work.run(
              (tx) =>
                action({
                  ...tx,
                  invitations: {
                    ...tx.invitations,
                    locate: tx.invitations.locate.bind(tx.invitations),
                    find: tx.invitations.find.bind(tx.invitations),
                    forEmail: tx.invitations.forEmail.bind(tx.invitations),
                    list: tx.invitations.list.bind(tx.invitations),
                    save: async () => {
                      throw new Error("synthetic rollback");
                    },
                  },
                }),
              options,
            ),
        };
        const failing = new Invitations(
          failingWork,
          f.app.get(OrganizationAccess),
          f.auth.sessions,
          f.auth.vault,
          f.auth.passwords,
          secrets,
          publisher,
          () => now,
        );
        const auditCount = await f.db.auditEvent.count();
        await assert.rejects(
          () => failing.accept(undefined, newBody(secret, "rollback")),
          /synthetic rollback/,
        );
        assert.equal(await f.db.auditEvent.count(), auditCount);
        assert.equal(
          await f.db.user.count({
            where: {
              emailIndex: f.auth.vault.index("rollback@example.invalid"),
            },
          }),
          0,
        );
        await f.db.organization.update({
          where: { id: a.id },
          data: { active: false },
        });
        assert.equal(
          (
            (await service.accept(undefined, newBody(secret, "rollback"))) as {
              error: string;
            }
          ).error,
          "INVITATION_INVALID",
        );
        await f.db.organization.update({
          where: { id: a.id },
          data: { active: true },
        });
        await post(base, { email: "member@example.invalid" });
        const removedToken = await envelope();
        await f.db.organizationMember.update({
          where: {
            organizationId_userId: { organizationId: a.id, userId: member.id },
          },
          data: { deletedAt: new Date() },
        });
        assert.equal(
          (
            (await service.accept(cm, {
              token: removedToken,
              mode: "existing",
            })) as { error: string }
          ).error,
          "ACCEPT_UNAVAILABLE",
        );
      },
    );
    await t.test(
      "acceptance revalidates organization after hashing and current account email",
      async () => {
        await post(base, { email: "race@example.invalid" });
        const secret = await envelope();
        let started!: () => void, release!: () => void;
        const hashing = new Promise<void>((r) => {
          started = r;
        });
        const barrier = new Promise<void>((r) => {
          release = r;
        });
        const raced = new Invitations(
          work,
          f.app.get(OrganizationAccess),
          f.auth.sessions,
          f.auth.vault,
          {
            dummy: hash,
            init: async () => {},
            verify: async () => true,
            run: async (action) => action(),
            hash: async () => {
              started();
              await barrier;
              return hash;
            },
          },
          secrets,
          publisher,
          () => now,
        );
        const pending = raced.accept(undefined, newBody(secret, "race"));
        await hashing;
        try {
          await work.run(async (tx) => {
            await tx.lock(`organization:${a.id}`);
            await tx.organizations.update(a.id, {
              active: false,
              deletedAt: new Date(),
            });
          });
        } finally {
          release();
        }
        assert.deepEqual(await pending, { error: "INVITATION_INVALID" });
        assert.equal(
          await f.db.user.count({
            where: { emailIndex: f.auth.vault.index("race@example.invalid") },
          }),
          0,
        );
        await f.db.organization.update({
          where: { id: a.id },
          data: { active: true, deletedAt: null },
        });
        await post(base, { email: "other@example.invalid" });
        const existingToken = await envelope(),
          raw = await session(other.id);
        await f.db.user.update({
          where: { id: other.id },
          data: {
            email: f.auth.vault.encrypt("changed@example.invalid", "email"),
            emailIndex: f.auth.vault.index("changed@example.invalid"),
          },
        });
        assert.deepEqual(
          await service.accept(raw, { token: existingToken, mode: "existing" }),
          { error: "ACCEPT_UNAVAILABLE" },
        );
        assert.equal(
          await f.db.organizationMember.count({
            where: { organizationId: a.id, userId: other.id },
          }),
          0,
        );
      },
    );

    await t.test(
      "worker discards obsolete jobs, validates AAD and sanitizes errors",
      async () => {
        await post(base, { email: "delivery@example.invalid" });
        const oldJob = jobs.at(-1)!;
        now += 61000;
        await post(`${base}/${oldJob.invitationId}/resend`, {});
        const job = jobs.at(-1)!;
        const messages: { to: string; text: string }[] = [];
        const sender = {
          async send(m: { to: string; text: string }) {
            messages.push(m);
            return { accepted: true as const };
          },
        };
        const deliver = new DeliverInvitation(
          work,
          secrets,
          f.auth.vault,
          sender,
          f.c.FRONTEND_ORIGIN,
          () => now,
        );
        assert.deepEqual(await deliver.execute(oldJob), { ignored: true });
        assert.deepEqual(await deliver.execute(job), { accepted: true });
        assert.equal(messages.length, 1);
        assert.equal(messages[0].to, "delivery@example.invalid");
        assert.ok(messages[0].text.includes("/invitations/accept#token="));
        assert.deepEqual(await deliver.execute(job), { ignored: true });
        await post(base, { email: "smtp-failure@example.invalid" });
        const failingJob = jobs.at(-1)!;
        const failingSender = {
          async send() {
            throw new Error("private SMTP token secret@example.invalid");
          },
        };
        const processor = new EmailProcessor(
          new DeliverEmail(failingSender),
          undefined,
          new DeliverInvitation(
            work,
            secrets,
            f.auth.vault,
            failingSender,
            f.c.FRONTEND_ORIGIN,
            () => now,
          ),
        );
        const logs: unknown[][] = [];
        const logMocks = (
          ["log", "info", "warn", "error", "debug"] as const
        ).map((method) =>
          t.mock.method(console, method, (...args: unknown[]) =>
            logs.push(args),
          ),
        );
        try {
          await assert.rejects(
            () => processor.process({ name: INVITATION_JOB, data: failingJob }),
            (e) =>
              e instanceof Error &&
              e.message === "EMAIL_DELIVERY_UNAVAILABLE" &&
              !e.stack?.includes("secret@example.invalid"),
          );
        } finally {
          for (const mocked of logMocks) mocked.mock.restore();
        }
        const captured = JSON.stringify(logs);
        for (const sensitive of [
          "secret@example.invalid",
          "smtp-failure@example.invalid",
          failingJob.encryptedToken,
          await envelope(failingJob),
        ])
          assert.ok(!captured.includes(sensitive));
        await assert.rejects(
          () => deliver.execute({ ...failingJob, encryptedToken: "tampered" }),
          (e) => e instanceof Error && e.message === "EMAIL_INPUT_INVALID",
        );
        const stored = await f.db.organizationInvitation.findUniqueOrThrow({
          where: { id: failingJob.invitationId },
        });
        assert.throws(() =>
          secrets.decrypt(
            failingJob.encryptedToken,
            invitationContext({ ...stored, organizationId: b.id }),
          ),
        );
        await post(`${base}/${failingJob.invitationId}/revoke`, {});
        assert.deepEqual(await deliver.execute(failingJob), { ignored: true });
      },
    );
    await t.test(
      "audit covers invitation transitions and never retains recipient or token",
      async () => {
        const rows = await f.db.auditEvent.findMany();
        for (const action of [
          "invitation.created",
          "invitation.resent",
          "invitation.delivered",
          "invitation.revoked",
          "invitation.accepted",
          "invitation.expired",
          "invitation.queue_failed",
          "invitation.delivery_failed",
          "member.added",
        ]) {
          assert.ok(
            rows.some((row) => row.action === action),
            action,
          );
        }
        for (const row of rows) {
          const details = auditDetails(row, f.auth.vault);
          const text = JSON.stringify(details);
          for (const secret of [
            "@example.invalid",
            "encryptedToken",
            "password",
            "digest",
            "emailFingerprint",
          ])
            assert.ok(!text.includes(secret));
          if (
            row.action === "invitation.created" ||
            row.action === "invitation.resent"
          ) {
            assert.ok(
              [admin.id, master.id, member.id].includes(details.actorId!),
            );
            const invitation =
              await f.db.organizationInvitation.findUniqueOrThrow({
                where: { id: details.resourceId! },
              });
            assert.equal(details.organizationId, invitation.organizationId);
          }
          if (
            row.action === "invitation.delivered" ||
            row.action === "invitation.expired"
          )
            assert.equal(details.actorId, null);
          if (row.action.endsWith("_failed"))
            assert.equal(row.outcome, "failure");
        }
      },
    );
  },
);

test("invitation publisher fails safely when disabled and uses bounded dedicated jobs", async () => {
  await assert.rejects(
    () =>
      new EmailInvitationPublisher().publish({
        invitationId: "opaque",
        encryptedToken: "ciphertext",
      }),
    /EMAIL_INVITATION_UNAVAILABLE/,
  );
  let seen: unknown;
  const publisher = new EmailInvitationPublisher({
    add: async (name, data, options) => {
      seen = { name, data, options };
      return {} as any;
    },
  });
  await publisher.publish({
    invitationId: "opaque",
    encryptedToken: "ciphertext",
  });
  assert.equal((seen as any).name, INVITATION_JOB);
  assert.equal((seen as any).options.attempts, 3);
  assert.deepEqual((seen as any).options.backoff, invitationJobOptions.backoff);
});
