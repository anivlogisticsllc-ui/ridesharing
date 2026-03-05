/*
  Warnings:

  - A unique constraint covering the columns `[userId,stripePaymentMethodId]` on the table `PaymentMethod` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "PaymentMethod_providerPaymentMethodId_key";

-- DropIndex
DROP INDEX "PaymentMethod_stripePaymentMethodId_key";

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_userId_stripePaymentMethodId_key" ON "PaymentMethod"("userId", "stripePaymentMethodId");
