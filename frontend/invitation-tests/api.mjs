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
  if (req.url?.endsWith("/welcome"))
    return res.end(
      JSON.stringify({
        username: "Master de teste",
        email: "master@example.invalid",
        emailVerifiedAt: "2026-01-01T00:00:00.000Z",
        accountType: "master",
        mfa: { configured: true, verified: true },
      }),
    );
  res.end(JSON.stringify({ status: "ok" }));
}).listen(18831, "127.0.0.1");
