import { fixture } from "./helpers";
import { hashPassword } from "../src/infra/security/crypto";
async function main() {
  if (
    !process.env.FIXTURE_MASTER_PASSWORD ||
    !process.env.FIXTURE_USER_PASSWORD
  )
    throw new Error("Synthetic test credentials required");
  const f = await fixture(Number(process.env.LOGIN_TEST_DB_PORT || 15440), {
    frontend: process.env.FIXTURE_FRONTEND_ORIGIN || "http://localhost:3000",
    api: process.env.FIXTURE_API_ORIGIN || "http://localhost:3001",
  });
  const v = f.auth.vault;
  await f.db.user.create({
    data: {
      username: v.encrypt("fixture-user", "username"),
      email: v.encrypt("user@example.invalid", "email"),
      usernameIndex: v.index("fixture-user"),
      emailIndex: v.index("user@example.invalid"),
      passwordHash: await hashPassword(process.env.FIXTURE_USER_PASSWORD),
    },
  });
  await f.app.listen(Number(process.env.LOGIN_TEST_API_PORT || 3001), "0.0.0.0");
  console.info("Application Foundation fixture ready");
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await f.close();
    process.exit(0);
  }
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}
void main();
