// pages/api/rider/bookings/complete.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";
import { BookingStatus, RideStatus } from "@prisma/client";

type ApiResponse =
  | { ok: true; bookingId: string; status: BookingStatus }
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

  const user = session?.user as
    | ({
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
      } & {
        role?: "RIDER" | "DRIVER";
      })
    | undefined;

  if (!user?.id) {
    return res
      .status(401)
      .json({ ok: false, error: "Not authenticated" });
  }

  const userId = user.id;
  const { bookingId } = req.body || {};

  if (!bookingId || typeof bookingId !== "string") {
    return res
      .status(400)
      .json({ ok: false, error: "bookingId is required" });
  }

  // Synthetic "ride-<rideId>" entries represent rides without bookings
  if (bookingId.startsWith("ride-")) {
    return res.status(400).json({
      ok: false,
      error:
        "This entry represents a ride without a booking. It cannot be completed via this endpoint.",
    });
  }

  try {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId },
      include: {
        ride: true,
      },
    });

    if (!booking || !booking.ride) {
      return res
        .status(404)
        .json({ ok: false, error: "Booking not found." });
    }

    const ownsBooking =
      booking.riderId === userId ||
      booking.ride.riderId === userId;

    if (!ownsBooking) {
      return res.status(403).json({
        ok: false,
        error: "You are not allowed to complete this booking.",
      });
    }

    // 🔒 NEW: rider can only complete if the *ride* is already COMPLETED
    if (booking.ride.status !== RideStatus.COMPLETED) {
      return res.status(400).json({
        ok: false,
        error:
          "Your driver hasn’t completed this ride yet. " +
          "You’ll be able to mark it complete once the trip is finished.",
      });
    }

    if (booking.status === BookingStatus.CANCELLED) {
      return res.status(400).json({
        ok: false,
        error: "Cancelled bookings cannot be completed.",
      });
    }

    // Idempotent: if already completed, just echo back success
    if (booking.status === BookingStatus.COMPLETED) {
      return res.status(200).json({
        ok: true,
        bookingId: booking.id,
        status: booking.status,
      });
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.COMPLETED },
    });

    return res.status(200).json({
      ok: true,
      bookingId: updated.id,
      status: updated.status,
    });
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
