import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("member security contract exposes only display metadata and Master reauthentication", () => {
  const doc = JSON.parse(readFileSync("openapi.json", "utf8"));
  for (const prefix of ["/v1/organizations", "/v1/admin/organizations"]) {
    const path = Object.keys(doc.paths).find(
      (p) => p.startsWith(prefix + "/") && p.endsWith("/members"),
    )!;
    const item =
      doc.paths[path].get.responses["200"].content["application/json"].schema
        .properties.items.items;
    assert.deepEqual(
      Object.keys(item.properties).sort(),
      [
        "canResetCredentials",
        "userId",
        "username",
        "email",
        "role",
        "organization",
        "mfa",
        "lastLoginAt",
        "createdAt",
        "deletedAt",
      ].sort(),
    );
    assert.equal(item.properties.lastLoginAt.nullable, true);
  }
  assert.equal(doc.paths["/v1/accounts/{id}/mfa/reset"].post.deprecated, true);
  const reset = doc.paths["/v1/admin/accounts/{id}/mfa/reset"].post;
  assert.deepEqual(
    reset.requestBody.content["application/json"].schema.required,
    ["currentPassword", "code"],
  );
  assert.equal(
    reset.requestBody.content["application/json"].schema.additionalProperties,
    false,
  );
  assert.deepEqual(
    reset.responses["200"].content["application/json"].schema.required,
    ["ok"],
  );
  assert.ok(reset.responses["401"]);
  for (const prefix of ["/v1/admin/accounts", "/v1/accounts"]) {
    const operation = doc.paths[`${prefix}/{id}/password/reset`].post;
    const input = operation.requestBody.content["application/json"].schema;
    assert.equal(input.additionalProperties, false);
    assert.equal(input.properties.temporaryPassword.writeOnly, true);
    assert.equal(input.properties.temporaryPassword.minLength, 15);
    assert.equal(input.properties.confirmPassword.writeOnly, true);
    assert.equal(input.properties.organizationId, undefined);
    assert.deepEqual(
      operation.responses[200].content["application/json"].schema.required,
      ["ok"],
    );
  }
  for (const path of [
    "/v1/auth/mfa/start",
    "/v1/auth/totp/setup",
    "/v1/auth/totp/enroll",
    "/v1/auth/mfa",
    "/v1/auth/confirm",
  ])
    assert.ok(doc.paths[path].post);
});
