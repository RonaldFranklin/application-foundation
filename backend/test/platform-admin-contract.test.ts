import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("platform OpenAPI separates invitation activation, administrative identity and closed grants", () => {
  const doc = JSON.parse(readFileSync("openapi.json", "utf8"));
  const response = (path: string, method = "post") =>
    doc.paths[path][method].responses[200].content["application/json"].schema;
  const list = response("/v1/admin/platform-admins", "get");
  assert.deepEqual(Object.keys(list.properties).sort(), [
    "catalog",
    "items",
    "page",
    "pageSize",
    "total",
  ]);
  const account = list.properties.items.items;
  assert.equal(account.additionalProperties, false);
  assert.equal(account.properties.digest, undefined);
  assert.equal(account.properties.passwordHash, undefined);
  assert.ok(account.properties.permissions.items.enum.includes("audit.read"));
  assert.equal(
    account.properties.permissions.items.enum.includes("master"),
    false,
  );
  const activate = doc.paths["/v1/platform-admin-invitations/accept"].post;
  assert.deepEqual(activate.security, []);
  assert.deepEqual(
    Object.keys(response("/v1/platform-admin-invitations/accept").properties),
    ["accepted"],
  );
  assert.equal(
    activate.requestBody.content["application/json"].schema.properties.token
      .writeOnly,
    true,
  );
  assert.deepEqual(
    Object.keys(response("/v1/admin/platform-admins/{id}").properties),
    ["saved"],
  );
  assert.deepEqual(
    Object.keys(
      response("/v1/admin/platform-admins/invitations").properties,
    ).sort(),
    ["expiresAt", "queued"],
  );
  assert.ok(
    response("/v1/auth/session", "get").required.includes("administrative"),
  );
  assert.deepEqual(
    response("/v1/admin/welcome", "get").properties.accountType.enum,
    ["master", "platform-admin"],
  );
  assert.deepEqual(response("/v1/welcome", "get").properties.accountType.enum, [
    "common",
  ]);
});
