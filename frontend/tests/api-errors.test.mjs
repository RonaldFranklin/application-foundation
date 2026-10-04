import { test } from "node:test";
import assert from "node:assert/strict";
import { apiError } from "../src/lib/api-errors.ts";

test("login never distinguishes accounts or accepts detailed error codes", () => {
  for (const payload of [
    { message: "Account exists" },
    { code: "PASSWORD_REUSED" },
    { code: "ATTEMPTS_BLOCKED" },
    null,
  ]) {
    assert.equal(
      apiError(401, payload, "auth/login").message,
      "E-mail ou senha inválidos.",
    );
    assert.deepEqual(
      apiError(400, { fields: { email: "secret" } }, "admin/auth/login").fields,
      {},
    );
  }
});
test("safe causes and status errors are contextual and sanitize unknown payloads", () => {
  assert.match(
    apiError(401, { code: "PASSWORD_REUSED" }, "auth/initial-password").message,
    /diferente/,
  );
  assert.match(
    apiError(401, { code: "MFA_INVALID" }, "admin/auth/mfa").message,
    /Código inválido/,
  );
  assert.match(
    apiError(401, { code: "REAUTHENTICATION_FAILED" }, "auth/password").fields
      .currentPassword,
    /senha atual/,
  );
  for (const path of [
    "auth/password",
    "auth/profile",
    "admin/auth/mfa",
    "admin/organizations/x/members",
  ]) {
    assert.doesNotMatch(
      apiError(401, { message: "E-mail ou senha inválidos." }, path).message,
      /E-mail/,
    );
    for (const status of [400, 403, 404, 409, 413, 429, 500, 503]) {
      const result = apiError(
        status,
        {
          message: "SELECT secret FROM users",
          fields: { email: "SELECT secret" },
          code: "UNKNOWN",
        },
        path,
      );
      assert.doesNotMatch(JSON.stringify(result), /SELECT|secret|users/);
    }
  }
  assert.match(apiError(429, null, "auth/login").message, /Aguarde/);
  assert.match(
    apiError(503, { message: "internal details" }, "auth/login").message,
    /temporariamente/,
  );
  assert.match(
    apiError(409, null, "admin/organizations/x/members").message,
    /Atualize/,
  );
  assert.deepEqual(
    apiError(
      400,
      {
        fields: {
          newPassword: "Use uma nova senha de 15 a 1024 caracteres.",
          email: "arbitrary detail",
        },
      },
      "auth/password",
    ).fields,
    { newPassword: "Use uma nova senha de 15 a 1024 caracteres." },
  );
});
