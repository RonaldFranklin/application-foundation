import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { VerificationSecrets } from "../../application/email-verification/ports";
import { Config } from "../config/config";
import { Vault } from "./crypto";
export class ProtectedVerificationSecrets implements VerificationSecrets {
  private key: Buffer;
  constructor(
    private c: Config,
    private vault: Vault,
  ) {
    this.key = createHmac("sha256", Buffer.from(c.HMAC_KEY, "hex"))
      .update(`email-verification-hmac:${c.KEY_VERSION}`)
      .digest();
  }
  generate() {
    return {
      id: randomUUID(),
      code: randomInt(1000000).toString().padStart(6, "0"),
    };
  }
  digest(code: string, context: string) {
    return (
      this.c.KEY_VERSION +
      ":" +
      createHmac("sha256", this.key)
        .update(JSON.stringify([context, code]))
        .digest("hex")
    );
  }
  matches(code: string, context: string, digest: string) {
    const expected = Buffer.from(this.digest(code, context)),
      actual = Buffer.from(digest);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
  encrypt(code: string, context: string) {
    return this.vault.encrypt(code, "email-verification:" + context);
  }
  decrypt(envelope: string, context: string) {
    return this.vault.decrypt(envelope, "email-verification:" + context);
  }
}
