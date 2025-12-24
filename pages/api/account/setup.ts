// pages/api/account/setup.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { UserRole } from "@prisma/client";

function addOneMonth(d: Date) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1);
  return x;
}

function parseDateOrNull(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ error: "Not authenticated" });

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
  } = (req.body ?? {}) as Record<string, any>;

  if (!addressLine1 || !city || !state || !postalCode) {
    return res.status(400).json({ error: "Missing required address fields." });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });

  if (!user) return res.status(404).json({ error: "User not found" });

  // Free trial window, but DO NOT mark paid membership as active here
  const trialEndsAt = addOneMonth(new Date());

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      addressLine1: String(addressLine1).trim(),
      addressLine2: addressLine2 ? String(addressLine2).trim() : null,
      city: String(city).trim(),
      state: String(state).trim(),
      postalCode: String(postalCode).trim(),
      country: country ? String(country).trim() : "US",

      onboardingCompleted: true,

      // Membership intent/trial info (safe defaults)
      membershipPlan: membershipPlan ? String(membershipPlan) : "STANDARD",
      membershipActive: false, // key fix: don't "activate" before payment
      trialEndsAt,
    },
  });

  // Only treat DRIVER as driver 
  if (updatedUser.role === UserRole.DRIVER) {
    await prisma.driverProfile.upsert({
      where: { userId: updatedUser.id },
      update: {
        driverLicenseNumber: driverLicenseNumber ? String(driverLicenseNumber).trim() : null,
        driverLicenseState: driverLicenseState ? String(driverLicenseState).trim() : null,
        driverLicenseExpiry: parseDateOrNull(driverLicenseExpiry),
        verificationStatus: "PENDING",
      },
      create: {
        userId: updatedUser.id,
        driverLicenseNumber: driverLicenseNumber ? String(driverLicenseNumber).trim() : null,
        driverLicenseState: driverLicenseState ? String(driverLicenseState).trim() : null,
        driverLicenseExpiry: parseDateOrNull(driverLicenseExpiry),
        verificationStatus: "PENDING",
      },
    });
  }

  // Your UI says "Continue to membership"
  return res.status(200).json({ ok: true, redirectTo: "/billing/membership" });
}
