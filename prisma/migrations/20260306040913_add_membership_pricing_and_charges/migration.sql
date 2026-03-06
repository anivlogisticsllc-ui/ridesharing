-- CreateEnum
CREATE TYPE "MembershipInterval" AS ENUM ('MONTHLY');

-- CreateEnum
CREATE TYPE "MembershipChargeStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED');

-- CreateTable
CREATE TABLE "MembershipPricing" (
    "id" TEXT NOT NULL,
    "membershipType" "MembershipType" NOT NULL,
    "plan" "MembershipPlan" NOT NULL DEFAULT 'STANDARD',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amountCents" INTEGER NOT NULL,
    "interval" "MembershipInterval" NOT NULL DEFAULT 'MONTHLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipCharge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT,
    "paymentMethodId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "MembershipChargeStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'STRIPE',
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "MembershipCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPricing_membershipType_key" ON "MembershipPricing"("membershipType");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipCharge_stripePaymentIntentId_key" ON "MembershipCharge"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipCharge_stripeChargeId_key" ON "MembershipCharge"("stripeChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipCharge_providerRef_key" ON "MembershipCharge"("providerRef");

-- CreateIndex
CREATE INDEX "MembershipCharge_userId_status_idx" ON "MembershipCharge"("userId", "status");

-- CreateIndex
CREATE INDEX "MembershipCharge_membershipId_idx" ON "MembershipCharge"("membershipId");

-- CreateIndex
CREATE INDEX "MembershipCharge_paymentMethodId_idx" ON "MembershipCharge"("paymentMethodId");

-- AddForeignKey
ALTER TABLE "MembershipCharge" ADD CONSTRAINT "MembershipCharge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipCharge" ADD CONSTRAINT "MembershipCharge_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipCharge" ADD CONSTRAINT "MembershipCharge_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
