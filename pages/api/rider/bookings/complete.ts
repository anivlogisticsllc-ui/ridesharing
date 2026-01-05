// pages/api/rider/bookings/complete.ts
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

  // Synthetic "ride-<rideId>" entries represent rides without bookings
  if (bookingId.startsWith("ride-")) {
    return res.status(400).json({
      ok: false,
      error: "This entry represents a ride without a booking. It cannot be completed via this endpoint.",
    });
  }

  try {
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
        return { kind: "error" as const, status: 403, message: "You are not allowed to complete this booking." };
      }

      if (booking.status === BookingStatus.CANCELLED) {
        return { kind: "error" as const, status: 400, message: "Cancelled bookings cannot be completed." };
      }

      // Rider can only complete after the driver/ride is marked completed
      if (booking.ride.status !== RideStatus.COMPLETED) {
        return {
          kind: "error" as const,
          status: 400,
          message:
            "Your driver hasn’t completed this ride yet. You’ll be able to mark it complete once the trip is finished.",
        };
      }

      // Idempotent: already completed -> success
      if (booking.status === BookingStatus.COMPLETED) {
        return { kind: "ok" as const, bookingId: booking.id, status: booking.status };
      }

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.COMPLETED },
      });

      return { kind: "ok" as const, bookingId: updated.id, status: updated.status };
    });

    if (result.kind === "error") {
      return res.status(result.status).json({ ok: false, error: result.message });
    }

    return res.status(200).json({ ok: true, bookingId: result.bookingId, status: result.status });
  } catch (err: any) {
    console.error("Error completing booking:", err);
    return res.status(500).json({
      ok: false,
      error:
        err?.message && process.env.NODE_ENV === "development"
          ? err.message
          : "Failed to complete booking",
    });
  }
}
