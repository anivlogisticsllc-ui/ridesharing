// pages/api/account/setup.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { MembershipPlan, MembershipStatus, MembershipType, UserRole } from "@prisma/client";

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function parseDateOrNull(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function roleToMembershipType(role: UserRole): MembershipType {
  return role === UserRole.DRIVER ? MembershipType.DRIVER : MembershipType.RIDER;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).end();
    }

    const session = await getServerSession(req, res, authOptions);
    const email = session?.user?.email?.toLowerCase();
    if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });

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
      return res.status(400).json({ ok: false, error: "Missing required address fields." });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });

    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const now = new Date();
    const trialEndsAt = addDays(now, 30);

    // You can keep this "plan" on user for display if you want, but it doesn't drive gating anymore.
    const userPlan = membershipPlan ? String(membershipPlan) : "STANDARD";

    await prisma.$transaction(async (tx) => {
      // 1) Update user profile
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          addressLine1: String(addressLine1).trim(),
          addressLine2: addressLine2 ? String(addressLine2).trim() : null,
          city: String(city).trim(),
          state: String(state).trim(),
          postalCode: String(postalCode).trim(),
          country: country ? String(country).trim() : "US",

          onboardingCompleted: true,

          // legacy/display fields (ok to keep, but membership gating uses membership table)
          membershipPlan: userPlan,
          membershipActive: false,
          trialEndsAt,
        },
      });

      // 2) Driver profile (only for DRIVER)
      if (updatedUser.role === UserRole.DRIVER) {
        await tx.driverProfile.upsert({
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

      // 3) AUTO-CREATE (or repair) trial membership row
      const type = roleToMembershipType(updatedUser.role);

      const latest = await tx.membership.findFirst({
        where: { userId: updatedUser.id, type },
        orderBy: { startDate: "desc" },
        select: { id: true, expiryDate: true },
      });

      // If there's no membership yet, create trial.
      if (!latest) {
        await tx.membership.create({
          data: {
            userId: updatedUser.id,
            type,
            plan: MembershipPlan.STANDARD, // adjust if your enum differs
            status: MembershipStatus.ACTIVE,
            startDate: now,
            expiryDate: trialEndsAt,
            amountPaidCents: 0,
          },
        });
        return;
      }

      // If there is a membership but it's expired/bad, extend it to at least trialEndsAt
      const currentExpiry = latest.expiryDate ?? now;
      const shouldExtend = currentExpiry.getTime() < trialEndsAt.getTime();

      if (shouldExtend) {
        await tx.membership.update({
          where: { id: latest.id },
          data: {
            status: MembershipStatus.ACTIVE,
            expiryDate: trialEndsAt,
          },
        });
      }
    });

    return res.status(200).json({ ok: true, redirectTo: "/billing/membership" });
  } catch (err) {
    console.error("POST /api/account/setup error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}