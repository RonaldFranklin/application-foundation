import { AuditEvent } from "@prisma/client";
import { IdentityProtection } from "../src/application/auth/ports/security";
export function auditDetails(row: AuditEvent, vault: IdentityProtection) {
  return JSON.parse(
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
  ) as {
    actorId: string | null;
    organizationId: string | null;
    resourceId: string | null;
    metadata: Record<string, unknown>;
  };
}
