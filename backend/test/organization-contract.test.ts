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
    for (const name of ["search", "role", "page", "pageSize", "deleted"])
      assert.ok(
        members.parameters.some(
          (p: { name: string; in: string }) =>
            p.name === name && p.in === "query",
        ),
      );
    assert.equal(
      schema.properties.items.items.properties.deletedAt.nullable,
      true,
    );
    for (const suffix of [
      "/{id}/remove",
      "/{id}/restore",
      "/{id}/members/{userId}/restore",
    ]) {
      const operation = doc.paths[prefix + suffix].post;
      assert.ok(operation.responses[401]);
      assert.equal(
        operation.requestBody.content["application/json"].schema
          .additionalProperties,
        false,
      );
    }
    assert.equal(
      doc.paths[prefix + "/{id}"].get.responses[200].content["application/json"]
        .schema.properties.deletedAt.nullable,
      true,
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
    assert.deepEqual(access.properties.role.enum, [
      "MEMBER",
      "ORGANIZATION_ADMIN",
    ]);
    assert.equal(access.properties.userId.format, "uuid");
    assert.deepEqual(access.properties.permissions.items.enum, [
      ...permissionKeys,
    ]);
  }
});

test("invitation contract exposes strict inputs, scoped management and closed direct provisioning", () => {
  const doc = JSON.parse(readFileSync("openapi.json", "utf8"));
  for (const prefix of ["/v1/admin/organizations", "/v1/organizations"]) {
    assert.ok(doc.paths[`${prefix}/{id}/members`].post.responses[410]);
    assert.equal(doc.paths[`${prefix}/{id}/members`].post.deprecated, true);
    const invite = doc.paths[`${prefix}/{id}/invitations`];
    assert.ok(invite.get.responses[200]);
    assert.ok(invite.post.responses[429]);
    assert.equal(
      invite.post.requestBody.content["application/json"].schema
        .additionalProperties,
      false,
    );
    for (const action of ["resend", "revoke"])
      assert.ok(
        doc.paths[`${prefix}/{id}/invitations/{invitationId}/${action}`].post
          .responses[403],
      );
  }
  for (const action of ["preview", "accept"]) {
    const path = doc.paths[`/v1/invitations/${action}`];
    assert.equal(path.get, undefined);
    assert.deepEqual(path.post.security, []);
    assert.equal(path.post.responses[200].headers?.["Set-Cookie"], undefined);
  }
});
