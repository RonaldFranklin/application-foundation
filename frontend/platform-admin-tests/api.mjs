import { createServer } from "node:http";
createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:19030");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.url === "/v1/health") return res.end("{}");
  const cookie = req.headers.cookie ?? "";
  const master = cookie.includes("synthetic-master");
  const delegate = cookie.includes("synthetic-delegate");
  const read = cookie.includes("reader");
  if (req.url === "/v1/admin/welcome" && (master || delegate))
    return res.end(
      JSON.stringify({
        username: "Conta de teste",
        email: "fixture@example.invalid",
        emailVerifiedAt: "2026-01-01T00:00:00Z",
        accountType: master ? "master" : "platform-admin",
        platformPermissions: read
          ? ["organizations.read"]
          : cookie.includes("creator")
            ? ["organizations.create"]
            : [],
        mfa: {
          configured: !cookie.includes("optional"),
          verified: !cookie.includes("optional"),
        },
      }),
    );
  if (req.url === "/v1/auth/session" && (master || delegate))
    return res.end(
      JSON.stringify({ stage: "full", master, administrative: true }),
    );
  res.statusCode = 401;
  res.end('{"message":"Sessão inválida"}');
}).listen(19031, "127.0.0.1");
