import { AUTH_WORK } from "../src/auth/auth.tokens";
import { UnitOfWork } from "../src/application/auth/ports/repositories";
import { MembersTransaction } from "../src/application/organizations/ports/members.repository";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers";
import { AUTH_REPOSITORIES } from "../src/auth/auth.tokens";
import { AuthRepositories } from "../src/application/auth/ports/repositories";
let f: Awaited<ReturnType<typeof fixture>>;
before(
  async () => {
    f = await fixture(15442);
  },
  { timeout: 60000 },
);
after(async () => {
  await f?.close();
});

test("Prisma repositories map pure records and rollback all stores in one unit of work", async () => {
  const original = await f.db.user.findFirstOrThrow({
    where: { master: true },
  });
  const repos = f.app.get<AuthRepositories>(AUTH_REPOSITORIES);
  const mapped = await repos.identities.requireById(original.id);
  assert.deepEqual(mapped, original);
  await assert.rejects(
    f.work.run(async (tx) => {
      await tx.lock(`account:${original.id}`);
      await tx.identities.updateCredentials(original.id, {
        mustChangePassword: false,
      });
      await tx.sessions.create({
        digest: "synthetic-session",
        userId: original.id,
        stage: "setup",
        expiresAt: new Date(Date.now() + 60000),
      });
      await tx.sessions.createDevice({
        digest: "synthetic-device",
        userId: original.id,
        expiresAt: new Date(Date.now() + 60000),
      });
      await tx.identities.createRecovery(original.id, ["synthetic-recovery"]);
      await tx.rates.save("synthetic-rate", {
        hits: [new Date()],
        cycles: 2,
        blockedUntil: null,
      });
      throw new Error("intentional rollback");
    }),
    /intentional rollback/,
  );
  assert.equal(
    (await repos.identities.requireById(original.id)).mustChangePassword,
    original.mustChangePassword,
  );
  assert.equal(await f.db.session.count(), 0);
  assert.equal(await f.db.masterDevice.count(), 0);
  assert.equal(await f.db.recoveryCode.count(), 0);
  assert.equal(await repos.rates.find("synthetic-rate"), null);
});

test("Prisma unit of work commits changes and parameterizes arbitrary lock keys", async () => {
  const key = 'fixture\'); DROP TABLE "User"; --';
  await f.work.run(async (tx) => {
    await tx.lock(key);
    await tx.rates.save(key, { hits: [], cycles: 1, blockedUntil: null });
  });
  assert.equal(await f.db.user.count(), 1);
  assert.deepEqual(
    await f.app.get<AuthRepositories>(AUTH_REPOSITORIES).rates.find(key),
    { hits: [], cycles: 1, blockedUntil: null },
  );
});

test("Prisma repository translates technical errors without leaking driver details", async () => {
  const repos = f.app.get<AuthRepositories>(AUTH_REPOSITORIES);
  await assert.rejects(
    repos.identities.requireById("missing-fixture"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Falha de persistência.");
      assert.equal("clientVersion" in error, false);
      assert.equal("meta" in error, false);
      return true;
    },
  );
});

test("shared unit of work rolls back a new identity and membership together", async () => {
  const work = f.app.get<UnitOfWork<MembersTransaction>>(AUTH_WORK);
  const organization = await f.db.organization.create({
    data: { name: "Rollback fixture" },
  });
  await assert.rejects(
    work.run(async (tx) => {
      await tx.lock("identity-update");
      await tx.identities.create({
        username: "synthetic",
        email: "synthetic",
        usernameIndex: "rollback-user",
        emailIndex: "rollback-email",
        passwordHash: "synthetic-hash",
        master: false,
        mustChangePassword: true,
      });
      const user = await tx.identities.findByIndex("rollback-email", false);
      assert.ok(user);
      assert.equal(
        await tx.members.insert(organization.id, user.id, "MEMBER"),
        1,
      );
      throw new Error("intentional membership rollback");
    }),
    /intentional membership rollback/,
  );
  assert.equal(
    await f.db.user.count({ where: { emailIndex: "rollback-email" } }),
    0,
  );
  assert.equal(
    await f.db.organizationMember.count({
      where: { organizationId: organization.id },
    }),
    0,
  );
});
