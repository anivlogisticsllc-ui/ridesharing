/*
  Warnings:

  - You are about to drop the column `bookingId` on the `RidePayment` table. All the data in the column will be lost.
  - You are about to drop the column `providerRef` on the `RidePayment` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[stripePaymentMethodId]` on the table `PaymentMethod` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "AccountStatus" ADD VALUE 'WARNED';

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_paymentMethodId_fkey";

-- DropForeignKey
ALTER TABLE "RidePayment" DROP CONSTRAINT "RidePayment_bookingId_fkey";

-- DropIndex
DROP INDEX "Booking_paymentMethodId_idx";

-- DropIndex
DROP INDEX "Booking_paymentType_idx";

-- DropIndex
DROP INDEX "Ride_clientRequestId_key";

-- DropIndex
DROP INDEX "RidePayment_bookingId_idx";

-- DropIndex
DROP INDEX "RidePayment_paymentType_idx";

-- DropIndex
DROP INDEX "RidePayment_providerRef_key";

-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "cashDiscountBps" DROP NOT NULL,
ALTER COLUMN "cashDiscountBps" SET DEFAULT 0,
ALTER COLUMN "paymentType" DROP NOT NULL,
ALTER COLUMN "baseAmountCents" DROP NOT NULL,
ALTER COLUMN "baseAmountCents" DROP DEFAULT,
ALTER COLUMN "currency" DROP NOT NULL,
ALTER COLUMN "currency" SET DEFAULT 'USD',
ALTER COLUMN "discountCents" DROP NOT NULL,
ALTER COLUMN "discountCents" DROP DEFAULT,
ALTER COLUMN "finalAmountCents" DROP NOT NULL,
ALTER COLUMN "finalAmountCents" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN     "stripePaymentMethodId" TEXT;

-- AlterTable
ALTER TABLE "RidePayment" DROP COLUMN "bookingId",
DROP COLUMN "providerRef",
ALTER COLUMN "baseAmountCents" DROP NOT NULL,
ALTER COLUMN "discountCents" DROP NOT NULL,
ALTER COLUMN "finalAmountCents" DROP NOT NULL,
ALTER COLUMN "paymentType" DROP NOT NULL,
ALTER COLUMN "paymentType" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "DriverProfile_userId_idx" ON "DriverProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_stripePaymentMethodId_key" ON "PaymentMethod"("stripePaymentMethodId");
