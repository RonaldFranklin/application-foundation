CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('success', 'failure')),
  "resourceType" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditEvent_occurredAt_id_idx" ON "AuditEvent"("occurredAt", "id");
CREATE INDEX "AuditEvent_action_occurredAt_idx" ON "AuditEvent"("action", "occurredAt");
ALTER TABLE "OrganizationInvitation" ADD COLUMN "expiryAuditedAt" TIMESTAMP(3);
CREATE INDEX "OrganizationInvitation_expiryAuditedAt_expiresAt_idx" ON "OrganizationInvitation"("expiryAuditedAt", "expiresAt");
