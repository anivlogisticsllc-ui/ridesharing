// pages/api/driver/start-route.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { RideStatus, BookingStatus, UserRole } from "@prisma/client";

type ApiResponse =
  | { ok: true; rideId: string }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);

  // Widen the user type so TS knows about id & role
  const user = session?.user as
    | ({
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
      } & {
        role?: UserRole; // "RIDER" | "DRIVER" | "BOTH"
      })
    | undefined;

  if (!user?.id) {
    return res
      .status(401)
      .json({ ok: false, error: "Not authenticated" });
  }

  const driverId = user.id;
  const role = user.role;

  // Only drivers / BOTH can start a route
  if (role !== "DRIVER" && role !== "BOTH") {
    return res.status(403).json({
      ok: false,
      error: "Only drivers can start a ride.",
    });
  }

  const { rideId } = req.body as { rideId?: string };

  if (!rideId) {
    return res
      .status(400)
      .json({ ok: false, error: "rideId is required" });
  }

  // Find ride for this driver, include an ACCEPTED booking if present
  const ride = await prisma.ride.findFirst({
    where: {
      id: rideId,
      driverId,
    },
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

  // Guard: driver must not have another active IN_ROUTE ride
  const otherActive = await prisma.ride.findFirst({
    where: {
      driverId,
      status: RideStatus.IN_ROUTE,
      id: { not: rideId },
    },
    select: { id: true },
  });

  if (otherActive) {
    return res.status(400).json({
      ok: false,
      error:
        "You already have a ride in progress. Complete it before starting a new one.",
    });
  }

  const booking = ride.bookings[0];
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.ride.update({
      where: { id: ride.id },
      data: {
        status: RideStatus.IN_ROUTE,
        tripStartedAt: now, // assumes this field exists in your Ride model
      },
    });

    // Optional: keep booking in ACCEPTED for now.
    // Later you can add BookingStatus.IN_ROUTE if you want.
    if (booking) {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          // status: BookingStatus.IN_ROUTE,
        },
      });
    }
  });

  return res.status(200).json({ ok: true, rideId: ride.id });
}
