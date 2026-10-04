import { UnitOfWork } from "../ports/repositories";
import { AuthSettings } from "../auth-settings";
import { IdentityProtection, Passwords } from "../ports/security";
export class BootstrapMaster {
  constructor(
    private work: UnitOfWork,
    private c: AuthSettings,
    private vault: IdentityProtection,
    private passwords: Passwords,
  ) {}
  async init() {
    await this.passwords.init();
    await this.work.run(
      async (tx) => {
        await tx.lock("master-bootstrap");
        if (await tx.identities.findMaster()) return;
        await tx.lock("identity-update");
        const usernameIndex = this.vault.index(this.c.MASTER_USERNAME),
          emailIndex = this.vault.index(this.c.MASTER_EMAIL);
        if (await tx.identities.findCollision(usernameIndex, emailIndex))
          throw new Error("Conflito no bootstrap master");
        await tx.identities.create({
          username: this.vault.encrypt(this.c.MASTER_USERNAME, "username"),
          email: this.vault.encrypt(this.c.MASTER_EMAIL, "email"),
          usernameIndex,
          emailIndex,
          passwordHash: await this.passwords.hash(
            this.c.MASTER_INITIAL_PASSWORD,
          ),
          master: true,
          mustChangePassword: true,
        });
      },
      { timeout: 15000 },
    );
  }
}
