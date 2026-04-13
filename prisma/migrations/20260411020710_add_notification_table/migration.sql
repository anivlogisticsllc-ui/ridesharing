/*
  Warnings:

  - You are about to drop the `OutstandingCharge` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[stripeConnectedAccountId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CASH_UNPAID_FALLBACK_CHARGED', 'DISPUTE_OPENED', 'DISPUTE_STATUS_UPDATED', 'DISPUTE_RESOLVED_RIDER', 'DISPUTE_RESOLVED_DRIVER', 'REFUND_ISSUED', 'DRIVER_CASH_BLOCKED_30_DAYS', 'DRIVER_REMOVED_FOR_REPEAT_CASH_FRAUD');

-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM ('CASH_ALREADY_PAID', 'UNAUTHORIZED_FALLBACK_CHARGE', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED_RIDER', 'RESOLVED_DRIVER', 'CLOSED');

-- CreateEnum
CREATE TYPE "DisputeDecision" AS ENUM ('RIDER_FAVORED', 'DRIVER_FAVORED', 'NO_ACTION');

-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM ('DISPUTE_MARKED_UNDER_REVIEW', 'DISPUTE_RESOLVED_RIDER', 'DISPUTE_RESOLVED_DRIVER', 'FALLBACK_CHARGE_REFUNDED', 'DRIVER_CASH_BLOCKED_30_DAYS', 'DRIVER_REMOVED_FOR_REPEAT_CASH_FRAUD');

-- CreateEnum
CREATE TYPE "AdminTargetType" AS ENUM ('DISPUTE', 'RIDE', 'BOOKING', 'USER', 'RIDE_PAYMENT', 'REFUND');

-- DropForeignKey
ALTER TABLE "OutstandingCharge" DROP CONSTRAINT "OutstandingCharge_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "OutstandingCharge" DROP CONSTRAINT "OutstandingCharge_reportedByDriverId_fkey";

-- DropForeignKey
ALTER TABLE "OutstandingCharge" DROP CONSTRAINT "OutstandingCharge_rideId_fkey";

-- DropForeignKey
ALTER TABLE "OutstandingCharge" DROP CONSTRAINT "OutstandingCharge_riderId_fkey";

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "cardPayableNetAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cashRideServiceFeeOffsetCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "driverDisputeFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "executedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "payoutWeekEnd" TIMESTAMP(3),
ADD COLUMN     "payoutWeekKey" TEXT,
ADD COLUMN     "payoutWeekStart" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "processorFeeLostCents" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cashRideBlockedUntil" TIMESTAMP(3),
ADD COLUMN     "cashRidePermanentlyBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cashRideViolationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "externalBankLast4" TEXT,
ADD COLUMN     "externalBankName" TEXT,
ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "removedReason" TEXT,
ADD COLUMN     "stripeAccountReady" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeConnectedAccountId" TEXT,
ADD COLUMN     "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "OutstandingCharge";

-- DropEnum
DROP TYPE "OutstandingChargeReason";

-- DropEnum
DROP TYPE "OutstandingChargeStatus";

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rideId" TEXT,
    "bookingId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "ridePaymentId" TEXT,
    "riderId" TEXT NOT NULL,
    "driverId" TEXT,
    "reason" "DisputeReason" NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "riderStatement" TEXT NOT NULL,
    "adminDecision" "DisputeDecision",
    "adminNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" TEXT,
    "refundIssued" BOOLEAN NOT NULL DEFAULT false,
    "refundAmountCents" INTEGER,
    "refundIssuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "disputeId" TEXT,
    "actionType" "AdminActionType" NOT NULL,
    "targetType" "AdminTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_type_idx" ON "Notification"("userId", "type");

-- CreateIndex
CREATE INDEX "Notification_rideId_idx" ON "Notification"("rideId");

-- CreateIndex
CREATE INDEX "Notification_bookingId_idx" ON "Notification"("bookingId");

-- CreateIndex
CREATE INDEX "Dispute_rideId_idx" ON "Dispute"("rideId");

-- CreateIndex
CREATE INDEX "Dispute_bookingId_idx" ON "Dispute"("bookingId");

-- CreateIndex
CREATE INDEX "Dispute_ridePaymentId_idx" ON "Dispute"("ridePaymentId");

-- CreateIndex
CREATE INDEX "Dispute_riderId_status_idx" ON "Dispute"("riderId", "status");

-- CreateIndex
CREATE INDEX "Dispute_driverId_status_idx" ON "Dispute"("driverId", "status");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminUserId_createdAt_idx" ON "AdminAuditLog"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_disputeId_idx" ON "AdminAuditLog"("disputeId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actionType_createdAt_idx" ON "AdminAuditLog"("actionType", "createdAt");

-- CreateIndex
CREATE INDEX "Payout_driverId_payoutWeekKey_idx" ON "Payout"("driverId", "payoutWeekKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeConnectedAccountId_key" ON "User"("stripeConnectedAccountId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_ridePaymentId_fkey" FOREIGN KEY ("ridePaymentId") REFERENCES "RidePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE SET NULL ON UPDATE CASCADE;
