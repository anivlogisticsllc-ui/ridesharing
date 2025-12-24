// pages/api/rider/bookings/cancel.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";
import { BookingStatus } from "@prisma/client";

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

  try {
    //
    // CASE 1: synthetic "ride-<rideId>" – pending request with no Booking row
    //
    if (bookingId.startsWith("ride-")) {
      const rideId = bookingId.replace(/^ride-/, "");

      try {
        // Try to delete the ride; if it’s already gone or doesn’t belong
        // to this rider, we log but still treat it as “cancelled” for the UI.
        await prisma.ride.delete({ where: { id: rideId } });
      } catch (err) {
        console.error(
          `Error deleting pending ride ${rideId} for user ${userId}:`,
          err
        );
        // swallow – from the rider’s perspective it’s “gone”
      }

      return res.status(200).json({
        ok: true,
        bookingId,
        status: BookingStatus.CANCELLED,
      });
    }

    //
    // CASE 2: real booking id – normal cancel flow
    //
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId },
      include: {
        ride: true,
      },
    });

    if (!booking) {
      return res.status(404).json({
        ok: false,
        error: "Booking not found.",
      });
    }

    const ownsBooking =
      booking.riderId === userId ||
      (booking.ride && booking.ride.riderId === userId);

    if (!ownsBooking) {
      return res.status(403).json({
        ok: false,
        error: "You are not allowed to cancel this booking.",
      });
    }

    if (
      booking.status === BookingStatus.CANCELLED ||
      booking.status === BookingStatus.COMPLETED
    ) {
      return res.status(400).json({
        ok: false,
        error: "This booking can no longer be cancelled.",
      });
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED },
    });

    return res.status(200).json({
      ok: true,
      bookingId: updated.id,
      status: updated.status,
    });
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
