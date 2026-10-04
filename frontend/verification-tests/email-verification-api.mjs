// Synthetic API exclusively for the focused UI tests. No SMTP, Redis or real account.
import { createServer } from "node:http";
let verified = null;
createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:18630");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.end();
    return;
  }
  let body = "";
  for await (const part of req) body += part;
  const reply = (status, data) => {
    res.statusCode = status;
    res.end(JSON.stringify(data));
  };
  if (req.url === "/reset") {
    verified = null;
    reply(200, {});
    return;
  }
  if (req.url?.endsWith("/welcome")) {
    reply(200, {
      username: "Pessoa de teste",
      email: "verification@example.invalid",
      emailVerifiedAt: verified,
      accountType: "common",
      mfa: { configured: false, verified: false },
    });
    return;
  }
  if (req.url === "/v1/auth/session") {
    reply(200, { stage: "full", master: false });
    return;
  }
  if (req.url === "/v1/organizations") {
    reply(200, []);
    return;
  }
  if (req.url === "/v1/auth/email-verification/request") {
    reply(200, {
      retryAfter: 60,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });
    return;
  }
  if (req.url === "/v1/auth/email-verification/confirm") {
    if (JSON.parse(body).code !== "123456") {
      reply(400, { code: "CODE_INVALID" });
      return;
    }
    verified = new Date().toISOString();
    reply(200, { emailVerifiedAt: verified });
    return;
  }
  reply(200, { status: "ok" });
}).listen(18631, "127.0.0.1");
