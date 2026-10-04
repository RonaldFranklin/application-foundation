import { test } from "node:test";
import assert from "node:assert/strict";
import { isolated, user, session } from "./application.helpers";
const context = { ip: "192.0.2.1" };

test("isolated operations validate semantic inputs before accessing repositories", async () => {
  const h = isolated();
  for (const body of [
    null,
    {},
    { identifier: "  ", password: "x" },
    { identifier: "fixture", password: "x", extra: true },
  ])
    assert.deepEqual(await h.login.execute(false, body, context), {
      ok: false,
      challengeRequired: false,
    });
  assert.deepEqual(
    await h.password.execute("restricted", { password: "short" }),
    { invalid: "password" },
  );
  assert.deepEqual(await h.mfa.mfa("restricted", { code: "123" }, false), {
    error: "MFA_INVALID",
  });
  assert.deepEqual(
    await h.sessions.logout("restricted", { forgetDevice: "yes" }),
    { invalid: "logout" },
  );
  assert.deepEqual(h.trace, []);
});

test("isolated ordinary login rejects unknown/wrong-flow identities and hashes even blocked accounts", async () => {
  const h = isolated();
  h.repos.identities.findByIndex = async (_index, master) => {
    assert.equal(master, false);
    return null;
  };
  for (const identifier of ["master", "missing"])
    assert.deepEqual(
      await h.login.execute(false, { identifier, password: "wrong" }, context),
      { ok: false, challengeRequired: false },
    );
  assert.equal(h.trace.filter((x) => x === "verify:fake-dummy-hash").length, 2);
  const owner = user({ master: false });
  h.repos.identities.findByIndex = async () => owner;
  h.repos.identities.findById = async () => owner;
  h.rateRows.set(`account:${owner.id}`, {
    hits: [],
    cycles: 1,
    blockedUntil: new Date(Date.now() + 60000),
  });
  assert.deepEqual(
    await h.login.execute(
      false,
      { identifier: "fixture", password: "wrong" },
      context,
    ),
    { ok: false, challengeRequired: false },
  );
  assert.ok(h.trace.includes("verify:fake-hash"));
});

test("isolated master challenge and reservation precede hashing and preserve lock order", async () => {
  const h = isolated();
  h.rateRows.set("master-risk", {
    hits: [new Date(), new Date()],
    cycles: 0,
    blockedUntil: null,
  });
  assert.deepEqual(
    await h.login.execute(
      true,
      { identifier: "missing", password: "wrong" },
      context,
    ),
    { ok: false, challengeRequired: true },
  );
  assert.ok(!h.trace.includes("begin"));
  h.trace.length = 0;
  h.repos.identities.findByIndex = async () => null;
  await h.login.execute(
    true,
    { identifier: "missing", password: "wrong", turnstileToken: "synthetic" },
    context,
  );
  const at = (event: string) => {
    const i = h.trace.indexOf(event);
    assert.ok(i >= 0, event);
    return i;
  };
  assert.ok(at("captcha") < at("begin"));
  assert.ok(at("lock:master-risk") < at("lock:master-anonymous"));
  assert.ok(at("save:master-anonymous") < at("verify:fake-dummy-hash"));
  assert.ok(at("end") < at("verify:fake-dummy-hash"));
});

test("isolated login revalidates the observed password hash inside the account transaction", async () => {
  const h = isolated(),
    owner = user({ master: false });
  h.repos.identities.findByIndex = async () => owner;
  h.passwords.verify = async () => true;
  h.repos.identities.findById = async () => ({
    ...owner,
    passwordHash: "concurrently-changed",
  });
  assert.deepEqual(
    await h.login.execute(
      false,
      { identifier: "fixture", password: "synthetic" },
      context,
    ),
    { ok: false, challengeRequired: false },
  );
  assert.ok(h.trace.includes(`lock:account:${owner.id}`));
});

test("isolated password change hashes outside the transaction and revokes before restricted issuance", async () => {
  const h = isolated(),
    owner = user({ mustChangePassword: true });
  h.repos.sessions.find = async () => session(owner, "password");
  h.repos.identities.updateCredentials = async (id, update) => {
    assert.equal(id, owner.id);
    assert.deepEqual(update, {
      passwordHash: "new-fake-hash",
      mustChangePassword: false,
    });
    h.trace.push("update-password");
  };
  h.repos.sessions.deleteForUser = async () => {
    h.trace.push("revoke-sessions");
  };
  h.repos.sessions.deleteDevicesForUser = async () => {
    h.trace.push("revoke-devices");
  };
  h.repos.sessions.create = async (data) => {
    assert.equal(data.stage, "setup");
    h.trace.push("issue");
  };
  const result = await h.password.execute("restricted", {
    password: "new synthetic passphrase",
  });
  assert.ok(result && "stage" in result && result.stage === "setup");
  assert.ok(h.trace.indexOf("hash:0") < h.trace.indexOf("begin"));
  assert.deepEqual(h.trace.slice(-5), [
    "update-password",
    "revoke-sessions",
    "revoke-devices",
    "issue",
    "end",
  ]);
});

test("isolated password change rejects a session invalidated while hashing", async () => {
  const h = isolated(),
    owner = user({ mustChangePassword: true });
  let reads = 0;
  h.repos.sessions.find = async () =>
    ++reads === 1 ? session(owner, "password") : null;
  assert.equal(
    await h.password.execute("restricted", {
      password: "new synthetic passphrase",
    }),
    null,
  );
  assert.ok(h.trace.includes("hash:0"));
});

