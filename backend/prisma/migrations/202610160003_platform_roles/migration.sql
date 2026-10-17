CREATE TABLE "PlatformRole" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "nameKey" TEXT NOT NULL UNIQUE,
 "permissions" TEXT[] NOT NULL, "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
 CHECK ("permissions" <@ ARRAY['organizations.read','organizations.create','organizations.update','organizations.status','organizations.delete','audit.read']::text[])
);
ALTER TABLE "PlatformAdmin" ADD COLUMN "roleId" TEXT REFERENCES "PlatformRole"("id") ON DELETE RESTRICT;
ALTER TABLE "PlatformAdminInvitation" ADD COLUMN "roleId" TEXT REFERENCES "PlatformRole"("id") ON DELETE RESTRICT;
CREATE INDEX "PlatformAdmin_roleId_idx" ON "PlatformAdmin"("roleId");
CREATE INDEX "PlatformAdminInvitation_roleId_idx" ON "PlatformAdminInvitation"("roleId");
-- No seed or backfill: existing individual grants remain unchanged.
