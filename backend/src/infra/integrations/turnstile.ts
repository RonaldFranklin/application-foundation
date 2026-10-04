import { Captcha } from "../../application/auth/ports/security";
import { Config } from "../config/config";
export class Turnstile implements Captcha {
  constructor(private c: Config) {}
  async verify(value: string | undefined, ip: string) {
    const c = this.c;
    if (!c.TURNSTILE_SECRET_KEY || !value) return false;
    try {
      const response = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body: new URLSearchParams({
            secret: c.TURNSTILE_SECRET_KEY,
            response: value,
            remoteip: ip,
          }),
          signal: AbortSignal.timeout(4000),
        },
      );
      if (!response.ok) return false;
      const result = (await response.json()) as {
        success?: boolean;
        hostname?: string;
        action?: string;
        challenge_ts?: string;
      };
      const age = Date.now() - Date.parse(result.challenge_ts || "");
      return (
        result.success === true &&
        result.action === "master-login" &&
        (!c.TURNSTILE_HOSTNAME || result.hostname === c.TURNSTILE_HOSTNAME) &&
        Number.isFinite(age) &&
        age >= -30000 &&
        age < 300000
      );
    } catch {
      return false;
    }
  }
}
