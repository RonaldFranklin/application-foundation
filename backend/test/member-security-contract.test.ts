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
});
