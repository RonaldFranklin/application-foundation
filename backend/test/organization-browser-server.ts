import { fixture } from "./helpers";
import { digest } from "../src/infra/security/crypto";

async function main() {
  const f = await fixture(18740, {
    frontend: "http://localhost:18730",
    api: "http://localhost:18731",
  });
  const master = await f.db.user.findFirstOrThrow({ where: { master: true } });
  await f.db.user.update({
    where: { id: master.id },
    data: { mustChangePassword: false, totpVerified: true },
  });
  // Synthetic session exclusively for this disposable loopback test fixture.
  await f.db.session.create({
    data: {
      userId: master.id,
      digest: digest("organization-browser-master"),
      stage: "full",
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  await f.app.listen(18731, "127.0.0.1");
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await f.close();
    process.exit(0);
  }
  process.on("SIGTERM", () => void close());
  process.on("SIGINT", () => void close());
}
void main();
