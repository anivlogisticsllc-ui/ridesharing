-- CreateIndex
CREATE INDEX "RidePayment_paymentMethodId_idx" ON "RidePayment"("paymentMethodId");

-- AddForeignKey
ALTER TABLE "RidePayment" ADD CONSTRAINT "RidePayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
