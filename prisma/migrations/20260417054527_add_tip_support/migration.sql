/*
  Warnings:

  - A unique constraint covering the columns `[stripeTipChargeId]` on the table `RidePayment` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TipStatus" AS ENUM ('NOT_OFFERED', 'ELIGIBLE', 'PENDING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "RidePayment" ADD COLUMN     "stripeTipChargeId" TEXT,
ADD COLUMN     "tipAmountCents" INTEGER DEFAULT 0,
ADD COLUMN     "tipChargedAt" TIMESTAMP(3),
ADD COLUMN     "tipPercent" INTEGER,
ADD COLUMN     "tipSelectedAt" TIMESTAMP(3),
ADD COLUMN     "tipSkippedAt" TIMESTAMP(3),
ADD COLUMN     "tipStatus" "TipStatus" NOT NULL DEFAULT 'NOT_OFFERED';

-- CreateIndex
CREATE UNIQUE INDEX "RidePayment_stripeTipChargeId_key" ON "RidePayment"("stripeTipChargeId");
