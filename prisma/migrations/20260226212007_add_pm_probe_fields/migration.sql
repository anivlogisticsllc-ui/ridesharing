/*
  Warnings:

  - A unique constraint covering the columns `[stripePaymentIntentId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "stripePaymentIntentId" TEXT,
ADD COLUMN     "stripePaymentIntentStatus" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pmStripeLastVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "pmStripeProbeFailCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pmStripeProbeFailedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_stripePaymentIntentId_key" ON "Booking"("stripePaymentIntentId");
