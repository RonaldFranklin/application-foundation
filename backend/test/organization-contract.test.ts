import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { permissionKeys } from "../src/application/organizations/permissions";

test("published organization contracts describe pagination, scoped access and fixed permission catalog", () => {
  const doc = JSON.parse(readFileSync("openapi.json", "utf8"));
  for (const prefix of ["/v1/admin/organizations", "/v1/organizations"]) {
    const members = doc.paths[`${prefix}/{id}/members`].get;
    const schema = members.responses[200].content["application/json"].schema;
    assert.deepEqual(schema.required, ["items", "total", "page", "pageSize"]);
    for (const name of ["search", "role", "page", "pageSize"])
      assert.ok(
        members.parameters.some(
          (p: { name: string; in: string }) =>
            p.name === name && p.in === "query",
        ),
      );
    const permissions = doc.paths[`${prefix}/{id}/permissions`];
    for (const method of ["get", "post"]) {
      const schema =
        permissions[method].responses[200].content["application/json"].schema;
      assert.deepEqual(Object.keys(schema.properties.roles.properties).sort(), [
        "MEMBER",
        "ORGANIZATION_ADMIN",
      ]);
      assert.deepEqual(Object.keys(schema.properties.catalog.properties), [
        ...permissionKeys,
      ]);
      assert.ok(permissions[method].responses[403]);
    }
    assert.ok(doc.paths[`${prefix}/{id}/members/{userId}`].post.responses[409]);
    const access =
      doc.paths[`${prefix}/{id}/access`].get.responses[200].content[
        "application/json"
      ].schema;
    assert.deepEqual(access.properties.permissions.items.enum, [
      ...permissionKeys,
    ]);
  }
});
