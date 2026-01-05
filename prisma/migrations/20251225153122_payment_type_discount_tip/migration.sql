/*
  Warnings:

  - A unique constraint covering the columns `[stripePaymentIntentId]` on the table `RidePayment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripeChargeId]` on the table `RidePayment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[idempotencyKey]` on the table `RidePayment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripeCustomerId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CARD', 'CASH');

-- DropForeignKey
ALTER TABLE "RidePayment" DROP CONSTRAINT "RidePayment_rideId_fkey";

-- DropForeignKey
ALTER TABLE "RidePayment" DROP CONSTRAINT "RidePayment_riderId_fkey";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cashDiscountBps" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "paymentMethodId" TEXT,
ADD COLUMN     "paymentType" "PaymentType" NOT NULL DEFAULT 'CARD';

-- AlterTable
ALTER TABLE "RidePayment" ADD COLUMN     "authorizedAt" TIMESTAMP(3),
ADD COLUMN     "baseAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "finalAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "paymentType" "PaymentType" NOT NULL DEFAULT 'CARD',
ADD COLUMN     "stripeChargeId" TEXT,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT,
ALTER COLUMN "currency" SET DEFAULT 'usd';

-- CreateIndex
CREATE INDEX "Booking_paymentType_idx" ON "Booking"("paymentType");

-- CreateIndex
CREATE INDEX "Booking_paymentMethodId_idx" ON "Booking"("paymentMethodId");

-- CreateIndex
CREATE INDEX "PaymentMethod_userId_isDefault_idx" ON "PaymentMethod"("userId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "RidePayment_stripePaymentIntentId_key" ON "RidePayment"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "RidePayment_stripeChargeId_key" ON "RidePayment"("stripeChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "RidePayment_idempotencyKey_key" ON "RidePayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RidePayment_paymentType_idx" ON "RidePayment"("paymentType");

-- CreateIndex
CREATE INDEX "RidePayment_status_idx" ON "RidePayment"("status");

-- CreateIndex
CREATE INDEX "RidePayment_stripePaymentIntentId_idx" ON "RidePayment"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RidePayment" ADD CONSTRAINT "RidePayment_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RidePayment" ADD CONSTRAINT "RidePayment_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
