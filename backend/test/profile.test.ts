import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { createApp } from "../src/app";
import {
  hashPassword,
  token,
  digest,
  totp,
  verifyPassword,
} from "../src/infra/security/crypto";

test(
  "profile reauthentication, encrypted identifiers, concurrent collisions and global password revocation",
  { timeout: 60000 },
  async () => {
    const f = await fixture();
    const replica = await createApp(f.c);
    const password = "synthetic profile passphrase";
    const next = "different synthetic passphrase";
    const v = f.auth.vault;
    async function account(name: string) {
      return f.db.user.create({
        data: {
          username: v.encrypt(name, "username"),
          email: v.encrypt(`${name}@example.invalid`, "email"),
          usernameIndex: v.index(name),
          emailIndex: v.index(`${name}@example.invalid`),
          passwordHash: await hashPassword(password),
        },
      });
    }
    async function session(id: string, stage = "full") {
      const raw = token();
      await f.db.session.create({
        data: {
          digest: digest(raw),
          userId: id,
          stage,
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      return `login_session=${raw}`;
    }
    function post(path: string, cookie: string, body: object, app = f.app) {
      return request(app.getHttpServer())
        .post(`/v1/auth/${path}`)
        .set("Origin", f.c.FRONTEND_ORIGIN)
        .set("Cookie", cookie)
        .send(body);
    }
    try {
      const a = await account("profile-a"),
        b = await account("profile-b");
      const ca = await session(a.id),
        cb = await session(b.id);
      const data = {
        username: "renamed",
        email: "renamed@example.invalid",
        currentPassword: password,
      };
      assert.equal((await post("profile", "", data)).status, 401);
      assert.equal(
        (await post("profile", await session(a.id, "mfa"), data)).status,
        401,
      );
      assert.equal(
        (
          await request(f.app.getHttpServer())
            .post("/v1/auth/profile")
            .set("Cookie", ca)
            .send(data)
        ).status,
        403,
      );
      const wrongPassword = await post("password", ca, {
        currentPassword: "wrong",
        newPassword: next,
        confirmPassword: next,
      });
      assert.equal(wrongPassword.status, 401);
      assert.equal(wrongPassword.body.code, "REAUTHENTICATION_FAILED");
      assert.match(wrongPassword.body.message, /senha atual/);
      assert.ok(!wrongPassword.body.message.includes("E-mail"));
      assert.equal(
        (await post("profile", ca, { ...data, email: "bad" })).status,
        400,
      );
      assert.equal((await post("profile", ca, data)).status, 200);
      const saved = await f.db.user.findUniqueOrThrow({ where: { id: a.id } });
      assert.notEqual(saved.email, data.email);
      assert.equal(v.decrypt(saved.email, "email"), data.email);
      assert.equal(saved.usernameIndex, v.index(data.username));
      const collision = await post("profile", ca, {
        ...data,
        username: "profile-b@example.invalid",
      });
      assert.equal(collision.status, 401);
      assert.ok(!JSON.stringify(collision.body).includes("profile-b"));
      assert.equal(
        (await f.db.user.findUniqueOrThrow({ where: { id: a.id } }))
          .usernameIndex,
        saved.usernameIndex,
      );
      // Same index in different namespaces must not be assigned to two accounts, even across replicas.
      const concurrent = await Promise.all([
        post("profile", ca, { ...data, username: "shared@example.invalid" }),
        post(
          "profile",
          cb,
          {
            username: "profile-b",
            email: "shared@example.invalid",
            currentPassword: password,
          },
          replica,
        ),
      ]);
      assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 401]);
      await f.db.rateState.deleteMany({ where: { key: `profile:${a.id}` } });
      const pw = {
        currentPassword: password,
        newPassword: next,
        confirmPassword: next,
      };
      assert.equal(
        (await post("password", ca, { ...pw, confirmPassword: "different" }))
          .status,
        400,
      );
      assert.equal(
        (
          await post("password", ca, {
            ...pw,
            newPassword: password,
            confirmPassword: password,
          })
        ).status,
        400,
      );
      const other = await session(a.id);
      const changed = await post("password", ca, pw);
      assert.equal(changed.status, 200);
      assert.ok(
        changed.headers["set-cookie"].every((s: string) =>
          s.includes("Expires=Thu, 01 Jan 1970"),
        ),
      );
      for (const c of [ca, other])
        assert.equal(
          (
            await request(replica.getHttpServer())
              .get("/v1/welcome")
              .set("Cookie", c)
          ).status,
          401,
        );
      const updated = await f.db.user.findUniqueOrThrow({
        where: { id: a.id },
      });
      assert.ok(await verifyPassword(updated.passwordHash, next));
      assert.equal(await f.db.session.count({ where: { userId: a.id } }), 0);
      // Master requires fresh TOTP, never recovery or a replay. Both edit routes enforce it.
      const master = await f.db.user.findFirstOrThrow({
        where: { master: true },
      });
      const otp = totp();
      await f.db.user.update({
        where: { id: master.id },
        data: {
          passwordHash: await hashPassword(password),
          mustChangePassword: false,
          totpVerified: true,
          totpSecret: v.encrypt(otp.secret.base32, "totp"),
        },
      });
      const cm = await session(master.id);
      const md = {
        ...data,
        username: "updated-master",
        email: "updated-master@example.invalid",
      };
      assert.equal((await post("profile", cm, md)).status, 401);
      assert.equal((await post("password", cm, pw)).status, 401);
      await f.db.rateState.deleteMany({
        where: { key: `profile:${master.id}` },
      });
      const code = otp.generate();
      assert.equal((await post("profile", cm, { ...md, code })).status, 200);
      assert.equal((await post("password", cm, { ...pw, code })).status, 401);
      // Set a fresh fixture step without waiting for the wall clock.
      await f.db.user.update({
        where: { id: master.id },
        data: { lastTotpStep: -1n },
      });
      await f.db.masterDevice.create({
        data: {
          digest: digest(token()),
          userId: master.id,
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      const results = await Promise.all([
        post("password", cm, { ...pw, code: otp.generate() }),
        post("password", cm, { ...pw, code: otp.generate() }, replica),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
      assert.equal(
        await f.db.masterDevice.count({ where: { userId: master.id } }),
        0,
      );
      assert.equal(
        await f.db.session.count({ where: { userId: master.id } }),
        0,
      );
      // Shared, durable attempt budget remains effective after changing API instance.
      await f.db.rateState.deleteMany({ where: { key: `profile:${b.id}` } });
      for (let i = 0; i < 3; i++)
        assert.equal(
          (await post("profile", cb, { ...data, currentPassword: "wrong" }))
            .status,
          401,
        );
      const blocked = await post("profile", cb, data, replica);
      assert.equal(blocked.status, 401);
      assert.equal(blocked.body.code, "ATTEMPTS_BLOCKED");
    } finally {
      await replica.close();
      await f.close();
    }
  },
);
