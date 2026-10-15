import { createServer } from "node:http";
createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:18830");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.end();
  for await (const _part of req) {
    void _part;
  }
  const master = req.url?.startsWith("/v1/admin/");
  const permissions = [
    "organization.read",
    "organization.update",
    "members.read",
    "members.create",
    "members.link",
    "members.roles",
    "members.remove",
    "permissions.manage",
  ];
  const access = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Organização de teste",
    active: true,
    role:
      req.headers.cookie?.includes("synthetic-readonly") ||
      req.headers.cookie?.includes("synthetic-invite-no-roles")
        ? "MEMBER"
        : "ORGANIZATION_ADMIN",
    permissions: req.headers.cookie?.includes("synthetic-readonly")
      ? ["organization.read", "members.read"]
      : req.headers.cookie?.includes("synthetic-invite-no-roles")
        ? [
            "organization.read",
            "members.read",
            "members.create",
            "members.link",
          ]
        : permissions,
  };
  if (req.url?.endsWith("/access")) return res.end(JSON.stringify(access));
  if (req.url === "/v1/organizations")
    return res.end(JSON.stringify({ items: [access] }));
  if (req.url?.endsWith("/welcome"))
    return res.end(
      JSON.stringify({
        username: master ? "Master de teste" : "Administrador de teste",
        email: "master@example.invalid",
        emailVerifiedAt: "2026-01-01T00:00:00.000Z",
        accountType: master ? "master" : "common",
        mfa: { configured: true, verified: true },
      }),
    );
  res.end(JSON.stringify({ status: "ok" }));
}).listen(18831, "127.0.0.1");
