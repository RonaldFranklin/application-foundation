ALTER TABLE "AuditEvent" ADD COLUMN "organizationIndex" TEXT;
CREATE INDEX "AuditEvent_organizationIndex_occurredAt_id_idx" ON "AuditEvent"("organizationIndex", "occurredAt", "id");
