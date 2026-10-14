import { legacyBrowserMembers } from "./legacy-browser-members";
import { fixture } from "./helpers";
import { OrganizationAccess } from "../src/application/organizations/use-cases/organization-access";
import { digest, hashPassword } from "../src/infra/security/crypto";

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
  const hash = await hashPassword("synthetic organization browser password");
  async function user(name: string) {
    return f.db.user.create({
      data: {
        username: f.auth.vault.encrypt(name, "username"),
        email: f.auth.vault.encrypt(`${name}@example.invalid`, "email"),
        usernameIndex: f.auth.vault.index(name),
        emailIndex: f.auth.vault.index(`${name}@example.invalid`),
        passwordHash: hash,
      },
    });
  }
  const single = await user("admin-single"),
    multiple = await user("admin-multiple"),
    member = await user("plain-member"),
    removed = await user("removed-admin"),
    inactive = await user("inactive-admin");
  const one = await f.db.organization.create({
    data: { name: "Admin Single Organization" },
  });
  const multiA = await f.db.organization.create({
    data: { name: "Admin Multiple A" },
  });
  const multiB = await f.db.organization.create({
    data: { name: "Admin Multiple B" },
  });
  const delegated = await f.db.organization.create({
    data: { name: "Delegated Member Organization" },
  });
  const disabled = await f.db.organization.create({
    data: { name: "Inactive Organization", active: false },
  });
  await f.db.organizationMember.createMany({
    data: [
      { organizationId: one.id, userId: single.id, role: "ORGANIZATION_ADMIN" },
      {
        organizationId: multiA.id,
        userId: multiple.id,
        role: "ORGANIZATION_ADMIN",
      },
      {
        organizationId: multiB.id,
        userId: multiple.id,
        role: "ORGANIZATION_ADMIN",
      },
      { organizationId: delegated.id, userId: multiple.id, role: "MEMBER" },
      { organizationId: one.id, userId: member.id, role: "MEMBER" },
      {
        organizationId: one.id,
        userId: removed.id,
        role: "ORGANIZATION_ADMIN",
        deletedAt: new Date(),
      },
      {
        organizationId: disabled.id,
        userId: inactive.id,
        role: "ORGANIZATION_ADMIN",
      },
    ],
  });
  await f.db.organizationPermissionGrant.create({
    data: {
      organizationId: delegated.id,
      role: "MEMBER",
      permission: "ORGANIZATION_READ",
    },
  });
  // A test-only dependency failure, scoped to a synthetic session, exercises SSR fail-closed feedback.
  await f.db.session.create({
    data: {
      userId: single.id,
      digest: digest("organization-browser-unavailable"),
      stage: "full",
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const access = f.app.get(OrganizationAccess),
    directory = access.directory.bind(access);
  access.directory = async (raw) => {
    if (raw === "organization-browser-unavailable")
      throw new Error("Synthetic directory failure");
    return directory(raw);
  };
  const legacy = await legacyBrowserMembers(f, 18732);
  await f.app.listen(18731, "127.0.0.1");
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await legacy.close();
    await f.close();
    process.exit(0);
  }
  process.on("SIGTERM", () => void close());
  process.on("SIGINT", () => void close());
}
void main();
