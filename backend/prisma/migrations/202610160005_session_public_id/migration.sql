ALTER TABLE "Session" ADD COLUMN "publicId" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "Session_publicId_key" ON "Session"("publicId");
