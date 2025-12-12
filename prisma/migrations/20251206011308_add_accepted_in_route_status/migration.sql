/*
  Warnings:

  - The values [FULL] on the enum `RideStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "RideStatus_new" AS ENUM ('OPEN', 'ACCEPTED', 'IN_ROUTE', 'COMPLETED', 'CANCELLED');
ALTER TABLE "public"."Ride" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Ride" ALTER COLUMN "status" TYPE "RideStatus_new" USING ("status"::text::"RideStatus_new");
ALTER TYPE "RideStatus" RENAME TO "RideStatus_old";
ALTER TYPE "RideStatus_new" RENAME TO "RideStatus";
DROP TYPE "public"."RideStatus_old";
ALTER TABLE "Ride" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;
