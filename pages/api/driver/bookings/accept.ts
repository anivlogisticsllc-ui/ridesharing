// pages/api/driver/bookings/accept.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]"; // adjust path if needed
import { prisma } from "../../../lib/prisma";        // adjust path if needed
import { canAcceptRides, driverBlockReason } from "../../../lib/driverEligibility";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).end();

    const session = await getServerSession(req, res, authOptions);
    const userId = session?.user?.id as string | undefined;

    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const { bookingId } = req.body as { bookingId?: string };
    if (!bookingId) return res.status(400).json({ ok: false, error: "Missing bookingId" });

    // Pull the minimum needed to enforce rules
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        membershipActive: true,
        membershipStatus: true, // if you don't have this field, remove it and set to "active"/"none" below
        driverProfile: { select: { verificationStatus: true } },
      },
    });

    if (!user || (user.role !== "DRIVER")) {
      return res.status(403).json({ ok: false, error: "Driver account required" });
    }

    const verificationStatus = user.driverProfile?.verificationStatus ?? null;

    const membership = {
      active: !!user.membershipActive,
      status: (user.membershipStatus ?? "none") as any,
    };

    if (!canAcceptRides({ verificationStatus, membership })) {
      return res.status(403).json({
        ok: false,
        code: "DRIVER_NOT_ELIGIBLE",
        error: driverBlockReason({ verificationStatus, membership }) ?? "Not eligible",
        verificationStatus,
        membership,
      });
    }

    // IMPORTANT: prevent double-accept (only accept if still open)
    // Adjust status values to your schema: "PENDING"/"OPEN" etc.
    const updated = await prisma.booking.updateMany({
      where: {
        id: bookingId,
        // If your booking has driverId, enforce it is not already taken:
        driverId: null,
        // If you have a status field, enforce correct starting state:
        status: "PENDING",
      },
      data: {
        driverId: userId,
        status: "CONFIRMED",
      },
    });

    if (updated.count === 0) {
      return res.status(409).json({
        ok: false,
        error: "Booking is no longer available to accept (already accepted or not pending).",
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
