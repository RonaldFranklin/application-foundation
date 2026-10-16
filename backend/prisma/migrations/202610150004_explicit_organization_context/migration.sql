-- Do not copy the old implicit audit scope: selection must be explicit.
ALTER TABLE "Session" ADD COLUMN "activeOrganization" TEXT;
