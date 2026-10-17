ALTER TABLE "User" ADD COLUMN "mfaEnrollmentOptional" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD CONSTRAINT "master_mfa_required" CHECK (NOT "master" OR NOT "mfaEnrollmentOptional");
