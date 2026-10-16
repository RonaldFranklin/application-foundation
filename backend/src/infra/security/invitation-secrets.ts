import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { InvitationSecrets } from "../../application/organization-invitations/ports";
import { Vault } from "./crypto";
export class ProtectedInvitationSecrets implements InvitationSecrets {
  constructor(
    private vault: Vault,
    private purpose = "organization-invitation.v1",
  ) {}
  generate() {
    return { id: randomUUID(), token: randomBytes(32).toString("base64url") };
  }
  digest(token: string, context: string) {
    return createHash("sha256")
      .update(JSON.stringify([this.purpose, context, token]))
      .digest("hex");
  }
  matches(token: string, context: string, digest: string) {
    const a = Buffer.from(this.digest(token, context)),
      b = Buffer.from(digest);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  encrypt(token: string, context: string) {
    return this.vault.encrypt(token, this.purpose + ":" + context);
  }
  decrypt(envelope: string, context: string) {
    return this.vault.decrypt(envelope, this.purpose + ":" + context);
  }
}