test("isolated MFA consumes recovery once and clears risk under the existing lock order", async () => {
  const h = isolated(),
    owner = user(),
    code = "a".repeat(32);
  h.repos.sessions.find = async () => session(owner);
  let available = true;
  h.repos.identities.consumeRecovery = async (id, digest) => {
    assert.equal(id, owner.id);
    assert.equal(digest, h.tokens.digest(code));
    const count = available ? 1 : 0;
    available = false;
    h.trace.push("consume");
    return count;
  };
  h.repos.identities.requireById = async () => owner;
  h.repos.sessions.delete = async () => {
    h.trace.push("revoke");
  };
  h.repos.sessions.create = async () => {
    h.trace.push("issue");
  };
  h.repos.sessions.createDevice = async () => {
    h.trace.push("device");
  };
  h.repos.sessions.deviceDigestsAfter = async (_id, count) => {
    assert.equal(count, 10);
    return [];
  };
  h.repos.sessions.deleteDevices = async () => {};
  const first = await h.mfa.mfa("restricted", { code }, false);
  assert.equal(first?.stage, "full");
  assert.ok(first?.deviceRaw);
  assert.deepEqual(
    h.trace.filter((x) => x.startsWith("lock:")),
    [`lock:account:${owner.id}`, "lock:master-risk", "lock:master-anonymous"],
  );
  assert.ok(h.trace.indexOf("consume") < h.trace.indexOf("issue"));
  assert.deepEqual(
    await h.mfa.mfa("another-restricted-session", { code }, false),
    { error: "MFA_INVALID" },
  );
});

test("isolated bootstrap keeps an existing master unchanged", async () => {
  const h = isolated();
  h.repos.identities.findMaster = async () => user();
  await h.bootstrap.init();
  assert.deepEqual(h.trace, ["dummy", "begin", "lock:master-bootstrap", "end"]);
});

test("isolated logout retains session revocation if forgetting the device subsequently fails", async () => {
  const h = isolated();
  h.repos.sessions.delete = async () => {
    h.trace.push("revoked");
  };
  h.repos.sessions.deleteDevice = async () => {
    throw new Error("synthetic database failure");
  };
  assert.deepEqual(
    await h.sessions.logout(
      "restricted",
      { forgetDevice: true },
      "a".repeat(43),
    ),
    { forgetDevice: true, deviceRevocationFailed: true },
  );
  assert.deepEqual(h.trace, ["revoked"]);
});

test("isolated cleanup chooses expiry and inactivity cutoffs in the use case", async () => {
  const h = isolated(),
    started = Date.now();
  let removed = 0;
  h.repos.sessions.deleteExpiredDevices = async (before) => {
    assert.ok(+before >= started);
    removed++;
  };
  h.repos.sessions.deleteExpiredSessions = async (before) => {
    assert.ok(+before >= started);
    removed++;
  };
  h.repos.rates.deleteInactive = async (old, now) => {
    assert.equal(+now - +old, 86400000);
    removed++;
  };
  await h.cleanup.execute();
  assert.equal(removed, 3);
});

test("profile decrypts identity only after all session and category checks", async () => {
  const { Sessions } =
    await import("../src/application/auth/use-cases/sessions");
  const h = isolated();
  let decryptions = 0;
  const profiles = new Sessions(
    h.repos.sessions,
    h.work,
    h.settings,
    {
      index: () => "unused",
      encrypt: () => "unused",
      decrypt: (value) => {
        decryptions++;
        return value;
      },
    },
    h.tokens,
  );
  const denied = [
    null,
    { ...session(user(), "full"), expiresAt: new Date(Date.now() - 1) },
    session(user({ master: false }), "full"),
    session(user(), "mfa"),
    session(user({ mustChangePassword: true }), "full"),
    session(user({ totpVerified: false }), "full"),
  ];
  for (const record of denied) {
    h.repos.sessions.find = async () => record;
    assert.equal(await profiles.welcome("restricted", true), null);
  }
  assert.equal(decryptions, 0);
  h.repos.sessions.find = async () => session(user(), "full");
  const profile = await profiles.welcome("full", true);
  assert.equal(profile?.email, "fixture@example.invalid");
  assert.equal(decryptions, 2);
});

test("common initial password revalidates session owner, expiry, role, stage, flag and hash at commit", async () => {
  const owner = user({ master: false, mustChangePassword: true });
  const initial = session(owner, "password");
  for (const changed of [
    null,
    { ...initial, expiresAt: new Date(0) },
    { ...initial, userId: "another-user" },
    { ...initial, stage: "full" },
    { ...initial, user: { ...owner, master: true } },
    { ...initial, user: { ...owner, mustChangePassword: false } },
    {
      ...initial,
      user: { ...owner, passwordHash: "changed-after-verification" },
    },
  ]) {
    const h = isolated();
    let reads = 0;
    h.repos.sessions.find = async () => (++reads === 1 ? initial : changed);
    const password = "synthetic new common password";
    assert.equal(
      await h.password.execute(
        "restricted",
        { password, confirmPassword: password },
        false,
      ),
      null,
    );
    assert.ok(h.trace.includes("hash:0"));
    assert.ok(h.trace.includes(`lock:account:${owner.id}`));
    // All credential/session mutations remain unexpected in this fixture.
  }
});
