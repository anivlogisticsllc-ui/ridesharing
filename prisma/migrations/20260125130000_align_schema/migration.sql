-- Align migration history with existing DB schema changes already applied manually

-- 1) Enum: add AUTHORIZED
ALTER TYPE "RidePaymentStatus" ADD VALUE IF NOT EXISTS 'AUTHORIZED';

-- 2) Conversation timestamp precision
ALTER TABLE "Conversation"
  ALTER COLUMN "driverLastReadAt" TYPE TIMESTAMP(6),
  ALTER COLUMN "riderLastReadAt" TYPE TIMESTAMP(6);

-- 3) User: rename adminGrantEndsAt -> freeMembershipEndsAt (implemented as drop/add)
ALTER TABLE "User"
  DROP COLUMN IF EXISTS "adminGrantEndsAt",
  ADD COLUMN IF NOT EXISTS "freeMembershipEndsAt" TIMESTAMPTZ(6);

-- 4) Ride: ensure unique clientRequestId
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'Ride_clientRequestId_key'
  ) THEN
    CREATE UNIQUE INDEX "Ride_clientRequestId_key" ON "Ride"("clientRequestId");
  END IF;
END $$;