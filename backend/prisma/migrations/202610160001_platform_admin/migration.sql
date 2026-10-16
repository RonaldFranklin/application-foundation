CREATE TABLE "PlatformAdmin" (
 "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE RESTRICT,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "permissions" TEXT[] NOT NULL DEFAULT '{}',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "platform_permissions_closed" CHECK ("permissions" <@ ARRAY['organizations.read','organizations.create','organizations.update','organizations.status','organizations.delete','audit.read']::text[])
);
CREATE TABLE "PlatformAdminInvitation" (
 "id" TEXT PRIMARY KEY,
 "email" TEXT NOT NULL,
 "emailFingerprint" TEXT NOT NULL UNIQUE,
 "digest" TEXT NOT NULL,
 "permissions" TEXT[] NOT NULL DEFAULT '{}',
 "createdBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "acceptedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3),
 "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
 CHECK ("acceptedAt" IS NULL OR "revokedAt" IS NULL),
 CHECK ("permissions" <@ ARRAY['organizations.read','organizations.create','organizations.update','organizations.status','organizations.delete','audit.read']::text[])
);
CREATE INDEX "PlatformAdminInvitation_expiresAt_idx" ON "PlatformAdminInvitation"("expiresAt");
-- Serialize checks on the same identity even for writes outside application code.
CREATE FUNCTION enforce_platform_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid TEXT;
BEGIN
 IF TG_TABLE_NAME = 'User' THEN uid := NEW."id"; ELSE uid := NEW."userId"; END IF;
 PERFORM 1 FROM "User" WHERE "id" = uid FOR UPDATE;
 IF TG_TABLE_NAME = 'PlatformAdmin' THEN
   IF EXISTS (SELECT 1 FROM "User" WHERE "id"=uid AND "master") OR EXISTS (SELECT 1 FROM "OrganizationMember" WHERE "userId"=uid) THEN
     RAISE EXCEPTION 'INCOMPATIBLE_ACCOUNT_SCOPE';
   END IF;
 ELSIF TG_TABLE_NAME = 'OrganizationMember' THEN
   IF EXISTS (SELECT 1 FROM "PlatformAdmin" WHERE "userId"=uid) THEN RAISE EXCEPTION 'INCOMPATIBLE_ACCOUNT_SCOPE'; END IF;
 ELSE
   IF NEW."master" AND EXISTS (SELECT 1 FROM "PlatformAdmin" WHERE "userId"=uid) THEN RAISE EXCEPTION 'INCOMPATIBLE_ACCOUNT_SCOPE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER platform_identity BEFORE INSERT OR UPDATE ON "PlatformAdmin" FOR EACH ROW EXECUTE FUNCTION enforce_platform_identity();
CREATE TRIGGER member_platform_identity BEFORE INSERT OR UPDATE ON "OrganizationMember" FOR EACH ROW EXECUTE FUNCTION enforce_platform_identity();
CREATE TRIGGER master_platform_identity BEFORE UPDATE OF "master" ON "User" FOR EACH ROW EXECUTE FUNCTION enforce_platform_identity();
