import { normalize } from "../../application/auth/validators/auth-input";
import {
  IdentityProtection,
  Tokens,
  Totp,
} from "../../application/auth/ports/security";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
} from "node:crypto";
import * as argon2 from "argon2";
import * as OTPAuth from "otpauth";
import { Config } from "../config/config";
export const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;
export const hashPassword = (password: string) =>
  argon2.hash(password, passwordOptions);
export const verifyPassword = (hash: string, password: string) =>
  argon2.verify(hash, password);
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class Vault implements IdentityProtection {
  constructor(private c: Config) {}
  encrypt(value: string, purpose: string) {
    const nonce = randomBytes(12),
      cipher = createCipheriv(
        "aes-256-gcm",
        Buffer.from(this.c.ENCRYPTION_KEY, "hex"),
        nonce,
      );
    cipher.setAAD(Buffer.from(`${this.c.KEY_VERSION}:${purpose}`));
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [
      this.c.KEY_VERSION,
      nonce.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      data.toString("base64url"),
    ].join(".");
  }
  decrypt(value: string, purpose: string) {
    const [version, nonce, tag, data] = value.split(".");
    if (version !== this.c.KEY_VERSION)
      throw new Error("Versão de chave indisponível");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(this.c.ENCRYPTION_KEY, "hex"),
      Buffer.from(nonce, "base64url"),
    );
    cipher.setAAD(Buffer.from(`${version}:${purpose}`));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      cipher.update(Buffer.from(data, "base64url")),
      cipher.final(),
    ]).toString("utf8");
  }
  index(value: string, purpose = "identity") {
    return `${this.c.KEY_VERSION}:${createHmac(
      "sha256",
      Buffer.from(this.c.HMAC_KEY, "hex"),
    )
      .update(`${purpose}:${normalize(value)}`)
      .digest("hex")}`;
  }
}
export function totp(secret?: string) {
  return new OTPAuth.TOTP({
    issuer: "Application Foundation",
    label: "Conta master",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: secret
      ? OTPAuth.Secret.fromBase32(secret)
      : new OTPAuth.Secret({ size: 20 }),
  });
}
export function totpStep(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totp(secret).validate({
    token: code,
    timestamp: now,
    window: 1,
  });
  return delta === null ? null : BigInt(Math.floor(now / 30000) + delta);
}

export const secureTokens: Tokens = {
  generate: token,
  digest,
  recoveryCode: () =>
    Buffer.from(token(), "base64url").subarray(0, 16).toString("hex"),
};
export const totpAdapter: Totp = {
  generateSecret: () => totp().secret.base32,
  uri: (secret) => totp(secret).toString(),
  step: totpStep,
};
