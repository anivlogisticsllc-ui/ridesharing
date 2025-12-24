// pages/api/book-ride.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { BookingStatus, RideStatus, UserRole } from "@prisma/client";
import { guardMembership } from "@/lib/guardMembership";

type ApiResponse =
  | { ok: true; bookingId: string; conversationId: string }
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
      return res.status(403).json({
        ok: false,
        error: "Only drivers can accept rider requests.",
      });
    }

    // ✅ Driver verification gate
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
        error: `Driver verification required to accept rides. Status: ${profile.verificationStatus}`,
      });
    }

    // ✅ Membership gate (DRIVER)
    const gate = await guardMembership({
      userId: driverId,
      role: UserRole.DRIVER,
      allowTrial: true, // change to false if you want paid-only
    });

    if (!gate.ok) {
      return res.status(403).json({
        ok: false,
        error: gate.error || "Membership required.",
      });
    }

    const { rideId } = (req.body ?? {}) as { rideId?: string };
    if (!rideId) {
      return res.status(400).json({ ok: false, error: "rideId is required." });
    }

    // Prevent driver from accepting multiple active rides
    const activeRide = await prisma.ride.findFirst({
      where: {
        driverId,
        status: { in: [RideStatus.ACCEPTED, RideStatus.IN_ROUTE] },
        NOT: { id: rideId },
      },
      select: { id: true },
    });

    if (activeRide) {
      return res.status(400).json({
        ok: false,
        error:
          "You already have an active ride. Complete it before accepting a new one.",
      });
    }

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        rider: { select: { id: true, name: true, email: true, publicId: true } },
        bookings: {
          where: { status: BookingStatus.ACCEPTED },
          select: { id: true },
        },
      },
    });

    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found." });
    }

    if (!ride.rider) {
      return res.status(400).json({
        ok: false,
        error: "Ride has no rider associated. Cannot accept.",
      });
    }

    if (ride.status === RideStatus.COMPLETED || ride.status === RideStatus.IN_ROUTE) {
      return res.status(400).json({
        ok: false,
        error: "This ride is no longer available to accept.",
      });
    }

    if (ride.driverId && ride.driverId !== driverId) {
      return res.status(409).json({
        ok: false,
        error: "This ride has already been accepted by another driver.",
      });
    }

    if (ride.bookings.length > 0 && ride.driverId !== driverId) {
      return res.status(400).json({
        ok: false,
        error: "This ride has already been booked.",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Use updateMany to avoid race conditions (accept only if not already taken)
      const updated = await tx.ride.updateMany({
        where: {
          id: ride.id,
          OR: [{ driverId: null }, { driverId }],
          status: { notIn: [RideStatus.COMPLETED, RideStatus.IN_ROUTE] },
        },
        data: { driverId, status: RideStatus.ACCEPTED },
      });

      if (updated.count === 0) {
        throw new Error("Ride was already accepted by another driver.");
      }

      const booking = await tx.booking.create({
        data: {
          rideId: ride.id,
          riderId: ride.rider!.id,
          riderName: ride.rider!.name ?? "Rider",
          riderEmail: ride.rider!.email ?? "unknown@example.com",
          status: BookingStatus.ACCEPTED,
        },
      });

      const conversation = await tx.conversation.create({
        data: {
          rideId: ride.id,
          driverId,
          riderId: ride.rider!.id,
          bookingId: booking.id,
        },
      });

      return { booking, conversation };
    });

    return res.status(201).json({
      ok: true,
      bookingId: result.booking.id,
      conversationId: result.conversation.id,
    });
  } catch (err: any) {
    console.error("Error in /api/book-ride:", err);

    // If our transaction throws the race-condition message, return 409
    const msg = String(err?.message || "");
    if (msg.includes("already accepted")) {
      return res.status(409).json({ ok: false, error: msg });
    }

    return res.status(500).json({
      ok: false,
      error: "Failed to accept ride. Please try again.",
    });
  }
}
