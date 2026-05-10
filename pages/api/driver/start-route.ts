// pages/api/driver/start-route.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { BookingStatus, RideStatus, UserRole } from "@prisma/client";

import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { guardMembership } from "@/lib/guardMembership";

type ApiResponse = { ok: true; rideId: string } | { ok: false; error: string };

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
    const driverId = (session?.user as { id?: string } | undefined)?.id;
    const role = (session?.user as { role?: UserRole } | undefined)?.role;

    if (!driverId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (role !== UserRole.DRIVER) {
      return res.status(403).json({
        ok: false,
        error: "Only drivers can start a ride.",
      });
    }

    const { rideId } = (req.body ?? {}) as { rideId?: string };

    if (typeof rideId !== "string" || !rideId.trim()) {
      return res.status(400).json({ ok: false, error: "rideId is required" });
    }

    const cleanRideId = rideId.trim();

    const [profile, gate, otherActive, acceptedBooking] = await Promise.all([
      prisma.driverProfile.findUnique({
        where: { userId: driverId },
        select: { verificationStatus: true },
      }),

      guardMembership({
        userId: driverId,
        role: UserRole.DRIVER,
        allowTrial: true,
      }),

      prisma.ride.findFirst({
        where: {
          driverId,
          status: RideStatus.IN_ROUTE,
          id: { not: cleanRideId },
        },
        select: { id: true },
      }),

      prisma.booking.findFirst({
        where: {
          rideId: cleanRideId,
          status: BookingStatus.ACCEPTED,
        },
        select: { id: true },
      }),
    ]);

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

    if (!gate.ok) {
      return res.status(403).json({
        ok: false,
        error: gate.error || "Membership required.",
      });
    }

    if (otherActive) {
      return res.status(409).json({
        ok: false,
        error:
          "You already have a ride in progress. Complete it before starting a new one.",
      });
    }

    if (!acceptedBooking) {
      return res.status(400).json({
        ok: false,
        error: "Cannot start route: no accepted booking found for this ride.",
      });
    }

    const now = new Date();

    const updated = await prisma.ride.updateMany({
      where: {
        id: cleanRideId,
        driverId,
        status: RideStatus.ACCEPTED,
        tripStartedAt: null,
      },
      data: {
        status: RideStatus.IN_ROUTE,
        tripStartedAt: now,
      },
    });

    if (updated.count === 1) {
      return res.status(200).json({ ok: true, rideId: cleanRideId });
    }

    const ride = await prisma.ride.findFirst({
      where: { id: cleanRideId, driverId },
      select: { status: true, tripStartedAt: true },
    });

    if (!ride) {
      return res.status(404).json({
        ok: false,
        error: "Ride not found for this driver.",
      });
    }

    if (ride.tripStartedAt || ride.status === RideStatus.IN_ROUTE) {
      return res.status(200).json({ ok: true, rideId: cleanRideId });
    }

    return res.status(400).json({
      ok: false,
      error: `Ride must be in ACCEPTED status to start. Current status: ${ride.status}`,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start route.";

    console.error("Error starting route:", err);

    return res.status(500).json({
      ok: false,
      error: message,
    });
  }
}