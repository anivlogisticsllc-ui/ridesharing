-- CreateEnum
CREATE TYPE "OutstandingChargeStatus" AS ENUM ('OPEN', 'PAID', 'DISPUTED', 'WAIVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "OutstandingChargeReason" AS ENUM ('RIDER_REFUSED_CASH', 'RIDER_NO_CASH', 'OTHER');

-- CreateTable
CREATE TABLE "OutstandingCharge" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fareCents" INTEGER NOT NULL,
    "convenienceFeeCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "OutstandingChargeStatus" NOT NULL DEFAULT 'OPEN',
    "reportedByDriverId" TEXT NOT NULL,
    "reason" "OutstandingChargeReason" NOT NULL,
    "note" TEXT,
    "stripePaymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "disputedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OutstandingCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutstandingCharge_stripePaymentIntentId_key" ON "OutstandingCharge"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "OutstandingCharge_riderId_status_idx" ON "OutstandingCharge"("riderId", "status");

-- CreateIndex
CREATE INDEX "OutstandingCharge_reportedByDriverId_status_idx" ON "OutstandingCharge"("reportedByDriverId", "status");

-- CreateIndex
CREATE INDEX "OutstandingCharge_rideId_idx" ON "OutstandingCharge"("rideId");

-- CreateIndex
CREATE UNIQUE INDEX "OutstandingCharge_bookingId_key" ON "OutstandingCharge"("bookingId");

-- AddForeignKey
ALTER TABLE "OutstandingCharge" ADD CONSTRAINT "OutstandingCharge_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutstandingCharge" ADD CONSTRAINT "OutstandingCharge_reportedByDriverId_fkey" FOREIGN KEY ("reportedByDriverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutstandingCharge" ADD CONSTRAINT "OutstandingCharge_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutstandingCharge" ADD CONSTRAINT "OutstandingCharge_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
