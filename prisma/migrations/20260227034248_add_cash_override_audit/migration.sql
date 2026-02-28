-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cashDiscountRevokedAt" TIMESTAMP(3),
ADD COLUMN     "cashDiscountRevokedReason" TEXT,
ADD COLUMN     "cashNotPaidAt" TIMESTAMP(3),
ADD COLUMN     "cashNotPaidByUserId" TEXT,
ADD COLUMN     "fallbackCardChargedAt" TIMESTAMP(3),
ADD COLUMN     "originalCashDiscountBps" INTEGER DEFAULT 0,
ADD COLUMN     "originalPaymentType" "PaymentType";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cashDiscountAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cashDiscountApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cashDiscountEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cashDiscountRevoked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cashDiscountRevokedAt" TIMESTAMP(3),
ADD COLUMN     "cashNotPaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cashNotPaidReason" TEXT,
ADD COLUMN     "cashReceivedMarkedAt" TIMESTAMP(3),
ADD COLUMN     "cashReceivedMarkedById" TEXT,
ADD COLUMN     "finalPaymentType" "PaymentType",
ADD COLUMN     "requestedPaymentType" "PaymentType";

-- CreateTable
CREATE TABLE "RideAuditLog" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "meta" JSONB,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RideAuditLog_bookingId_createdAt_idx" ON "RideAuditLog"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_originalPaymentType_idx" ON "Booking"("originalPaymentType");

-- CreateIndex
CREATE INDEX "Booking_cashNotPaidAt_idx" ON "Booking"("cashNotPaidAt");

-- AddForeignKey
ALTER TABLE "RideAuditLog" ADD CONSTRAINT "RideAuditLog_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
