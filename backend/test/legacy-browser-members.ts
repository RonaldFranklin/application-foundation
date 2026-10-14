// Disposable browser fixtures only. Never imported by application code.
// Seeds legacy temporary-password accounts to retain first-access coverage after
// the production provisioning endpoint has been closed.
import { createServer } from "node:http";
import { fixture } from "./helpers";
import { hashPassword } from "../src/infra/security/crypto";
import { normalize } from "../src/application/auth/validators/auth-input";
export async function legacyBrowserMembers(
  f: Awaited<ReturnType<typeof fixture>>,
  port: number,
) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/members") {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body),
        username = normalize(input.username),
        email = normalize(input.email);
      if (!email.endsWith("@example.invalid")) throw new Error();
      const user = await f.db.user.create({
        data: {
          username: f.auth.vault.encrypt(username, "username"),
          email: f.auth.vault.encrypt(email, "email"),
          usernameIndex: f.auth.vault.index(username),
          emailIndex: f.auth.vault.index(email),
          passwordHash: await hashPassword(input.password),
          mustChangePassword: true,
        },
      });
      await f.db.organizationMember.create({
        data: {
          organizationId: input.organizationId,
          userId: user.id,
          role: input.role ?? "MEMBER",
        },
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ saved: true }));
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
