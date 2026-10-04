import { z } from "zod";
import { UnitOfWork } from "../auth/ports/repositories";
import { Sessions } from "../auth/use-cases/sessions";
import {
  VerificationChallenge,
  VerificationPublisher,
  VerificationSecrets,
  VerificationTransaction,
  verificationContext,
} from "./ports";
export type VerificationError =
  | "INPUT_INVALID"
  | "SESSION_REQUIRED"
  | "ALREADY_VERIFIED"
  | "COOLDOWN"
  | "SEND_LIMIT"
  | "CODE_INVALID"
  | "CODE_EXPIRED"
  | "ATTEMPT_LIMIT"
  | "CODE_USED"
  | "UNAVAILABLE";
export type VerificationResult =
  | { error: VerificationError; retryAfter?: number }
  | { expiresAt: string; retryAfter: number }
  | { emailVerifiedAt: string };
export class VerifyEmail {
  constructor(
    private work: UnitOfWork<VerificationTransaction>,
    private sessions: Sessions,
    private secrets: VerificationSecrets,
    private publisher: VerificationPublisher,
    private now: () => number = Date.now,
  ) {}
  async request(
    raw: string | undefined,
    body: unknown,
  ): Promise<VerificationResult> {
    if (!z.object({}).strict().safeParse(body).success)
      return { error: "INPUT_INVALID" };
    const initial = await this.sessions.authorized(raw, undefined);
    if (!initial) return { error: "SESSION_REQUIRED" };
    const prepared = await this.work.run(async (tx) => {
      await tx.lock(`account:${initial.userId}`);
      const s = await this.sessions.authorized(raw, undefined, tx.sessions);
      if (!s) return { error: "SESSION_REQUIRED" as const };
      if (s.user.emailVerifiedAt) return { error: "ALREADY_VERIFIED" as const };
      const now = this.now(),
        previous = await tx.verifications.forUser(s.userId);
      const requests = (previous?.requests ?? []).filter(
        (d) => +d > now - 3600000,
      );
      if (requests.length >= 5)
        return {
          error: "SEND_LIMIT" as const,
          retryAfter: Math.max(
            1,
            Math.ceil((+requests[0] + 3600000 - now) / 1000),
          ),
        };
      const last = requests.at(-1);
      if (last && +last + 60000 > now)
        return {
          error: "COOLDOWN" as const,
          retryAfter: Math.ceil((+last + 60000 - now) / 1000),
        };
      let { id, code } = this.secrets.generate();
      // Do not reissue the immediately preceding active code by chance.
      while (
        previous?.digest &&
        this.secrets.matches(
          code,
          verificationContext(previous),
          previous.digest,
        )
      ) {
        ({ id, code } = this.secrets.generate());
      }
      const c: VerificationChallenge = {
        id,
        userId: s.userId,
        emailFingerprint: s.user.emailIndex,
        digest: null,
        expiresAt: new Date(now + 600000),
        attempts: 0,
        consumedAt: null,
        deliveredAt: null,
        requests: [...requests, new Date(now)],
      };
      const context = verificationContext(c);
      c.digest = this.secrets.digest(code, context);
      const job = {
        challengeId: id,
        encryptedCode: this.secrets.encrypt(code, context),
      };
      await tx.verifications.save(c);
      return { c, job };
    });
    if (prepared.error)
      return { error: prepared.error, retryAfter: prepared.retryAfter };
    try {
      await this.publisher.publish(prepared.job);
    } catch {
      await this.work.run(async (tx) => {
        await tx.lock(`account:${initial.userId}`);
        const current = await tx.verifications.forUser(initial.userId);
        if (current?.id === prepared.c.id)
          await tx.verifications.invalidate(
            initial.userId,
            new Date(this.now()),
          );
      });
      return { error: "UNAVAILABLE" };
    }
    return { expiresAt: prepared.c.expiresAt.toISOString(), retryAfter: 60 };
  }
  async confirm(
    raw: string | undefined,
    body: unknown,
  ): Promise<VerificationResult> {
    const input = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .safeParse(body);
    if (!input.success) return { error: "INPUT_INVALID" };
    const initial = await this.sessions.authorized(raw, undefined);
    if (!initial) return { error: "SESSION_REQUIRED" };
    return this.work.run(async (tx) => {
      await tx.lock(`account:${initial.userId}`);
      const s = await this.sessions.authorized(raw, undefined, tx.sessions);
      if (!s) return { error: "SESSION_REQUIRED" };
      const c = await tx.verifications.forUser(s.userId),
        now = this.now();
      if (!c || c.emailFingerprint !== s.user.emailIndex)
        return { error: "CODE_INVALID" };
      if (c.consumedAt || !c.digest || s.user.emailVerifiedAt)
        return { error: "CODE_USED" };
      if (+c.expiresAt <= now) return { error: "CODE_EXPIRED" };
      if (c.attempts >= 5) return { error: "ATTEMPT_LIMIT" };
      if (
        !this.secrets.matches(input.data.code, verificationContext(c), c.digest)
      ) {
        c.attempts++;
        await tx.verifications.save(c);
        return { error: c.attempts >= 5 ? "ATTEMPT_LIMIT" : "CODE_INVALID" };
      }
      await tx.verifications.invalidate(s.userId, new Date(now));
      await tx.identities.updateCredentials(s.userId, {
        emailVerifiedAt: new Date(now),
      });
      return { emailVerifiedAt: new Date(now).toISOString() };
    });
  }
}
