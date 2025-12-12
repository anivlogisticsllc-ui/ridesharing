-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "plateNumber" TEXT,
ADD COLUMN     "plateState" TEXT,
ADD COLUMN     "vehicleColor" TEXT,
ADD COLUMN     "vehicleMake" TEXT,
ADD COLUMN     "vehicleModel" TEXT,
ADD COLUMN     "vehicleYear" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "onboardingStep" INTEGER;
