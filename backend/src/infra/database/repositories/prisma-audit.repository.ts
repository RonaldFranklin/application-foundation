import { randomUUID } from "node:crypto";
import {
  AuditEvent,
  AuditRepository,
  validateAudit,
} from "../../../application/audit/events";
import { IdentityProtection } from "../../../application/auth/ports/security";
import { QueryClient, persist } from "./records";
export class PrismaAuditRepository implements AuditRepository {
  constructor(
    private db: QueryClient,
    private vault: IdentityProtection,
  ) {}
  async append(event: AuditEvent) {
    const e = validateAudit(event);
    const id = randomUUID();
    const occurredAt = e.occurredAt ?? new Date();
    const purpose = JSON.stringify([
      "audit:v1",
      id,
      occurredAt.toISOString(),
      e.action,
      e.outcome,
      e.resourceType,
    ]);
    const details = this.vault.encrypt(
      JSON.stringify({
        actorId: e.actorId ?? null,
        organizationId: e.organizationId ?? null,
        resourceId: e.resourceId ?? null,
        metadata: e.metadata,
      }),
      purpose,
    );
    await persist(() =>
      this.db.auditEvent.create({
        data: {
          id,
          occurredAt,
          action: e.action,
          outcome: e.outcome,
          resourceType: e.resourceType,
          details,
          organizationIndex: this.vault.index(
            e.organizationId ?? "none",
            "audit-organization",
          ),
        },
      }),
    );
  }
  async bestEffort(event: AuditEvent) {
    try {
      await this.db.$executeRaw`SAVEPOINT audit_attempt`;
      try {
        await this.append(event);
      } catch {
        await this.db.$executeRaw`ROLLBACK TO SAVEPOINT audit_attempt`;
        console.warn('{"event":"audit_write_failed"}');
      }
      await this.db.$executeRaw`RELEASE SAVEPOINT audit_attempt`;
    } catch {
      console.warn('{"event":"audit_write_failed"}');
    }
  }
}
