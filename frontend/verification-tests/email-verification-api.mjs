// Synthetic API exclusively for the focused UI tests. No SMTP, Redis or real account.
import { createServer } from "node:http";
let verified = null;
let ended = false;
const initialSessions = () => [
  {
    id: "11111111-1111-4111-8111-111111111111",
    current: true,
    status: "authenticated",
    createdAt: "2026-10-16T12:00:00.000Z",
    expiresAt: "2026-10-16T20:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    current: false,
    status: "authenticated",
    createdAt: "2026-10-16T11:00:00.000Z",
    expiresAt: "2026-10-16T19:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    current: false,
    status: "pending",
    createdAt: "2026-10-16T12:10:00.000Z",
    expiresAt: "2026-10-16T12:20:00.000Z",
  },
];
let sessions = initialSessions();
let username = "Pessoa de teste",
  email = "verification@example.invalid",
  master = false;
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
    ended = false;
    sessions = initialSessions();
    username = "Pessoa de teste";
    email = "verification@example.invalid";
    master = body ? !!JSON.parse(body).master : false;
    reply(200, {});
    return;
  }
  if (
    ended &&
    (req.url?.endsWith("/welcome") || req.url === "/v1/auth/session")
  ) {
    reply(401, { code: "SESSION_REQUIRED" });
    return;
  }
  if (req.url === "/v1/auth/sessions") {
    reply(200, { items: sessions });
    return;
  }
  if (
    req.url?.startsWith("/v1/auth/sessions/") &&
    req.url.endsWith("/revoke")
  ) {
    const id = req.url.split("/")[4];
    ended = sessions.some((s) => s.id === id && s.current);
    sessions = sessions.filter((s) =>
      id === "others" ? s.current : s.id !== id,
    );
    if (ended) res.setHeader("Set-Cookie", "login_session=; Path=/; Max-Age=0");
    reply(200, { ok: true, endedCurrent: ended });
    return;
  }
  if (req.url?.endsWith("/welcome")) {
    reply(200, {
      username,
      email,
      emailVerifiedAt: verified,
      accountType: master ? "master" : "common",
      mfa: { configured: master, verified: master },
    });
    return;
  }
  if (req.url === "/v1/auth/profile") {
    const input = JSON.parse(body);
    if (
      input.currentPassword !== "test-current-password" ||
      (master && input.code !== "654321")
    ) {
      reply(401, { code: master ? "MFA_INVALID" : "REAUTHENTICATION_FAILED" });
      return;
    }
    username = input.username.trim();
    if (email !== input.email.trim().toLowerCase()) verified = null;
    email = input.email.trim().toLowerCase();
    reply(200, { passwordChanged: false });
    return;
  }
  if (req.url === "/v1/auth/session") {
    reply(200, { stage: "full", master });
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
