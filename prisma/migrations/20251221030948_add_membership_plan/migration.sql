-- CreateEnum
CREATE TYPE "MembershipPlan" AS ENUM ('STANDARD');

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "plan" "MembershipPlan" NOT NULL DEFAULT 'STANDARD';
