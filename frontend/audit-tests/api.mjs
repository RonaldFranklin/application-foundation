import { createServer } from "node:http";
createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:18930");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  const cookie = req.headers.cookie ?? "";
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
  if (req.url === "/v1/audit/access") {
    if (cookie.includes("synthetic-admin"))
      return res.end(JSON.stringify({ organization: "Organização de teste" }));
    res.statusCode = 403;
    return res.end(JSON.stringify({ message: "Acesso negado" }));
  }
  if (req.url === "/v1/organizations" && common)
    return res.end(
      JSON.stringify({
        items: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "Organização de teste",
            active: true,
            role: cookie.includes("synthetic-admin")
              ? "ORGANIZATION_ADMIN"
              : "MEMBER",
            permissions: ["organization.read"],
          },
        ],
      }),
    );
  res.statusCode = 401;
  res.end('{"message":"Sessão inválida"}');
}).listen(18931, "127.0.0.1");
