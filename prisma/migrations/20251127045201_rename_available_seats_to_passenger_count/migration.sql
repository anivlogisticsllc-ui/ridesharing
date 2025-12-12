/*
  Warnings:

  - You are about to drop the column `availableSeats` on the `Ride` table. All the data in the column will be lost.
  - You are about to drop the column `pricePerSeatCents` on the `Ride` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Ride" DROP COLUMN "availableSeats",
DROP COLUMN "pricePerSeatCents",
ADD COLUMN     "passengerCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "totalPriceCents" INTEGER NOT NULL DEFAULT 0;
