-- AlterTable
ALTER TABLE "User" ADD COLUMN     "membershipActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "membershipPlan" TEXT,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);
