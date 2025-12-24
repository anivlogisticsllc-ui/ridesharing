/*
  Warnings:

  - Added the required column `updatedAt` to the `Membership` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
-- 1) Add as nullable first
ALTER TABLE "Membership" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- 2) Backfill existing rows (use createdAt if present)
UPDATE "Membership"
SET "updatedAt" = COALESCE("updatedAt", "createdAt", NOW())
WHERE "updatedAt" IS NULL;

-- 3) Make it required
ALTER TABLE "Membership" ALTER COLUMN "updatedAt" SET NOT NULL;


-- AlterTable
ALTER TABLE "User" ALTER COLUMN "name" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Booking_rideId_idx" ON "Booking"("rideId");

-- CreateIndex
CREATE INDEX "Booking_riderId_idx" ON "Booking"("riderId");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE INDEX "Conversation_rideId_idx" ON "Conversation"("rideId");

-- CreateIndex
CREATE INDEX "Conversation_driverId_idx" ON "Conversation"("driverId");

-- CreateIndex
CREATE INDEX "Conversation_riderId_idx" ON "Conversation"("riderId");

-- CreateIndex
CREATE INDEX "DriverServiceCity_driverProfileId_idx" ON "DriverServiceCity"("driverProfileId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "Membership_userId_type_startDate_idx" ON "Membership"("userId", "type", "startDate");

-- CreateIndex
CREATE INDEX "Membership_userId_type_expiryDate_idx" ON "Membership"("userId", "type", "expiryDate");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "Ride_driverId_status_idx" ON "Ride"("driverId", "status");

-- CreateIndex
CREATE INDEX "Ride_riderId_status_idx" ON "Ride"("riderId", "status");

-- CreateIndex
CREATE INDEX "Ride_departureTime_idx" ON "Ride"("departureTime");

-- CreateIndex
CREATE INDEX "Transaction_driverId_idx" ON "Transaction"("driverId");

-- CreateIndex
CREATE INDEX "Transaction_rideId_idx" ON "Transaction"("rideId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");
