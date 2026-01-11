-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "driverLastReadAt" TIMESTAMP(3),
ADD COLUMN     "riderLastReadAt" TIMESTAMP(3);
