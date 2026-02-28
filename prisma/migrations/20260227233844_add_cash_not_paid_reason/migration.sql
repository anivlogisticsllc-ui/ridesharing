-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cashNotPaidReason" TEXT;

-- CreateIndex
CREATE INDEX "Booking_cashNotPaidReason_idx" ON "Booking"("cashNotPaidReason");
