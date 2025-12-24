// pages/api/driver/start-route.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { BookingStatus, RideStatus, UserRole } from "@prisma/client";
import { guardMembership } from "@/lib/guardMembership";

type ApiResponse =
  | { ok: true; rideId: string }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    const driverId = (session?.user as any)?.id as string | undefined;
    const role = (session?.user as any)?.role as UserRole | undefined;

    if (!driverId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (role !== UserRole.DRIVER) {
      return res
        .status(403)
        .json({ ok: false, error: "Only drivers can start a ride." });
    }

    const { rideId } = (req.body ?? {}) as { rideId?: string };
    if (!rideId) {
      return res.status(400).json({ ok: false, error: "rideId is required" });
    }

    // ✅ Verification gate
    const profile = await prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: { verificationStatus: true },
    });

    if (!profile) {
      return res.status(403).json({
        ok: false,
        error: "Driver profile missing. Complete driver setup first.",
      });
    }

    if (profile.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        ok: false,
        error: `Driver verification required. Status: ${profile.verificationStatus}`,
      });
    }

    // ✅ Membership gate (DRIVER)
    const gate = await guardMembership({
      userId: driverId,
      role: UserRole.DRIVER,
      allowTrial: true,
    });

    if (!gate.ok) {
      return res.status(403).json({
        ok: false,
        error: gate.error || "Membership required.",
      });
    }

    // Load ride and validate ownership/status
    const ride = await prisma.ride.findFirst({
      where: { id: rideId, driverId },
      include: {
        bookings: {
          where: { status: BookingStatus.ACCEPTED },
          take: 1,
        },
      },
    });

    if (!ride) {
      return res
        .status(404)
        .json({ ok: false, error: "Ride not found for this driver." });
    }

    if (ride.status !== RideStatus.ACCEPTED) {
      return res.status(400).json({
        ok: false,
        error: `Ride must be in ACCEPTED status to start. Current status: ${ride.status}`,
      });
    }

    // Prevent multiple active rides
    const otherActive = await prisma.ride.findFirst({
      where: { driverId, status: RideStatus.IN_ROUTE, id: { not: rideId } },
      select: { id: true },
    });

    if (otherActive) {
      return res.status(400).json({
        ok: false,
        error:
          "You already have a ride in progress. Complete it before starting a new one.",
      });
    }

    const now = new Date();

    await prisma.ride.update({
      where: { id: rideId },
      data: { status: RideStatus.IN_ROUTE, tripStartedAt: now },
    });

    return res.status(200).json({ ok: true, rideId });
  } catch (err) {
    console.error("Error starting route:", err);
    return res.status(500).json({ ok: false, error: "Failed to start route." });
  }
}
