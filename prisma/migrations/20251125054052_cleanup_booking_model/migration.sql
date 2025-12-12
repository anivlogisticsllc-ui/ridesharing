/*
  Warnings:

  - You are about to drop the column `passengerId` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `seatsBooked` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `totalPriceCents` on the `Booking` table. All the data in the column will be lost.
  - Added the required column `riderEmail` to the `Booking` table without a default value. This is not possible if the table is not empty.
  - Added the required column `riderName` to the `Booking` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Booking` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_passengerId_fkey";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "passengerId",
DROP COLUMN "seatsBooked",
DROP COLUMN "totalPriceCents",
ADD COLUMN     "riderEmail" TEXT NOT NULL,
ADD COLUMN     "riderName" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
