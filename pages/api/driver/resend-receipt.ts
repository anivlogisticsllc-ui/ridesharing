// pages/api/driver/resend-receipt.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { RideStatus } from "@prisma/client";
import { sendDriverReceiptEmail } from "../../../lib/email";

type ApiResponse = { ok: true } | { ok: false; error: string };
type Body = { bookingId?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);

  const user = session?.user as
    | ({
        id?: string;
        name?: string | null;
        email?: string | null;
        role?: "RIDER" | "DRIVER" | "BOTH";
      } & Record<string, unknown>)
    | undefined;

  if (!user?.id) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  if (user.role !== "DRIVER" && user.role !== "BOTH") {
    return res.status(403).json({ ok: false, error: "Not a driver" });
  }

  if (!user.email) {
    return res.status(400).json({ ok: false, error: "Driver email not available." });
  }

  const { bookingId } = req.body as Body;
  if (!bookingId?.trim()) {
    return res.status(400).json({ ok: false, error: "bookingId is required" });
  }

  // Only allow driver to send receipt for their own ride
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId.trim(),
      ride: { driverId: user.id },
    },
    include: {
      rider: true,
      ride: { include: { driver: true } },
    },
  });

  if (!booking?.ride) {
    return res.status(404).json({ ok: false, error: "Booking or ride not found" });
  }

  const ride = booking.ride;

  if (ride.status !== RideStatus.COMPLETED) {
    return res.status(400).json({
      ok: false,
      error: "Receipt is only available for completed rides.",
    });
  }

  // Match rider behavior: fire-and-forget + log errors
  sendDriverReceiptEmail({
    driverEmail: user.email,
    driverName: ride.driver?.name ?? user.name ?? null,
    riderName: booking.rider?.name ?? null,
    ride: {
      id: ride.id,
      status: ride.status,
      originCity: ride.originCity,
      originLat: ride.originLat,
      originLng: ride.originLng,
      destinationCity: ride.destinationCity,
      destinationLat: ride.destinationLat,
      destinationLng: ride.destinationLng,
      departureTime: ride.departureTime,
      tripStartedAt: ride.tripStartedAt,
      tripCompletedAt: ride.tripCompletedAt,
      passengerCount: ride.passengerCount,
      distanceMiles: ride.distanceMiles,
      totalPriceCents: ride.totalPriceCents,
    },
  }).catch((err) => {
    console.error("[driver-receipt-email] Failed to resend driver receipt:", err);
  });

  return res.status(200).json({ ok: true });
}
