import { z } from "zod";
import { AuditAction, validateAudit } from "../../../application/audit/events";
import { IdentityProtection } from "../../../application/auth/ports/security";
import { PrismaService } from "../prisma/prisma.service";

// Derived indexes only: encrypted history is never rewritten. Restartable and
// safe across replicas; memory and each transaction are bounded to 100 rows.
export async function backfillAuditOrganizations(
  db: PrismaService,
  vault: IdentityProtection,
) {
  try {
    for (;;) {
      const rows = await db.auditEvent.findMany({
        where: { organizationIndex: null },
        orderBy: { id: "asc" },
        take: 100,
      });
      if (!rows.length) return;
      const updates = rows.map((row) => {
        const details = z
          .object({
            actorId: z.uuid().nullable(),
            organizationId: z.uuid().nullable(),
            resourceId: z.uuid().nullable(),
            metadata: z.record(z.string(), z.unknown()).default({}),
          })
          .strict()
          .parse(
            JSON.parse(
              vault.decrypt(
                row.details,
                JSON.stringify([
                  "audit:v1",
                  row.id,
                  row.occurredAt.toISOString(),
                  row.action,
                  row.outcome,
                  row.resourceType,
                ]),
              ),
            ),
          );
        const event = validateAudit({
          action: row.action as AuditAction,
          ...details,
        });
        if (
          event.outcome !== row.outcome ||
          event.resourceType !== row.resourceType
        )
          throw new Error();
        return db.auditEvent.updateMany({
          where: { id: row.id, organizationIndex: null },
          data: {
            organizationIndex: vault.index(
              details.organizationId ?? "none",
              "audit-organization",
            ),
          },
        });
      });
      await db.$transaction(updates);
    }
  } catch {
    throw new Error("AUDIT_INDEX_UNAVAILABLE");
  }
}
