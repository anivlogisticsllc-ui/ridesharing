// pages/api/book-ride.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "../../lib/prisma";
import { BookingStatus, RideStatus, type UserRole } from "@prisma/client";

type ApiResponse =
  | {
      ok: true;
      bookingId: string;
      conversationId: string;
    }
  | {
      ok: false;
      error: string;
    };

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
  const user = session?.user as
    | ({ id?: string; role?: UserRole | "BOTH" } & {
        name?: string | null;
        email?: string | null;
        image?: string | null;
      })
    | undefined;

  if (!user?.id) {
    return res
      .status(401)
      .json({ ok: false, error: "Not authenticated" });
  }

  const driverId = user.id;
  const role = user.role as UserRole | "BOTH" | undefined;

  // Only drivers (or BOTH) can accept rider requests
  if (role !== "DRIVER" && role !== "BOTH") {
    return res.status(403).json({
      ok: false,
      error: "Only drivers can accept rider requests.",
    });
  }

  const { rideId } = req.body as { rideId?: string };
  if (!rideId) {
    return res
      .status(400)
      .json({ ok: false, error: "rideId is required." });
  }

  // Block driver from accepting a different active ride
  const activeRide = await prisma.ride.findFirst({
    where: {
      driverId,
      status: {
        in: [RideStatus.ACCEPTED, RideStatus.IN_ROUTE],
      },
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

  // Fetch ride with rider + any accepted booking
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      rider: {
        select: {
          id: true,
          name: true,
          email: true,
          publicId: true,
        },
      },
      bookings: {
        where: { status: BookingStatus.ACCEPTED },
        select: { id: true },
      },
    },
  });

  if (!ride) {
    return res
      .status(404)
      .json({ ok: false, error: "Ride not found." });
  }

  if (!ride.rider) {
    return res.status(400).json({
      ok: false,
      error: "Ride has no rider associated. Cannot accept.",
    });
  }

  // If ride is already completed or in progress, block
  if (
    ride.status === RideStatus.COMPLETED ||
    ride.status === RideStatus.IN_ROUTE
  ) {
    return res.status(400).json({
      ok: false,
      error: "This ride is no longer available to accept.",
    });
  }

  // If some other driver is already attached, block this driver
  if (ride.driverId && ride.driverId !== driverId) {
    return res.status(409).json({
      ok: false,
      error: "This ride has already been accepted by another driver.",
    });
  }

  // If we already see an ACCEPTED booking, treat as "already taken"
  if (ride.bookings.length > 0 && ride.driverId !== driverId) {
    return res.status(400).json({
      ok: false,
      error: "This ride has already been booked.",
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updatedRide = await tx.ride.update({
        where: { id: ride.id },
        data: {
          driverId,
          status: RideStatus.ACCEPTED,
        },
      });

      const booking = await tx.booking.create({
        data: {
          rideId: updatedRide.id,
          riderId: ride.rider!.id,
          riderName: ride.rider!.name ?? "Rider",
          riderEmail: ride.rider!.email ?? "unknown@example.com",
          status: BookingStatus.ACCEPTED,
        },
      });

      const conversation = await tx.conversation.create({
        data: {
          rideId: updatedRide.id,
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
  } catch (err) {
    console.error("Error in /api/book-ride:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to accept ride. Please try again.",
    });
  }
}
