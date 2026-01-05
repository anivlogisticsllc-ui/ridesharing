// pages/api/rider/bookings/cancel.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";
import { BookingStatus, RideStatus } from "@prisma/client";

type ApiResponse =
  | { ok: true; bookingId: string; status: BookingStatus }
  | { ok: false; error: string };

function getUserId(session: any): string | null {
  const id = session?.user?.id;
  return typeof id === "string" && id.length ? id : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const userId = getUserId(session);

  if (!userId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { bookingId } = req.body || {};
  if (!bookingId || typeof bookingId !== "string") {
    return res.status(400).json({ ok: false, error: "bookingId is required" });
  }

  try {
    // ------------------------------------------------------------
    // CASE 1: synthetic "ride-<rideId>"
    // ------------------------------------------------------------
    if (bookingId.startsWith("ride-")) {
      const rideId = bookingId.replace(/^ride-/, "");

      const result = await prisma.$transaction(async (tx) => {
        const ride = await tx.ride.findFirst({
          where: { id: rideId, riderId: userId },
          select: { id: true, status: true },
        });

        if (!ride) {
          return { kind: "error" as const, status: 404, message: "Ride not found." };
        }

        if (ride.status === RideStatus.IN_ROUTE || ride.status === RideStatus.COMPLETED) {
          return { kind: "error" as const, status: 400, message: "This ride can no longer be cancelled." };
        }

        // Update ride
        await tx.ride.update({
          where: { id: rideId },
          data: { status: RideStatus.CANCELLED },
        });

        // If any booking exists (rare), cancel it too (idempotent)
        await tx.booking.updateMany({
          where: {
            rideId,
            riderId: userId,
            status: { notIn: [BookingStatus.CANCELLED, BookingStatus.COMPLETED] },
          },
          data: { status: BookingStatus.CANCELLED },
        });

        return { kind: "ok" as const };
      });

      if (result.kind === "error") {
        return res.status(result.status).json({ ok: false, error: result.message });
      }

      return res.status(200).json({ ok: true, bookingId, status: BookingStatus.CANCELLED });
    }

    // ------------------------------------------------------------
    // CASE 2: real booking id
    // ------------------------------------------------------------
    const result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { ride: true },
      });

      if (!booking || !booking.ride) {
        return { kind: "error" as const, status: 404, message: "Booking not found." };
      }

      const owns =
        booking.riderId === userId || booking.ride.riderId === userId;

      if (!owns) {
        return { kind: "error" as const, status: 403, message: "You are not allowed to cancel this booking." };
      }

      // If ride already in route/completed, block cancellation
      if (booking.ride.status === RideStatus.IN_ROUTE || booking.ride.status === RideStatus.COMPLETED) {
        return { kind: "error" as const, status: 400, message: "This ride can no longer be cancelled." };
      }

      // Idempotent: if already cancelled/completed, just return current status
      if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
        return { kind: "ok" as const, bookingId: booking.id, status: booking.status };
      }

      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CANCELLED },
      });

      // Keep ride in sync (only if not in route/completed)
      await tx.ride.update({
        where: { id: booking.rideId },
        data: { status: RideStatus.CANCELLED },
      });

      return { kind: "ok" as const, bookingId: updatedBooking.id, status: updatedBooking.status };
    });

    if (result.kind === "error") {
      return res.status(result.status).json({ ok: false, error: result.message });
    }

    return res.status(200).json({ ok: true, bookingId: result.bookingId, status: result.status });
  } catch (err: any) {
    console.error("Error cancelling booking or ride:", err);
    return res.status(500).json({
      ok: false,
      error:
        err?.message && process.env.NODE_ENV === "development"
          ? err.message
          : "Failed to cancel booking",
    });
  }
}
