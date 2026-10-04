import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./helpers";
import { digest, token, verifyPassword } from "../src/infra/security/crypto";

test(
  "temporary common password: restricted login, isolation, atomic rotation and master separation",
  { timeout: 60000 },
  async () => {
    const f = await fixture(15445);
    try {
      const http = f.app.getHttpServer();
      const master = await f.db.user.findFirstOrThrow({
        where: { master: true },
      });
      async function cookie(userId: string, stage = "full", expired = false) {
        const raw = token();
        await f.db.session.create({
          data: {
            digest: digest(raw),
            userId,
            stage,
            expiresAt: new Date(Date.now() + (expired ? -1000 : 600000)),
          },
        });
        return `login_session=${raw}`;
      }
      const post = (path: string, body: object, c = "") =>
        request(http)
          .post(`/v1/${path}`)
          .set("Origin", f.c.FRONTEND_ORIGIN)
          .set("Cookie", c)
          .send(body);
      const get = (path: string, c: string) =>
        request(http).get(`/v1/${path}`).set("Cookie", c);
      const responseCookie = (response: request.Response) =>
        String(response.headers["set-cookie"][0]).split(";")[0];
      const masterRestricted = await cookie(master.id, "password");
      const password = "a new common permanent passphrase";
      const body = { password, confirmPassword: password };
      assert.equal(
        (await post("auth/initial-password", body, masterRestricted)).status,
        401,
      );
      await f.db.user.update({
        where: { id: master.id },
        data: { mustChangePassword: false, totpVerified: true },
      });
      const masterFull = await cookie(master.id);
      assert.equal(
        (await post("auth/initial-password", body, masterFull)).status,
        401,
      );
      const org = await f.db.organization.create({
        data: { name: "Temporary accounts" },
      });
      const members = `admin/organizations/${org.id}/members`;
      const temporary = "temporary shared passphrase";
      for (const username of ["temporary-a", "temporary-b"]) {
        const result = await post(
          members,
          {
            mode: "new",
            username,
            email: `${username}@example.invalid`,
            password: temporary,
          },
          masterFull,
        );
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, { saved: true });
        assert.equal(result.headers["set-cookie"], undefined);
      }
      const user = await f.db.user.findUniqueOrThrow({
        where: {
          emailIndex: f.auth.vault.index("temporary-a@example.invalid"),
        },
      });
      const other = await f.db.user.findUniqueOrThrow({
        where: {
          emailIndex: f.auth.vault.index("temporary-b@example.invalid"),
        },
      });
      assert.equal(user.master, false);
      assert.equal(user.mustChangePassword, true);
      assert.ok(await verifyPassword(user.passwordHash, temporary));
      assert.equal(await f.db.session.count({ where: { userId: user.id } }), 0);
      const login = () =>
        post("auth/login", { identifier: "temporary-a", password: temporary });
      const first = await login();
      assert.equal(first.status, 200);
      assert.equal(first.body.stage, "password");
      const restricted = responseCookie(first);
      const anotherRestricted = responseCookie(await login());
      const previousFull = await cookie(user.id); // Defense for preexisting/full sessions while flag is set.
      const expired = await cookie(user.id, "password", true);
      const otherCookie = responseCookie(
        await post("auth/login", {
          identifier: "temporary-b",
          password: temporary,
        }),
      );
      const storedRestricted = await f.db.session.findUniqueOrThrow({
        where: { digest: digest(restricted.split("=")[1]) },
      });
      assert.ok(+storedRestricted.expiresAt - Date.now() <= 600000);
      for (const c of [restricted, previousFull]) {
        for (const path of ["welcome", "admin/welcome", members])
          assert.equal((await get(path, c)).status, 401);
        assert.equal(
          (
            await post(
              "auth/profile",
              {
                username: "stolen",
                email: "stolen@example.invalid",
                currentPassword: temporary,
              },
              c,
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await post(
              "auth/password",
              {
                newPassword: password,
                confirmPassword: password,
                currentPassword: temporary,
              },
              c,
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await post(
              members,
              { mode: "existing", email: "temporary-b@example.invalid" },
              c,
            )
          ).status,
          401,
        );
        assert.equal(
          (await post("admin/auth/password", { password }, c)).status,
          401,
        );
        assert.equal((await post("admin/auth/totp/setup", {}, c)).status, 401);
      }
      for (const c of ["", expired, previousFull])
        assert.equal(
          (await post("auth/initial-password", body, c)).status,
          401,
        );
      for (const input of [
        { ...body, userId: user.id },
        { ...body, master: true },
        { ...body, confirmPassword: "different" },
        { password: "short", confirmPassword: "short" },
        { password },
      ]) {
        assert.equal(
          (await post("auth/initial-password", input, otherCookie)).status,
          400,
        );
      }
      const repeated = await post(
        "auth/initial-password",
        { password: temporary, confirmPassword: temporary },
        restricted,
      );
      assert.equal(repeated.status, 401);
      assert.deepEqual(repeated.body, {
        code: "PASSWORD_REUSED",
        message: "A nova senha deve ser diferente da senha atual.",
      });
      const policy = await post(
        "auth/initial-password",
        { password: "short", confirmPassword: "short" },
        restricted,
      );
      assert.equal(policy.status, 400);
      assert.match(policy.body.message, /15 a 1024/);
      assert.equal(
        (
          await post(
            "auth/initial-password",
            body,
            await cookie(other.id, "mfa"),
          )
        ).status,
        401,
      );
      const before = Date.now();
      const simultaneous = await Promise.all([
        post("auth/initial-password", body, restricted),
        post("auth/initial-password", body, anotherRestricted),
      ]);
      assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 401]);
      const success = simultaneous.find((r) => r.status === 200)!;
      assert.deepEqual(success.body, { stage: "full" });
      const full = responseCookie(success);
      assert.notEqual(full, restricted);
      assert.equal((await get("welcome", full)).status, 200);
      assert.equal((await get("admin/welcome", full)).status, 401);
      assert.equal((await get(members, full)).status, 401);
      for (const c of [restricted, anotherRestricted, previousFull]) {
        assert.equal((await get("auth/session", c)).status, 401);
        assert.equal(
          (await post("auth/initial-password", body, c)).status,
          401,
        );
      }
      const updated = await f.db.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      assert.equal(updated.mustChangePassword, false);
      assert.equal(updated.master, false);
      assert.ok(await verifyPassword(updated.passwordHash, password));
      assert.equal((await login()).status, 401);
      const storedFull = await f.db.session.findUniqueOrThrow({
        where: { digest: digest(full.split("=")[1]) },
      });
      assert.ok(+storedFull.expiresAt >= before + 8 * 3600000);
      assert.ok(+storedFull.expiresAt <= Date.now() + 8 * 3600000);
      assert.equal(await f.db.session.count({ where: { userId: user.id } }), 1);
      assert.equal(
        (await post("auth/login", { identifier: "temporary-a", password })).body
          .stage,
        "full",
      );
      const otherAfter = await f.db.user.findUniqueOrThrow({
        where: { id: other.id },
      });
      assert.equal(otherAfter.passwordHash, other.passwordHash);
      assert.equal(otherAfter.mustChangePassword, true);
      const otherOrg = await f.db.organization.create({
        data: { name: "Second" },
      });
      const sessionsBefore = await f.db.session.findMany({
        where: { userId: user.id },
        orderBy: { digest: "asc" },
      });
      assert.equal(
        (
          await post(
            `admin/organizations/${otherOrg.id}/members`,
            {
              mode: "existing",
              email: " TEMPORARY-A@EXAMPLE.INVALID ",
              role: "ORGANIZATION_ADMIN",
            },
            masterFull,
          )
        ).status,
        200,
      );
      assert.deepEqual(
        await f.db.user.findUnique({ where: { id: user.id } }),
        updated,
      );
      assert.deepEqual(
        await f.db.session.findMany({
          where: { userId: user.id },
          orderBy: { digest: "asc" },
        }),
        sessionsBefore,
      );
      assert.equal(
        await f.db.organizationMember.count({ where: { userId: user.id } }),
        2,
      );
    } finally {
      await f.close();
    }
  },
);
