-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "baseAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'usd',
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "finalAmountCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RidePayment" ADD COLUMN     "bookingId" TEXT;

-- CreateIndex
CREATE INDEX "RidePayment_bookingId_idx" ON "RidePayment"("bookingId");

-- AddForeignKey
ALTER TABLE "RidePayment" ADD CONSTRAINT "RidePayment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
