import { createServer } from "node:http";
const contexts = new Map();
const orgA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orgB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:18930");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  const cookie = req.headers.cookie ?? "";
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  const key = /login_session=([^;]+)/.exec(cookie)?.[1] ?? "";
  const admin = cookie.includes("synthetic-admin");
  const ids = cookie.includes("multi") ? [orgA, orgB] : [orgA];
  const orgName = (id) =>
    id === orgA ? "Organização de teste" : "Outra organização";
  const selected = contexts.get(key);
  const master = cookie.includes("synthetic-master");
  const common =
    cookie.includes("synthetic-admin") || cookie.includes("synthetic-member");
  if (req.url === "/v1/health") return res.end('{"status":"ok"}');
  if (
    req.url?.endsWith("/welcome") &&
    ((req.url === "/v1/admin/welcome" && master) ||
      (req.url === "/v1/welcome" && common))
  )
    return res.end(
      JSON.stringify({
        username: master ? "Master de teste" : "Conta organizacional",
        email: "fixture@example.invalid",
        emailVerifiedAt: "2026-01-01T00:00:00Z",
        accountType: master ? "master" : "common",
        mfa: { configured: master, verified: master },
      }),
    );
  if (req.url === "/v1/organization-context") {
    if (!admin) {
      res.statusCode = 403;
      return res.end("{}");
    }
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const id = JSON.parse(body).organizationId;
      if (!ids.includes(id)) {
        res.statusCode = 403;
        return res.end("{}");
      }
      contexts.set(key, id);
      return res.end(JSON.stringify({ organizationId: id, name: orgName(id) }));
    }
    if (!selected) {
      res.statusCode = 409;
      return res.end("{}");
    }
    return res.end(
      JSON.stringify({ organizationId: selected, name: orgName(selected) }),
    );
  }
  if (req.url === "/v1/audit/access") {
    if (admin && selected)
      return res.end(JSON.stringify({ organization: orgName(selected) }));
    res.statusCode = admin ? 409 : 403;
    return res.end(
      JSON.stringify({ message: "Selecione uma organização autorizada" }),
    );
  }
  const organization = (id) => ({
    id,
    name: orgName(id),
    active: true,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  const access = (id) => ({
    ...organization(id),
    role: admin ? "ORGANIZATION_ADMIN" : "MEMBER",
    permissions: ["organization.read", "organization.update"],
    userId: "fixture-user",
  });
  if (req.url === "/v1/organizations" && common)
    return res.end(JSON.stringify({ items: ids.map(access) }));
  const detail = /^\/v1\/organizations\/([^/?]+)(\/access)?$/.exec(
    req.url ?? "",
  );
  if (
    detail &&
    common &&
    ids.includes(detail[1]) &&
    (!admin || selected === detail[1])
  )
    return res.end(
      JSON.stringify(detail[2] ? access(detail[1]) : organization(detail[1])),
    );
  res.statusCode = 401;
  res.end('{"message":"Sessão inválida"}');
}).listen(18931, "127.0.0.1");
