/*
  Warnings:

  - A unique constraint covering the columns `[clientRequestId]` on the table `Ride` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Ride_clientRequestId_key" ON "Ride"("clientRequestId");
