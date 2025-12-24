// pages/api/receipt/email.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { RideStatus } from "@prisma/client";

import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import {
  sendRideReceiptEmail,
  sendDriverReceiptEmail,
  type RideReceiptSnapshot,
} from "../../../lib/email";

type ApiResponse = { ok: true } | { ok: false; error: string };

function toStr(v: unknown) {
  return typeof v === "string" ? v : "";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const user = session?.user as any;

  const userId = toStr(user?.id).trim();
  const userEmail = toStr(user?.email).trim();

  if (!userId || !userEmail) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const bookingId = toStr(req.body?.bookingId).trim();
  if (!bookingId) {
    return res.status(400).json({ ok: false, error: "Missing bookingId" });
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      rider: { select: { id: true, name: true, email: true } },
      ride: {
        include: {
          driver: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!booking?.ride) {
    return res.status(404).json({ ok: false, error: "Receipt not found" });
  }

  const ride = booking.ride;

  if (ride.status !== RideStatus.COMPLETED) {
    return res.status(400).json({
      ok: false,
      error: "Receipt is only available for completed rides.",
    });
  }

  const isRider = booking.rider?.id === userId;
  const isDriver = ride.driver?.id === userId;

  if (!isRider && !isDriver) {
    return res.status(403).json({ ok: false, error: "Not allowed" });
  }

  const rideSnapshot: RideReceiptSnapshot = {
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
  };

  // Send to the LOGGED-IN USER (same behavior for rider + driver)
  if (isDriver) {
    await sendDriverReceiptEmail({
      driverEmail: userEmail,
      driverName: ride.driver?.name ?? user?.name ?? null,
      riderName: booking.rider?.name ?? null,
      ride: rideSnapshot,
    });

    return res.status(200).json({ ok: true });
  }

  await sendRideReceiptEmail({
    riderEmail: userEmail,
    riderName: booking.rider?.name ?? null,
    driverName: ride.driver?.name ?? null,
    ride: rideSnapshot,
  });

  return res.status(200).json({ ok: true });
}
