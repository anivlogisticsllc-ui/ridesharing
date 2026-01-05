/*
  Warnings:

  - The values [WARNED] on the enum `AccountStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AccountStatus_new" AS ENUM ('ACTIVE', 'DISABLED', 'SUSPENDED');
ALTER TABLE "public"."User" ALTER COLUMN "accountStatus" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "accountStatus" TYPE "AccountStatus_new" USING ("accountStatus"::text::"AccountStatus_new");
ALTER TYPE "AccountStatus" RENAME TO "AccountStatus_old";
ALTER TYPE "AccountStatus_new" RENAME TO "AccountStatus";
DROP TYPE "public"."AccountStatus_old";
ALTER TABLE "User" ALTER COLUMN "accountStatus" SET DEFAULT 'ACTIVE';
COMMIT;
