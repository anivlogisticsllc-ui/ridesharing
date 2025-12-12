// pages/api/account/setup.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { UserRole } from "@prisma/client";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session?.user?.email) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const {
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
    driverLicenseNumber,
    driverLicenseState,
    driverLicenseExpiry,
    membershipPlan,
  } = req.body as {
    addressLine1?: string;
    addressLine2?: string | null;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    driverLicenseNumber?: string | null;
    driverLicenseState?: string | null;
    driverLicenseExpiry?: string | null;
    membershipPlan?: string | null;
  };

  if (!addressLine1 || !city || !state || !postalCode) {
    return res
      .status(400)
      .json({ error: "Missing required address fields." });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email.toLowerCase() },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // First month free: trial end = now + 1 month
  const trialEndsAt = new Date();
  trialEndsAt.setMonth(trialEndsAt.getMonth() + 1);

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      addressLine1,
      addressLine2: addressLine2 || null,
      city,
      state,
      postalCode,
      country: country || "US",
      onboardingCompleted: true,

      // membership fields
      membershipPlan: membershipPlan || "STANDARD",
      membershipActive: true,
      trialEndsAt,
    },
  });

  // If driver or both, upsert DriverProfile with license info
  if (
    updatedUser.role === UserRole.DRIVER ||
    updatedUser.role === UserRole.BOTH
  ) {
    await prisma.driverProfile.upsert({
      where: { userId: updatedUser.id },
      update: {
        driverLicenseNumber: driverLicenseNumber || null,
        driverLicenseState: driverLicenseState || null,
        driverLicenseExpiry: driverLicenseExpiry
          ? new Date(driverLicenseExpiry)
          : null,
        verificationStatus: "PENDING",
      },
      create: {
        userId: updatedUser.id,
        driverLicenseNumber: driverLicenseNumber || null,
        driverLicenseState: driverLicenseState || null,
        driverLicenseExpiry: driverLicenseExpiry
          ? new Date(driverLicenseExpiry)
          : null,
        verificationStatus: "PENDING",
      },
    });
  }

  // NEW: after setup + membership, send drivers to portal, riders to home
  let redirectTo = "/";

  if (
    updatedUser.role === UserRole.DRIVER ||
    updatedUser.role === UserRole.BOTH
  ) {
    redirectTo = "/driver/portal";
  }

  return res.status(200).json({ ok: true, redirectTo });
}
