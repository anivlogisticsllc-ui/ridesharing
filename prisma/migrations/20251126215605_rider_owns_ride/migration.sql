-- DropForeignKey
ALTER TABLE "Ride" DROP CONSTRAINT "Ride_driverId_fkey";

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "riderId" TEXT,
ALTER COLUMN "driverId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
