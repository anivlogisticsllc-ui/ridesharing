-- CreateEnum
CREATE TYPE "DriverVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "driverLicenseExpiry" TIMESTAMP(3),
ADD COLUMN     "driverLicenseImageUrl" TEXT,
ADD COLUMN     "driverLicenseNumber" TEXT,
ADD COLUMN     "driverLicenseState" TEXT,
ADD COLUMN     "verificationNotes" TEXT,
ADD COLUMN     "verificationStatus" "DriverVerificationStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'US',
ADD COLUMN     "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeDefaultPaymentId" TEXT;
