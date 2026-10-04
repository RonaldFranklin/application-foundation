import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("published error contracts preserve generic login and allow safe operation codes and field errors", () => {
  const doc = JSON.parse(readFileSync("openapi.json", "utf8"));
  for (const path of ["/v1/auth/login", "/v1/admin/auth/login"]) {
    const error =
      doc.paths[path].post.responses[401].content["application/json"].schema;
    assert.deepEqual(Object.keys(error.properties).sort(), [
      "challengeRequired",
      "message",
    ]);
  }
  for (const path of [
    "/v1/auth/initial-password",
    "/v1/admin/auth/password",
    "/v1/auth/password",
    "/v1/auth/profile",
    "/v1/admin/auth/mfa",
    "/v1/admin/auth/totp/enroll",
  ]) {
    const error =
      doc.paths[path].post.responses[401].content["application/json"].schema;
    assert.ok(error.properties.code.enum.includes("PASSWORD_REUSED"));
    assert.ok(error.properties.code.enum.includes("MFA_INVALID"));
    assert.ok(!error.required.includes("code"));
  }
  for (const path of [
    "/v1/auth/initial-password",
    "/v1/auth/password",
    "/v1/auth/profile",
  ]) {
    const error =
      doc.paths[path].post.responses[400].content["application/json"].schema;
    assert.deepEqual(error.required, ["message"]);
    assert.equal(error.properties.fields.additionalProperties.type, "string");
  }
});
