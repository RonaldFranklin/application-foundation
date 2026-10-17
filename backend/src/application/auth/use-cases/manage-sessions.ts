import { z } from "zod";
import { recordAudit } from "../../audit/events";
import { UnitOfWork } from "../ports/repositories";
import { Sessions } from "./sessions";

const empty = z.object({}).strict();
export class ManageSessions {
  constructor(
    private work: UnitOfWork,
    private sessions: Sessions,
  ) {}

  async list(raw: string | undefined, query: unknown) {
    if (!empty.safeParse(query).success)
      return { invalid: "sessions" as const };
    const initial = await this.sessions.authorized(raw, undefined);
    if (!initial) return null;
    return this.work.run(async (tx) => {
      await tx.lock(`account:${initial.userId}`);
      const current = await this.sessions.authorized(
        raw,
        undefined,
        tx.sessions,
      );
      if (!current) return null;
      const rows = await tx.sessions.listActive(current.userId, new Date());
      return {
        items: rows.map((row) => ({
          id: row.publicId,
          current: row.digest === current.digest,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          status:
            row.stage === "full"
              ? ("authenticated" as const)
              : ("pending" as const),
        })),
      };
    });
  }

  async revoke(raw: string | undefined, target: unknown, body: unknown) {
    const input = z.union([z.literal("others"), z.uuid()]).safeParse(target);
    if (!input.success || !empty.safeParse(body).success)
      return { invalid: "sessions" as const };
    const initial = await this.sessions.authorized(raw, undefined);
    if (!initial) return null;
    return this.work.run(async (tx) => {
      // Shared with issuance, password changes and administrative revocation.
      await tx.lock(`account:${initial.userId}`);
      const current = await this.sessions.authorized(
        raw,
        undefined,
        tx.sessions,
      );
      if (!current) return null;
      let endedCurrent = false;
      let count: number;
      if (input.data === "others") {
        count = await tx.sessions.deleteOthers(current.userId, current.digest);
      } else {
        const rows = await tx.sessions.listActive(current.userId, new Date());
        const target = rows.find(
          (row) => row.publicId === input.data.toLowerCase(),
        );
        // Same response for an expired, missing, or another account's session.
        if (!target) return { notFound: true as const };
        endedCurrent = target.digest === current.digest;
        await tx.sessions.delete(target.digest);
        count = 1;
      }
      await recordAudit(tx, {
        action: "account.sessions_revoked",
        actorId: current.userId,
        resourceId: current.userId,
        metadata: {
          scope:
            input.data === "others"
              ? "others"
              : endedCurrent
                ? "current"
                : "other",
          count,
        },
      });
      return { ok: true as const, endedCurrent };
    });
  }
}
